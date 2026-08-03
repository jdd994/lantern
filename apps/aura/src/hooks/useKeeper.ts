// useKeeper.ts — the background keeper. While one home is on screen (useAura),
// every OTHER home's schedule keeps its word: automations fire at their times
// (each home using its own location, so each gets its own sunset), motion
// sensors still trip their lights, fades walk the wall clock, and the day
// rhythm keeps breathing. Same pure logic as the live engine — dueAutomations,
// vibePatches, rhythmStep — with a plain connector transport instead of React
// state, because nobody is looking at these lights.
//
// Costs are kept honest: automations check every 30s (pure math, no network),
// sensors poll at 15s (vs 5s when a home is on screen), and the rhythm ticks
// every 10 minutes — it has to ask each light how it looks before shaping it,
// and a home where everything is off answers cheaply and is left alone (the
// rhythm never turns a light on).
import { useEffect } from "react";
import * as db from "../lib/db";
import { dbNameFor, type Home } from "../lib/homes";
import { readGeo, readRhythm } from "./useAura";
import { connectorFor, type Device, type LightState, type Sensor } from "../lib/connectors";
import {
  actionsOf,
  dueAutomations,
  sensorDue,
  ymd,
  type Action,
  type Automation,
} from "../lib/automations";
import { RHYTHM_PRESETS, rhythmPresetById, rhythmTarget } from "../lib/rhythm";
import { rhythmStep, vibePatches, type RhythmMemory } from "../lib/apply";
import { effectiveDeviceIds, type Room } from "../lib/rooms";
import { startCadence } from "../lib/cadence";
import type { CustomVibe, StoredScene, StoredSource } from "../lib/db";

type World = {
  sources: StoredSource[];
  devices: Device[];
  rooms: Room[];
  scenes: StoredScene[];
  customVibes: CustomVibe[];
  automations: Automation[];
  sensors: Sensor[];
};

const SCENE_TRANSITION_MS = 800;
const RHYTHM_TRANSITION_MS = 4000;

function startHomeKeeper(home: Home): () => void {
  const hdb = db.forHome(dbNameFor(home.id));
  let stopped = false;
  let world: World | null = null;
  const stops: (() => void)[] = [];
  const prevMotion: Record<string, boolean> = {};
  const rhythmMem: Record<string, RhythmMemory> = {};

  const credFor = (sourceId: string) => world?.sources.find((s) => s.id === sourceId)?.cred;

  const getState = async (device: Device): Promise<LightState | null> => {
    const cred = credFor(device.sourceId);
    const conn = connectorFor(device.sourceId);
    if (!cred || !conn) return null;
    try {
      return await conn.getState(cred, device);
    } catch {
      return null; // an unreachable light is left alone this tick
    }
  };

  const push = async (deviceId: string, patch: Partial<LightState>, transitionMs?: number) => {
    const device = world?.devices.find((d) => d.id === deviceId);
    if (!device) return;
    const cred = credFor(device.sourceId);
    const conn = connectorFor(device.sourceId);
    if (!cred || !conn) return;
    try {
      await conn.setState(cred, device, patch, transitionMs ? { transitionMs } : undefined);
    } catch {
      /* an unreachable light shouldn't stop the keeper */
    }
  };

  // Fades ride the wall clock exactly like the live engine's.
  const startFade = async (action: Extract<Action, { kind: "fade" }>) => {
    const w = world;
    if (!w) return;
    const fadeRoom = action.roomId ? w.rooms.find((r) => r.id === action.roomId) : undefined;
    const ids = (
      action.roomId ? (fadeRoom ? effectiveDeviceIds(fadeRoom, w.rooms) : []) : w.devices.map((d) => d.id)
    ).filter((id) => w.devices.find((d) => d.id === id)?.canBrightness);
    if (!ids.length) return;
    const to = Math.max(0, Math.min(100, action.toBrightness));
    const starts: Record<string, number> = {};
    for (const id of ids) {
      const device = w.devices.find((d) => d.id === id)!;
      const st = await getState(device);
      starts[id] = st?.on ? (st.brightness ?? 100) : 0;
      if (to > 0) await push(id, { on: true, brightness: Math.max(1, Math.round(starts[id] || 1)) });
    }
    const startedAt = Date.now();
    const totalMs = Math.max(1, action.minutes) * 60_000;
    const holder: { stop?: () => void } = {};
    const step = async () => {
      const frac = Math.min(1, (Date.now() - startedAt) / totalMs);
      const done = frac >= 1;
      for (const id of ids) {
        const b = Math.round(starts[id] + (to - starts[id]) * frac);
        if (done && to <= 0) await push(id, { on: false });
        else await push(id, { brightness: Math.max(1, Math.min(100, b)) });
      }
      if (done && holder.stop) {
        holder.stop();
        const i = stops.indexOf(holder.stop);
        if (i >= 0) stops.splice(i, 1);
      }
    };
    holder.stop = startCadence(20_000, () => void step());
    stops.push(holder.stop);
  };

  const runAction = async (action: Action) => {
    const w = world;
    if (!w) return;
    if (action.kind === "scene") {
      const scene = w.scenes.find((s) => s.id === action.sceneId);
      for (const [id, st] of Object.entries(scene?.states ?? {})) await push(id, st, SCENE_TRANSITION_MS);
    } else if (action.kind === "vibe") {
      for (const { deviceId, patch } of vibePatches(action.vibeId, action.roomId, w.devices, w.rooms, w.customVibes)) {
        await push(deviceId, patch, SCENE_TRANSITION_MS);
      }
    } else if (action.kind === "allOff") {
      for (const d of w.devices) await push(d.id, { on: false });
    } else if (action.kind === "roomPower") {
      const room = w.rooms.find((r) => r.id === action.roomId);
      if (room) for (const id of effectiveDeviceIds(room, w.rooms)) await push(id, { on: action.on });
    } else if (action.kind === "fade") {
      void startFade(action);
    }
  };

  const fired = async (a: Automation, stamp: Partial<Automation>) => {
    const w = world;
    if (!w) return;
    const updated = { ...a, ...stamp };
    w.automations = w.automations.map((x) => (x.id === a.id ? updated : x));
    await hdb.putAutomation(updated);
  };

  const rhythmTick = async () => {
    const w = world;
    if (!w) return;
    const settings = readRhythm(home.id);
    if (!settings.enabled) return;
    const preset = rhythmPresetById(settings.presetId) ?? RHYTHM_PRESETS[0];
    const target = rhythmTarget(new Date(), readGeo(home.id), preset);
    for (const d of w.devices) {
      if (!d.canColorTemp && !d.canColor && !d.canBrightness) continue;
      const st = await getState(d);
      if (!st) continue;
      const patch = rhythmStep(d, st, target, (rhythmMem[d.id] ??= {}));
      if (patch) await push(d.id, patch, RHYTHM_TRANSITION_MS);
    }
  };

  (async () => {
    const [sources, devices, rooms, scenes, customVibes, automations] = await Promise.all([
      hdb.allSources(),
      hdb.allDevices(),
      hdb.allRooms(),
      hdb.allScenes(),
      hdb.allCustomVibes(),
      hdb.allAutomations(),
    ]);
    const sensors: Sensor[] = [];
    for (const s of sources) {
      const conn = connectorFor(s.id);
      if (!conn?.listSensors) continue;
      try {
        sensors.push(...(await conn.listSensors(s.cred)));
      } catch {
        /* a brand's sensor list failing shouldn't break the keeper */
      }
    }
    if (stopped) return;
    world = { sources, devices, rooms, scenes, customVibes, automations, sensors };

    // Timed automations — same grace-window check the live engine uses, with
    // THIS home's coordinates for its own sunrise and sunset.
    stops.push(
      startCadence(30_000, () => {
        const w = world;
        if (!w) return;
        const now = new Date();
        for (const a of dueAutomations(w.automations, now, readGeo(home.id))) {
          for (const act of actionsOf(a)) void runAction(act);
          void fired(a, { lastRun: ymd(now) });
        }
      })
    );

    // Motion — a gentler poll than the on-screen home's, but the hallway
    // still lights when someone's there and nobody's watching the app.
    if (sensors.length) {
      stops.push(
        startCadence(15_000, () => {
          void (async () => {
            const w = world;
            if (!w) return;
            for (const sensor of w.sensors) {
              const conn = connectorFor(sensor.sourceId);
              const cred = credFor(sensor.sourceId);
              if (!conn?.readSensor || cred === undefined) continue;
              let motion = false;
              try {
                motion = (await conn.readSensor(cred, sensor)).motion;
              } catch {
                continue;
              }
              const was = prevMotion[sensor.id] ?? false;
              prevMotion[sensor.id] = motion;
              if (was || !motion) continue; // only the false → true edge
              const now = new Date();
              for (const a of sensorDue(w.automations, sensor.id, now)) {
                for (const act of actionsOf(a)) void runAction(act);
                void fired(a, { lastFiredAt: now.getTime() });
              }
            }
          })();
        })
      );
    }

    // The day rhythm, at a background pace.
    void rhythmTick();
    stops.push(startCadence(10 * 60_000, () => void rhythmTick()));
  })();

  return () => {
    stopped = true;
    stops.forEach((s) => s());
  };
}

// Keep every home except the one on screen. Rebuilds when the active home or
// the registry changes (a switch hands the outgoing home to the keeper and
// takes the incoming one back).
export function useKeeper(activeHomeId: string, homes: Home[]) {
  useEffect(() => {
    const stops = homes.filter((h) => h.id !== activeHomeId).map(startHomeKeeper);
    return () => stops.forEach((s) => s());
  }, [activeHomeId, homes]);
}

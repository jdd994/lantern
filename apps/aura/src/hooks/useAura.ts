// useAura.ts
// The one place state and IO meet. Holds the connected sources, the devices, their
// live states, and your scenes — and routes every control through the right brand
// connector. No decrypted key here (Aura has no vault); just the API credentials.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as db from "../lib/db";
import { vibeById } from "@lantern/core";
import { connectVibeRelay, type VibeRelayHandle } from "@lantern/core/vibe-relay";
import { connectorFor, type Device, type LightState, type Sensor } from "../lib/connectors";
import { simulateDemoMotion } from "../lib/connectors/demo";
import { assign, type Room } from "../lib/rooms";
import { adaptiveKelvin } from "../lib/adaptive";
import { paletteVariant } from "../lib/palette";
import {
  actionsOf,
  dueAutomations,
  sensorDue,
  ymd,
  type Action,
  type Automation,
  type Coords,
  type Trigger,
} from "../lib/automations";
import type { Color } from "../lib/connectors";
import type { CustomVibe, StoredScene, StoredSource } from "../lib/db";

const GEO_KEY = "aura-geo";
const readGeo = (): Coords | null => {
  try {
    const raw = localStorage.getItem(GEO_KEY);
    return raw ? (JSON.parse(raw) as Coords) : null;
  } catch {
    return null;
  }
};

const uid = () => crypto.randomUUID();

// Recalling a scene or vibe should feel like a room easing, not a light switch.
// Brands that fade natively (Hue) honor this; others simply snap.
const SCENE_TRANSITION_MS = 800;

// Merge two lists by id; items in `next` overwrite matching ones in `prev`.
function mergeById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const m = new Map(prev.map((x) => [x.id, x]));
  for (const x of next) m.set(x.id, x);
  return [...m.values()];
}

export function useAura() {
  const [sources, setSources] = useState<StoredSource[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [scenes, setScenes] = useState<StoredScene[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [customVibes, setCustomVibes] = useState<CustomVibe[]>([]);
  // Your own name for a light, keyed by device id — a display override only; it
  // never touches the brand's own name and survives a refresh/reconnect since it
  // lives apart from the (fully-replaced-on-refresh) device cache.
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [coords, setCoords] = useState<Coords | null>(readGeo);
  const [adaptive, setAdaptiveState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("aura-adaptive") === "1";
    } catch {
      return false;
    }
  });
  // Mirror vibes with other lantern apps on this machine (the vibe relay). Off by
  // default: this only ever starts talking to localhost after an explicit choice.
  const [mirrorVibes, setMirrorVibesState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("aura-vibe-mirror") === "1";
    } catch {
      return false;
    }
  });
  const [states, setStates] = useState<Record<string, LightState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const credFor = useCallback(
    (sourceId: string) => sources.find((s) => s.id === sourceId)?.cred,
    [sources]
  );

  // Fetch live state for a set of devices, best-effort (one dead device or a
  // non-retrievable model never blocks the rest).
  const loadStates = useCallback(async (devs: Device[], srcs: StoredSource[]) => {
    const startedAt = Date.now();
    const results = await Promise.allSettled(
      devs.map(async (d) => {
        const cred = srcs.find((s) => s.id === d.sourceId)?.cred;
        const conn = connectorFor(d.sourceId);
        if (!cred || !conn) return null;
        return [d.id, await conn.getState(cred, d)] as const;
      })
    );
    setStates((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const [id, fetched] = r.value;
        // A local edit (a slider drag, a vibe) that landed after this fetch
        // started wins — this fetch's answer is already stale for that device.
        if ((lastLocalEdit.current[id] ?? 0) >= startedAt) continue;
        next[id] = fetched;
      }
      return next;
    });
  }, []);

  // Discover each connected brand's sensors (best-effort — brands without any, or a
  // failing call, simply contribute none).
  const loadSensors = useCallback(async (srcs: StoredSource[]) => {
    const out: Sensor[] = [];
    for (const s of srcs) {
      const conn = connectorFor(s.id);
      if (!conn?.listSensors) continue;
      try {
        out.push(...(await conn.listSensors(s.cred)));
      } catch {
        /* a brand's sensor list failing shouldn't break the others */
      }
    }
    setSensors(out);
  }, []);

  useEffect(() => {
    (async () => {
      const [srcs, devs, scns, rms, autos, cvibes, dnames] = await Promise.all([
        db.allSources(),
        db.allDevices(),
        db.allScenes(),
        db.allRooms(),
        db.allAutomations(),
        db.allCustomVibes(),
        db.allDeviceNames(),
      ]);
      setSources(srcs);
      setDevices(devs);
      setScenes(scns.sort((a, b) => a.createdAt - b.createdAt));
      setRooms(rms);
      setAutomations(autos.sort((a, b) => a.name.localeCompare(b.name)));
      setCustomVibes(cvibes.sort((a, b) => a.createdAt - b.createdAt));
      setDeviceNames(dnames);
      if (devs.length) void loadStates(devs, srcs);
      if (srcs.length) void loadSensors(srcs);
    })();
  }, [loadStates, loadSensors]);

  // Connect a brand by validating its credential (a successful device list = valid).
  const connect = useCallback(
    async (sourceId: string, cred: string): Promise<string | null> => {
      const conn = connectorFor(sourceId);
      if (!conn) return "Unknown source.";
      setBusy(true);
      setError(null);
      try {
        const devs = await conn.listDevices(cred.trim());
        const source: StoredSource = { id: sourceId, cred: cred.trim(), connectedAt: Date.now() };
        await db.putSource(source);
        await db.replaceDevicesForSource(sourceId, devs);
        const nextSources = [...sources.filter((s) => s.id !== sourceId), source];
        const nextDevices = [...devices.filter((d) => d.sourceId !== sourceId), ...devs];
        setSources(nextSources);
        setDevices(nextDevices);
        void loadStates(devs, nextSources);
        void loadSensors(nextSources);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't connect that source.";
      } finally {
        setBusy(false);
      }
    },
    [sources, devices, loadStates, loadSensors]
  );

  const disconnect = useCallback(async (sourceId: string) => {
    await db.deleteSource(sourceId);
    await db.deleteDevicesForSource(sourceId);
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
    setDevices((prev) => prev.filter((d) => d.sourceId !== sourceId));
    setSensors((prev) => prev.filter((s) => s.sourceId !== sourceId));
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let merged: Device[] = [];
      for (const s of sources) {
        const conn = connectorFor(s.id);
        if (!conn) continue;
        try {
          const devs = await conn.listDevices(s.cred);
          await db.replaceDevicesForSource(s.id, devs);
          merged = [...merged.filter((d) => d.sourceId !== s.id), ...devs];
        } catch (e) {
          setError(e instanceof Error ? e.message : `Couldn't refresh ${s.id}.`);
        }
      }
      if (merged.length) {
        setDevices(merged);
        void loadStates(merged, sources);
      }
    } finally {
      setBusy(false);
    }
  }, [sources, loadStates]);

  // Dragging a brightness slider or color picker fires a change per pixel; brands
  // like Govee rate-limit hard. So the UI updates instantly (optimistic) while the
  // network push is coalesced per device and sent on a trailing debounce. On/off
  // (and scene apply) push immediately — those are single, deliberate taps.
  const pushTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pushPending = useRef<Record<string, { patch: Partial<LightState>; transitionMs?: number }>>({});
  // When a device was last changed locally (setDevice). A fetch (loadStates) can
  // resolve after a local edit it raced against — without this, the stale fetched
  // value would silently overwrite what the user just set (or a vibe just applied).
  const lastLocalEdit = useRef<Record<string, number>>({});

  const flushPush = useCallback(
    async (deviceId: string) => {
      const entry = pushPending.current[deviceId];
      delete pushPending.current[deviceId];
      if (!entry) return;
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;
      const cred = credFor(device.sourceId);
      const conn = connectorFor(device.sourceId);
      if (!cred || !conn) return;
      try {
        await conn.setState(
          cred,
          device,
          entry.patch,
          entry.transitionMs ? { transitionMs: entry.transitionMs } : undefined
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach that light.");
      }
    },
    [devices, credFor]
  );

  // Set one device's state and optimistically reflect it. `immediate` (or an on/off
  // patch) pushes now; continuous changes (brightness/color) debounce.
  const setDevice = useCallback(
    (deviceId: string, patch: Partial<LightState>, immediate = false, transitionMs?: number) => {
      lastLocalEdit.current[deviceId] = Date.now();
      setStates((prev) => {
        const merged: LightState = { ...(prev[deviceId] ?? { on: true }), ...patch };
        // color and kelvin are mutually exclusive on a bulb — the last one set wins.
        if (patch.color !== undefined) delete merged.kelvin;
        if (patch.kelvin !== undefined) delete merged.color;
        return { ...prev, [deviceId]: merged };
      });
      const prevEntry = pushPending.current[deviceId];
      pushPending.current[deviceId] = {
        patch: { ...(prevEntry?.patch ?? {}), ...patch },
        transitionMs: transitionMs ?? prevEntry?.transitionMs,
      };
      clearTimeout(pushTimers.current[deviceId]);
      if (immediate || patch.on !== undefined) {
        void flushPush(deviceId);
      } else {
        pushTimers.current[deviceId] = setTimeout(() => void flushPush(deviceId), 220);
      }
    },
    [flushPush]
  );

  useEffect(() => {
    const timers = pushTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  // Save the current lights as a named vibe. Scoped to a room (roomId) it captures
  // only that room's lights; otherwise it captures the whole home.
  const saveScene = useCallback(
    async (name: string, roomId?: string) => {
      const targetIds = roomId
        ? (rooms.find((r) => r.id === roomId)?.deviceIds ?? [])
        : devices.map((d) => d.id);
      const snapshot: Record<string, LightState> = {};
      for (const id of targetIds) if (states[id]) snapshot[id] = states[id];
      const scene: StoredScene = {
        id: uid(),
        name: name.trim() || "Scene",
        createdAt: Date.now(),
        states: snapshot,
        ...(roomId ? { roomId } : {}),
      };
      await db.putScene(scene);
      setScenes((prev) => [...prev, scene]);
    },
    [devices, rooms, states]
  );

  // Recall a vibe: push each saved state back to its device (best-effort).
  const applyScene = useCallback(
    async (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      setError(null);
      for (const [deviceId, state] of Object.entries(scene.states)) {
        setDevice(deviceId, state, true, SCENE_TRANSITION_MS);
      }
    },
    [scenes, setDevice]
  );

  const removeScene = useCallback(async (id: string) => {
    await db.deleteScene(id);
    setScenes((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const renameScene = useCallback(async (id: string, name: string) => {
    setScenes((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s));
      const changed = next.find((s) => s.id === id);
      if (changed) void db.putScene(changed);
      return next;
    });
  }, []);

  // ---- rooms: named groups of devices in one physical place ---------------
  const createRoom = useCallback(async (name: string) => {
    const room: Room = { id: uid(), name: name.trim() || "Room", deviceIds: [], createdAt: Date.now() };
    await db.putRoom(room);
    setRooms((prev) => [...prev, room]);
  }, []);

  const renameRoom = useCallback(async (id: string, name: string) => {
    setRooms((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, name: name.trim() || r.name } : r));
      const room = next.find((r) => r.id === id);
      if (room) void db.putRoom(room);
      return next;
    });
  }, []);

  const removeRoom = useCallback(async (id: string) => {
    await db.deleteRoom(id); // devices in it simply become unassigned
    setRooms((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Move a device into a room (or out, roomId null). Persists every room the move
  // touched, since the device leaves its old room and joins the new one.
  const assignDevice = useCallback(async (deviceId: string, roomId: string | null) => {
    setRooms((prev) => {
      const next = assign(prev, deviceId, roomId);
      // Persist only rooms whose membership actually changed.
      const changed = next.filter((r, i) => r.deviceIds.join() !== prev[i].deviceIds.join());
      if (changed.length) void db.putRooms(changed);
      return next;
    });
  }, []);

  // Master control for a room: turn every light in it on or off at once.
  const setRoomPower = useCallback(
    (deviceIds: string[], on: boolean) => {
      for (const id of deviceIds) setDevice(id, { on }, true);
    },
    [setDevice]
  );

  // Master brightness for a room: a mixing-desk fader, not a flattener. Scales
  // every currently-on, dimmable light in the room by the same ratio, so a lamp
  // that was already dimmer than the others stays relatively dimmer — it moves
  // the room's existing character up or down rather than erasing it. Lights
  // that are off are left off; a brightness slider isn't "All on" in disguise.
  const setRoomBrightness = useCallback(
    (deviceIds: string[], target: number) => {
      const clamped = Math.max(1, Math.min(100, Math.round(target)));
      const on = deviceIds
        .map((id) => devices.find((d) => d.id === id))
        .filter((d): d is Device => !!d && d.canBrightness && !!states[d.id]?.on);
      if (!on.length) return;
      const avg = on.reduce((sum, d) => sum + (states[d.id]?.brightness ?? 100), 0) / on.length;
      for (const d of on) {
        const cur = states[d.id]?.brightness ?? 100;
        const next = avg > 0 ? Math.max(1, Math.min(100, Math.round(cur * (clamped / avg)))) : clamped;
        setDevice(d.id, { brightness: next });
      }
    },
    [devices, states, setDevice]
  );

  // Apply a shared vibe (from @lantern/core) to the lights. Each device takes what
  // it can of the vibe's target (brightness / color); the vibe stays medium-agnostic,
  // Aura renders it in light. Internal: no relay publish, so the relay subscription
  // below can call this directly without echoing a vibe right back out.
  const applyVibeInternal = useCallback(
    (vibeId: string, roomId?: string) => {
      // Resolve the light target from either a built-in (@lantern/core) or a
      // user-made custom vibe.
      const builtin = vibeById(vibeId);
      const custom = customVibes.find((c) => c.id === vibeId);
      const target: { brightness: number; rgb: Color; kelvin?: number } | null = builtin
        ? { brightness: builtin.light.brightness, rgb: builtin.light.rgb, kelvin: builtin.light.kelvin }
        : custom
          ? { brightness: custom.brightness, rgb: custom.rgb }
          : null;
      if (!target) return;
      const targetIds = roomId
        ? (rooms.find((r) => r.id === roomId)?.deviceIds ?? [])
        : devices.map((d) => d.id);
      // More than one light gets its own small, deterministic pull within the
      // vibe's palette (see palette.ts) — a room full of lamps at one identical
      // hue reads flat; the same warm family, slightly varied per fixture, reads
      // like a real room. A single light has nothing to vary against.
      const only = targetIds.length <= 1;
      for (const id of targetIds) {
        const device = devices.find((d) => d.id === id);
        if (!device) continue;
        const own = paletteVariant(target, device.id, only);
        const patch: Partial<LightState> = { on: true };
        if (device.canBrightness) patch.brightness = own.brightness;
        // Color bulbs take the vibe's hue; white-only bulbs take its temperature.
        if (device.canColor) patch.color = own.rgb;
        else if (device.canColorTemp && own.kelvin) patch.kelvin = own.kelvin;
        setDevice(id, patch, true, SCENE_TRANSITION_MS);
      }
    },
    [devices, rooms, customVibes, setDevice]
  );

  const relayRef = useRef<VibeRelayHandle | null>(null);

  // The local end of the cross-app vibe layer: apply here, and — if mirroring is
  // on — tell the relay too. Only built-in vibes travel (other apps only know the
  // shared @lantern/core vocabulary, not Aura's custom ones).
  const applyVibe = useCallback(
    (vibeId: string, roomId?: string) => {
      applyVibeInternal(vibeId, roomId);
      if (mirrorVibes && vibeById(vibeId)) relayRef.current?.publish({ vibeId, roomId });
    },
    [applyVibeInternal, mirrorVibes]
  );

  const setMirrorVibes = useCallback((on: boolean) => {
    setMirrorVibesState(on);
    try {
      localStorage.setItem("aura-vibe-mirror", on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  // Connect to the local relay only while mirroring is on; disconnect the moment
  // it's turned off. Incoming vibes apply whole-home — other apps don't know
  // Aura's room ids, so a foreign roomId wouldn't map to anything useful here.
  useEffect(() => {
    if (!mirrorVibes) return;
    const handle = connectVibeRelay("aura", (event) => applyVibeInternal(event.vibeId));
    relayRef.current = handle;
    return () => {
      handle.close();
      relayRef.current = null;
    };
  }, [mirrorVibes, applyVibeInternal]);

  const createCustomVibe = useCallback(async (label: string, rgb: Color, brightness: number) => {
    const v: CustomVibe = { id: uid(), label: label.trim() || "My vibe", rgb, brightness, createdAt: Date.now() };
    await db.putCustomVibe(v);
    setCustomVibes((prev) => [...prev, v]);
  }, []);

  const removeCustomVibe = useCallback(async (id: string) => {
    await db.deleteCustomVibe(id);
    setCustomVibes((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const updateCustomVibe = useCallback(
    async (id: string, label: string, rgb: Color, brightness: number) => {
      setCustomVibes((prev) => {
        const next = prev.map((v) =>
          v.id === id ? { ...v, label: label.trim() || v.label, rgb, brightness } : v
        );
        const changed = next.find((v) => v.id === id);
        if (changed) void db.putCustomVibe(changed);
        return next;
      });
    },
    []
  );

  // ---- automations: "when <trigger>, do <action>" -------------------------
  // Ask the OS for location, once, so sun-based triggers can be computed. Stored
  // in localStorage (coarse coordinates, not a secret); only requested on demand.
  const requestLocation = useCallback((): Promise<Coords | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          try {
            localStorage.setItem(GEO_KEY, JSON.stringify(c));
          } catch {
            /* private mode */
          }
          setCoords(c);
          resolve(c);
        },
        () => resolve(null),
        { maximumAge: 6 * 3600_000, timeout: 10_000 }
      );
    });
  }, []);

  // A gentle brightness ramp over minutes (wake-up / wind-down). Runs while the app
  // is open, stepping every 20s; fading to 0 turns the lights off at the end.
  const statesRef = useRef(states);
  statesRef.current = states;
  const activeFades = useRef<ReturnType<typeof setInterval>[]>([]);
  const startFade = useCallback(
    (action: Extract<Action, { kind: "fade" }>) => {
      const ids = (action.roomId ? (rooms.find((r) => r.id === action.roomId)?.deviceIds ?? []) : devices.map((d) => d.id)).filter(
        (id) => devices.find((d) => d.id === id)?.canBrightness
      );
      if (!ids.length) return;
      const to = Math.max(0, Math.min(100, action.toBrightness));
      const cur = statesRef.current;
      const starts: Record<string, number> = {};
      for (const id of ids) {
        starts[id] = cur[id]?.on ? (cur[id]?.brightness ?? 100) : 0;
        if (to > 0) setDevice(id, { on: true, brightness: Math.max(1, Math.round(starts[id] || 1)) }, true);
      }
      const stepMs = 20_000;
      const steps = Math.max(1, Math.min(120, Math.round((action.minutes * 60_000) / stepMs)));
      let i = 0;
      const timer = setInterval(() => {
        i++;
        const done = i >= steps;
        for (const id of ids) {
          const b = Math.round(starts[id] + (to - starts[id]) * (i / steps));
          if (done && to <= 0) setDevice(id, { on: false }, true);
          else setDevice(id, { brightness: Math.max(1, Math.min(100, b)) }, true);
        }
        if (done) {
          clearInterval(timer);
          activeFades.current = activeFades.current.filter((t) => t !== timer);
        }
      }, stepMs);
      activeFades.current.push(timer);
    },
    [devices, rooms, setDevice]
  );
  useEffect(() => () => activeFades.current.forEach(clearInterval), []);

  // "Which one is this?" — a few quick bright/dim pulses (or on/off, for a
  // fixture with no brightness control), then back to exactly whatever it was
  // showing before. Works identically for every brand: it's just setDevice
  // calls any connector already understands, no brand-specific "identify" API
  // required. One at a time — a device id already mid-pulse is left alone.
  const [identifying, setIdentifying] = useState<string | null>(null);
  const identifyDevice = useCallback(
    async (deviceId: string) => {
      if (identifying) return;
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;
      setIdentifying(deviceId);
      const original = statesRef.current[deviceId] ?? { on: false };
      const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      try {
        for (let i = 0; i < 3; i++) {
          if (device.canBrightness) {
            setDevice(deviceId, { on: true, brightness: 100 }, true);
            await wait(450);
            setDevice(deviceId, { on: true, brightness: 8 }, true);
            await wait(450);
          } else {
            setDevice(deviceId, { on: true }, true);
            await wait(400);
            setDevice(deviceId, { on: false }, true);
            await wait(400);
          }
        }
      } finally {
        setDevice(deviceId, original, true);
        setIdentifying(null);
      }
    },
    [devices, setDevice, identifying]
  );

  // Your own name for a light — a display-only override, never pushed to the
  // brand (Govee/HA don't reliably support renaming anyway, and Aura isn't the
  // source of truth for your devices). An empty name resets back to the brand's
  // own name rather than storing an empty string.
  const renameDevice = useCallback(async (deviceId: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      await db.putDeviceName(deviceId, trimmed);
      setDeviceNames((prev) => ({ ...prev, [deviceId]: trimmed }));
    } else {
      await db.deleteDeviceName(deviceId);
      setDeviceNames((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
    }
  }, []);

  const runAction = useCallback(
    (action: Action) => {
      if (action.kind === "scene") applyScene(action.sceneId);
      else if (action.kind === "allOff") setRoomPower(devices.map((d) => d.id), false);
      else if (action.kind === "fade") startFade(action);
      else if (action.kind === "roomPower") {
        const room = rooms.find((r) => r.id === action.roomId);
        if (room) setRoomPower(room.deviceIds, action.on);
      }
    },
    [applyScene, setRoomPower, startFade, devices, rooms]
  );

  const addAutomation = useCallback(
    async (name: string, trigger: Trigger, actions: Action[], days?: number[]) => {
      const a: Automation = {
        id: uid(),
        name: name.trim() || "Automation",
        enabled: true,
        trigger,
        actions,
        ...(days && days.length ? { days } : {}),
      };
      await db.putAutomation(a);
      setAutomations((prev) => [...prev, a].sort((x, y) => x.name.localeCompare(y.name)));
    },
    []
  );

  const toggleAutomation = useCallback(async (id: string) => {
    setAutomations((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a));
      const changed = next.find((a) => a.id === id);
      if (changed) void db.putAutomation(changed);
      return next;
    });
  }, []);

  const removeAutomation = useCallback(async (id: string) => {
    await db.deleteAutomation(id);
    setAutomations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // The scheduler. A pure PWA can only fire while it's running, so this is a plain
  // interval over the pure `dueAutomations` check; a Tauri background process can
  // later drive the same check while the window is closed. Refs keep the ticker
  // stable while reading the latest automations/coords/action-runner each tick.
  const autoRef = useRef(automations);
  autoRef.current = automations;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const runRef = useRef(runAction);
  runRef.current = runAction;

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const due = dueAutomations(autoRef.current, now, coordsRef.current);
      if (!due.length) return;
      const stamp = ymd(now);
      for (const a of due) {
        for (const act of actionsOf(a)) runRef.current(act);
        const updated = { ...a, lastRun: stamp };
        void db.putAutomation(updated);
        setAutomations((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // ---- portability: move your setup between devices (no account) ----------
  // Exports rooms/scenes/vibes/automations/your renamed lights. Credentials are
  // included only when `includeAccounts` is explicitly true (the QR "set up from
  // phone" flow asks first, in plain words, before doing that) — the default,
  // file-based export still holds no keys: device ids are stable per physical
  // light/bridge, so on a new device you re-pair your lights and everything else
  // lines back up. `compact` drops the pretty-printing so a QR code has the best
  // chance of fitting the whole payload.
  const exportSetup = useCallback(
    (includeAccounts = false, compact = false) =>
      JSON.stringify(
        {
          app: "aura",
          version: 1,
          exportedAt: new Date().toISOString(),
          rooms,
          scenes,
          customVibes,
          automations,
          deviceNames,
          ...(includeAccounts ? { sources } : {}),
        },
        null,
        compact ? undefined : 2
      ),
    [rooms, scenes, customVibes, automations, deviceNames, sources]
  );

  const importSetup = useCallback(
    async (text: string): Promise<{ ok: boolean; error?: string }> => {
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, error: "That doesn't look like a setup file or code." };
      }
      if (data?.app !== "aura" || !data.version) {
        return { ok: false, error: "That doesn't look like an Aura setup file or code." };
      }
      try {
        const rms: Room[] = Array.isArray(data.rooms) ? data.rooms : [];
        const scns: StoredScene[] = Array.isArray(data.scenes) ? data.scenes : [];
        const cvs: CustomVibe[] = Array.isArray(data.customVibes) ? data.customVibes : [];
        const autos: Automation[] = Array.isArray(data.automations) ? data.automations : [];
        const names: Record<string, string> =
          data.deviceNames && typeof data.deviceNames === "object" ? data.deviceNames : {};
        await db.putRooms(rms);
        for (const s of scns) await db.putScene(s);
        for (const v of cvs) await db.putCustomVibe(v);
        for (const a of autos) await db.putAutomation(a);
        for (const [id, name] of Object.entries(names)) await db.putDeviceName(id, name);
        setRooms((prev) => mergeById(prev, rms));
        setScenes((prev) => mergeById(prev, scns).sort((a, b) => a.createdAt - b.createdAt));
        setCustomVibes((prev) => mergeById(prev, cvs).sort((a, b) => a.createdAt - b.createdAt));
        setAutomations((prev) => mergeById(prev, autos).sort((a, b) => a.name.localeCompare(b.name)));
        if (Object.keys(names).length) setDeviceNames((prev) => ({ ...prev, ...names }));

        // A transferred account (only present when the sender chose to include
        // it) is re-validated the same way a fresh connect is — never trusted
        // blindly — which also repopulates that source's devices and states.
        const sourceErrors: string[] = [];
        if (Array.isArray(data.sources)) {
          for (const s of data.sources) {
            if (!s?.id || typeof s.cred !== "string") continue;
            const err = await connect(s.id, s.cred);
            if (err) sourceErrors.push(`${s.id}: ${err}`);
          }
        }
        return sourceErrors.length
          ? { ok: true, error: `Imported, but couldn't reconnect: ${sourceErrors.join("; ")}` }
          : { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
      }
    },
    [connect]
  );

  // Sensor poller: watch each motion sensor and fire on the *edge* — the moment
  // motion starts — not for as long as it keeps seeing you. Sensor automations use a
  // cooldown rather than the once-a-day dedupe that timed ones use.
  const sensorsRef = useRef(sensors);
  sensorsRef.current = sensors;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const prevMotion = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const tick = async () => {
      for (const sensor of sensorsRef.current) {
        const conn = connectorFor(sensor.sourceId);
        const cred = sourcesRef.current.find((s) => s.id === sensor.sourceId)?.cred;
        if (!conn?.readSensor || cred === undefined) continue;
        let motion = false;
        try {
          motion = (await conn.readSensor(cred, sensor)).motion;
        } catch {
          continue; // an unreachable sensor shouldn't stop the others
        }
        const was = prevMotion.current[sensor.id] ?? false;
        prevMotion.current[sensor.id] = motion;
        if (was || !motion) continue; // only the false → true edge

        const now = new Date();
        for (const a of sensorDue(autoRef.current, sensor.id, now)) {
          for (const act of actionsOf(a)) runRef.current(act);
          const updated = { ...a, lastFiredAt: now.getTime() };
          void db.putAutomation(updated);
          setAutomations((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
        }
      }
    };
    const id = setInterval(() => void tick(), 5_000);
    return () => clearInterval(id);
  }, []);

  // Make the demo sensor "see" motion, so sensor automations can be felt with no
  // hardware.
  const simulateMotion = useCallback(() => simulateDemoMotion(), []);

  // Adaptive (circadian) white: nudge tunable-white bulbs toward the day's natural
  // temperature every few minutes. Leaves color bulbs showing a color alone, and
  // never turns a light on — it just shapes the whites already in use.
  const setAdaptive = useCallback((on: boolean) => {
    setAdaptiveState(on);
    try {
      localStorage.setItem("aura-adaptive", on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  useEffect(() => {
    if (!adaptive) return;
    const apply = () => {
      const k = adaptiveKelvin(new Date(), coordsRef.current);
      for (const d of devicesRef.current) {
        if (!d.canColorTemp) continue;
        const st = statesRef.current[d.id];
        if (!st?.on) continue;
        if (d.canColor && st.kelvin === undefined) continue; // in color mode — leave it
        if (st.kelvin !== undefined && Math.abs(st.kelvin - k) < 60) continue; // already close
        setDevice(d.id, { kelvin: k }, true);
      }
    };
    apply();
    const id = setInterval(apply, 5 * 60_000);
    return () => clearInterval(id);
  }, [adaptive, setDevice]);

  const connected = useMemo(() => sources.length > 0, [sources]);

  // Everything downstream (DeviceList, Rooms, automations, the vibe engine) reads
  // devices through here, so a rename shows up everywhere at once without having
  // to thread deviceNames through every consumer individually. Internal logic
  // above (applyVibe, identify, palette variation, …) intentionally still closes
  // over the raw `devices` state — names are a display concern only, never part
  // of any control decision.
  const displayDevices = useMemo(
    () => (Object.keys(deviceNames).length ? devices.map((d) => (deviceNames[d.id] ? { ...d, name: deviceNames[d.id] } : d)) : devices),
    [devices, deviceNames]
  );

  return {
    sources, devices: displayDevices, sensors, scenes, rooms, automations, customVibes, coords, states, busy, error, connected,
    connect, disconnect, refresh, setDevice, saveScene, applyScene, removeScene,
    createRoom, renameRoom, removeRoom, assignDevice, setRoomPower, setRoomBrightness, renameDevice,
    requestLocation, addAutomation, toggleAutomation, removeAutomation,
    applyVibe, createCustomVibe, removeCustomVibe, updateCustomVibe, renameScene,
    exportSetup, importSetup, adaptive, setAdaptive, simulateMotion,
    mirrorVibes, setMirrorVibes, identifyDevice, identifying,
  };
}

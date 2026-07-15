// useAura.ts
// The one place state and IO meet. Holds the connected sources, the devices, their
// live states, and your scenes — and routes every control through the right brand
// connector. No decrypted key here (Aura has no vault); just the API credentials.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as db from "../lib/db";
import { connectorFor, type Device, type LightState } from "../lib/connectors";
import { assign, type Room } from "../lib/rooms";
import type { StoredScene, StoredSource } from "../lib/db";

const uid = () => crypto.randomUUID();

export function useAura() {
  const [sources, setSources] = useState<StoredSource[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scenes, setScenes] = useState<StoredScene[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
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
      for (const r of results) if (r.status === "fulfilled" && r.value) next[r.value[0]] = r.value[1];
      return next;
    });
  }, []);

  useEffect(() => {
    (async () => {
      const [srcs, devs, scns, rms] = await Promise.all([
        db.allSources(),
        db.allDevices(),
        db.allScenes(),
        db.allRooms(),
      ]);
      setSources(srcs);
      setDevices(devs);
      setScenes(scns.sort((a, b) => a.createdAt - b.createdAt));
      setRooms(rms);
      if (devs.length) void loadStates(devs, srcs);
    })();
  }, [loadStates]);

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
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't connect that source.";
      } finally {
        setBusy(false);
      }
    },
    [sources, devices, loadStates]
  );

  const disconnect = useCallback(async (sourceId: string) => {
    await db.deleteSource(sourceId);
    await db.deleteDevicesForSource(sourceId);
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
    setDevices((prev) => prev.filter((d) => d.sourceId !== sourceId));
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
  const pushPending = useRef<Record<string, Partial<LightState>>>({});

  const flushPush = useCallback(
    async (deviceId: string) => {
      const patch = pushPending.current[deviceId];
      delete pushPending.current[deviceId];
      if (!patch) return;
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;
      const cred = credFor(device.sourceId);
      const conn = connectorFor(device.sourceId);
      if (!cred || !conn) return;
      try {
        await conn.setState(cred, device, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach that light.");
      }
    },
    [devices, credFor]
  );

  // Set one device's state and optimistically reflect it. `immediate` (or an on/off
  // patch) pushes now; continuous changes (brightness/color) debounce.
  const setDevice = useCallback(
    (deviceId: string, patch: Partial<LightState>, immediate = false) => {
      setStates((prev) => ({ ...prev, [deviceId]: { ...(prev[deviceId] ?? { on: true }), ...patch } }));
      pushPending.current[deviceId] = { ...(pushPending.current[deviceId] ?? {}), ...patch };
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

  // Save the current lights as a named vibe.
  const saveScene = useCallback(
    async (name: string) => {
      const snapshot: Record<string, LightState> = {};
      for (const d of devices) if (states[d.id]) snapshot[d.id] = states[d.id];
      const scene: StoredScene = { id: uid(), name: name.trim() || "Scene", createdAt: Date.now(), states: snapshot };
      await db.putScene(scene);
      setScenes((prev) => [...prev, scene]);
    },
    [devices, states]
  );

  // Recall a vibe: push each saved state back to its device (best-effort).
  const applyScene = useCallback(
    async (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      setError(null);
      for (const [deviceId, state] of Object.entries(scene.states)) {
        setDevice(deviceId, state, true);
      }
    },
    [scenes, setDevice]
  );

  const removeScene = useCallback(async (id: string) => {
    await db.deleteScene(id);
    setScenes((prev) => prev.filter((s) => s.id !== id));
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

  const connected = useMemo(() => sources.length > 0, [sources]);

  return {
    sources, devices, scenes, rooms, states, busy, error, connected,
    connect, disconnect, refresh, setDevice, saveScene, applyScene, removeScene,
    createRoom, renameRoom, removeRoom, assignDevice, setRoomPower,
  };
}

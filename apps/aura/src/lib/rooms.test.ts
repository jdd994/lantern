import { describe, expect, it } from "vitest";
import { assign, comboLabel, effectiveDeviceIds, groupByRoom, isCombo, type Room } from "./rooms";
import type { Device } from "./connectors";

const dev = (id: string): Device => ({
  id,
  name: id,
  sourceId: "demo",
  canBrightness: true,
  canColor: false,
  canColorTemp: false,
  raw: {},
});

const room = (id: string, deviceIds: string[], createdAt: number): Room => ({
  id,
  name: id,
  deviceIds,
  createdAt,
});

const combo = (id: string, memberRoomIds: string[], createdAt: number): Room => ({
  id,
  name: id,
  deviceIds: [],
  createdAt,
  memberRoomIds,
});

describe("assign", () => {
  it("adds a device to the target room", () => {
    const rooms = [room("living", [], 1)];
    expect(assign(rooms, "lamp", "living")[0].deviceIds).toEqual(["lamp"]);
  });

  it("moves a device out of its old room (never in two)", () => {
    const rooms = [room("living", ["lamp"], 1), room("yard", [], 2)];
    const next = assign(rooms, "lamp", "yard");
    expect(next.find((r) => r.id === "living")!.deviceIds).toEqual([]);
    expect(next.find((r) => r.id === "yard")!.deviceIds).toEqual(["lamp"]);
  });

  it("unassigns when roomId is null", () => {
    const rooms = [room("living", ["lamp"], 1)];
    expect(assign(rooms, "lamp", null)[0].deviceIds).toEqual([]);
  });

  it("does not duplicate an already-present device", () => {
    const rooms = [room("living", ["lamp"], 1)];
    expect(assign(rooms, "lamp", "living")[0].deviceIds).toEqual(["lamp"]);
  });
});

describe("groupByRoom", () => {
  it("groups devices under rooms in creation order", () => {
    const devices = [dev("a"), dev("b"), dev("c")];
    const rooms = [room("yard", ["c"], 2), room("living", ["a"], 1)];
    const sections = groupByRoom(devices, rooms);
    expect(sections.map((s) => s.room?.id ?? "∅")).toEqual(["living", "yard", "∅"]);
    expect(sections[0].devices.map((d) => d.id)).toEqual(["a"]);
    expect(sections[2].devices.map((d) => d.id)).toEqual(["b"]); // unassigned
  });

  it("keeps an empty room visible but omits the unassigned bucket when all are placed", () => {
    const devices = [dev("a")];
    const rooms = [room("living", ["a"], 1), room("empty", [], 2)];
    const sections = groupByRoom(devices, rooms);
    expect(sections.map((s) => s.room?.id ?? "∅")).toEqual(["living", "empty"]);
    expect(sections[1].devices).toEqual([]);
  });

  it("ignores stale device ids that no longer exist", () => {
    const devices = [dev("a")];
    const rooms = [room("living", ["a", "ghost"], 1)];
    expect(groupByRoom(devices, rooms)[0].devices.map((d) => d.id)).toEqual(["a"]);
  });

  it("shows a combo room's devices as the union of its member rooms, alongside those rooms unchanged", () => {
    const devices = [dev("a"), dev("b"), dev("c")];
    const rooms = [
      room("kitchen", ["a"], 1),
      room("living", ["b"], 2),
      room("dining", ["c"], 3),
      combo("open-concept", ["kitchen", "living", "dining"], 4),
    ];
    const sections = groupByRoom(devices, rooms);
    expect(sections.map((s) => s.room?.id)).toEqual(["kitchen", "living", "dining", "open-concept"]);
    expect(sections[0].devices.map((d) => d.id)).toEqual(["a"]); // kitchen untouched
    expect(sections[3].devices.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
    // No unassigned bucket — the combo's sharing doesn't affect assignment.
    expect(sections.some((s) => s.room === null)).toBe(false);
  });

  it("a combo picks up a device added to a member room later (live, not a snapshot)", () => {
    const devices = [dev("a"), dev("b")];
    const rooms = [room("kitchen", ["a"], 1), combo("open-concept", ["kitchen"], 2)];
    const comboSection = (rms: Room[]) => groupByRoom(devices, rms).find((s) => s.room?.id === "open-concept")!;
    expect(comboSection(rooms).devices.map((d) => d.id)).toEqual(["a"]);

    const updated = assign(rooms, "b", "kitchen");
    expect(comboSection(updated).devices.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("skips a member room that no longer exists instead of erroring", () => {
    const devices = [dev("a")];
    const rooms = [room("kitchen", ["a"], 1), combo("open-concept", ["kitchen", "ghost-room"], 2)];
    const comboSection = groupByRoom(devices, rooms).find((s) => s.room?.id === "open-concept")!;
    expect(comboSection.devices.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("effectiveDeviceIds", () => {
  it("returns a literal room's own deviceIds unchanged", () => {
    const rooms = [room("living", ["a", "b"], 1)];
    expect(effectiveDeviceIds(rooms[0], rooms)).toEqual(["a", "b"]);
  });

  it("de-duplicates when member rooms overlap", () => {
    const rooms = [room("kitchen", ["a", "b"], 1), room("living", ["b", "c"], 2), combo("combo", ["kitchen", "living"], 3)];
    expect(effectiveDeviceIds(rooms[2], rooms).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("isCombo / comboLabel", () => {
  it("identifies combo vs literal rooms", () => {
    expect(isCombo(room("living", [], 1))).toBe(false);
    expect(isCombo(combo("combo", ["living"], 1))).toBe(true);
  });

  it("joins member room names for display, skipping any that no longer exist", () => {
    const rooms = [room("kitchen", [], 1), room("living", [], 2), combo("combo", ["kitchen", "living", "ghost"], 3)];
    expect(comboLabel(rooms[2], rooms)).toBe("kitchen + living");
    expect(comboLabel(rooms[0], rooms)).toBe("");
  });
});

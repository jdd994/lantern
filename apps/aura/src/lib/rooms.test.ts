import { describe, expect, it } from "vitest";
import { assign, groupByRoom, type Room } from "./rooms";
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
});

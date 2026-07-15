// rooms.ts — pure, IO-free room logic. A room is a named group of devices in one
// physical place (Living room, Backyard). A device belongs to at most one room; the
// assignment lives on the room (not the device) so it survives a device-cache
// refresh. Grouping + reassignment are pure functions, unit-tested in rooms.test.ts.
import type { Device } from "./connectors";

export type Room = { id: string; name: string; deviceIds: string[]; createdAt: number };

// A rendered group for the home screen. room === null is the "everything else" bucket.
export type RoomSection = { room: Room | null; devices: Device[] };

// Move a device into `roomId` (or out of every room when null), returning updated
// rooms. Always removes it from any other room first, so a device is never in two.
export function assign(rooms: Room[], deviceId: string, roomId: string | null): Room[] {
  return rooms.map((r) => {
    const without = r.deviceIds.filter((id) => id !== deviceId);
    return r.id === roomId ? { ...r, deviceIds: [...without, deviceId] } : { ...r, deviceIds: without };
  });
}

// Group live devices under their rooms (in creation order), with any unassigned
// devices collected into a trailing null-room section. Rooms with no live devices
// still appear (so an empty room you just made isn't invisible); the unassigned
// section only appears when something is actually unassigned.
export function groupByRoom(devices: Device[], rooms: Room[]): RoomSection[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const claimed = new Set<string>();
  const sections: RoomSection[] = [];

  for (const room of [...rooms].sort((a, b) => a.createdAt - b.createdAt)) {
    const roomDevices: Device[] = [];
    for (const id of room.deviceIds) {
      const d = byId.get(id);
      if (d) {
        roomDevices.push(d);
        claimed.add(id);
      }
    }
    sections.push({ room, devices: roomDevices });
  }

  const unassigned = devices.filter((d) => !claimed.has(d.id));
  if (unassigned.length) sections.push({ room: null, devices: unassigned });
  return sections;
}

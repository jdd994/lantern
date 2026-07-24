// rooms.ts — pure, IO-free room logic. A (literal) room is a named group of
// devices in one physical place (Living room, Backyard). A device belongs to
// at most one *literal* room; the assignment lives on the room (not the
// device) so it survives a device-cache refresh.
//
// A room can also be a **combo**: instead of its own deviceIds, it names other
// rooms (memberRoomIds) and its effective devices are the live union of
// theirs — see effectiveDeviceIds. This is for spatially-open areas (open
// concept kitchen/living/dining) you sometimes want to control together and
// sometimes separately: the literal rooms stay exactly as they are, exclusive
// and unaffected, and a combo is just another room alongside them that
// happens to share their lights. Live, not a snapshot — add a lamp to Kitchen
// later and any combo built from Kitchen picks it up for free. Deliberately
// one level deep only (a combo can't combine another combo): keeps this
// simple and sidesteps cycle detection entirely.
//
// Grouping + reassignment are pure functions, unit-tested in rooms.test.ts.
import type { Device } from "./connectors";

export type Room = {
  id: string;
  name: string;
  deviceIds: string[];
  createdAt: number;
  memberRoomIds?: string[];
};

// A rendered group for the home screen. room === null is the "everything else" bucket.
export type RoomSection = { room: Room | null; devices: Device[] };

export function isCombo(room: Room): boolean {
  return !!room.memberRoomIds?.length;
}

// Move a device into `roomId` (or out of every room when null), returning updated
// rooms. Always removes it from any other room first, so a device is never in two.
// A combo room has no deviceIds of its own, so it's simply never touched here.
export function assign(rooms: Room[], deviceId: string, roomId: string | null): Room[] {
  return rooms.map((r) => {
    if (isCombo(r)) return r;
    const without = r.deviceIds.filter((id) => id !== deviceId);
    return r.id === roomId ? { ...r, deviceIds: [...without, deviceId] } : { ...r, deviceIds: without };
  });
}

// A room's actual device ids: its own list for a literal room, or — for a
// combo — the live union of its member rooms' own lists (member rooms that no
// longer exist are just skipped, not an error).
export function effectiveDeviceIds(room: Room, allRooms: Room[]): string[] {
  if (!isCombo(room)) return room.deviceIds;
  const seen = new Set<string>();
  for (const id of room.memberRoomIds!) {
    const member = allRooms.find((r) => r.id === id);
    if (member) for (const deviceId of member.deviceIds) seen.add(deviceId);
  }
  return [...seen];
}

// A combo's member-room names, joined for display ("Kitchen + Living room").
// Empty for a literal room.
export function comboLabel(room: Room, allRooms: Room[]): string {
  if (!isCombo(room)) return "";
  return room
    .memberRoomIds!.map((id) => allRooms.find((r) => r.id === id)?.name)
    .filter((n): n is string => !!n)
    .join(" + ");
}

// Group live devices under their rooms (in creation order), with any unassigned
// devices collected into a trailing null-room section. Rooms with no live devices
// still appear (so an empty room you just made isn't invisible); the unassigned
// section only appears when something is actually unassigned. A device inside a
// combo room's union also still appears in its own literal room's section — that
// duplication is the point, not a bug — but only literal membership counts
// toward "unassigned", so a combo can never make an actually-unassigned device
// look assigned.
export function groupByRoom(devices: Device[], rooms: Room[]): RoomSection[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const claimed = new Set<string>();
  const sections: RoomSection[] = [];

  for (const room of [...rooms].sort((a, b) => a.createdAt - b.createdAt)) {
    const roomDevices: Device[] = [];
    for (const id of effectiveDeviceIds(room, rooms)) {
      const d = byId.get(id);
      if (d) {
        roomDevices.push(d);
        if (!isCombo(room)) claimed.add(id);
      }
    }
    sections.push({ room, devices: roomDevices });
  }

  const unassigned = devices.filter((d) => !claimed.has(d.id));
  if (unassigned.length) sections.push({ room: null, devices: unassigned });
  return sections;
}

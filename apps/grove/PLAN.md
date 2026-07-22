# Grove — plan

> Named 2026-07-22. A grove looks like many trees but shares one root system
> (Pando: tens of thousands of trunks, one organism) — a family. The name
> centers the co-authored, living, underground connection: private, unseen,
> load-bearing (Tao Te Ching ch. 11 — the absence does the work; ch. 59 —
> "deep roots and a firm trunk" seeded the search). In the five elements the
> family's apps are fire and water; Grove brings wood — the element of family
> and growth — and wood feeds fire.

## What this is

Grove is a private, end-to-end-encrypted **family tree the family writes
together** — the genealogy flavor of the lantern soul. People, the bonds
between them, and the keepsakes that carry their memory: photos, scanned
letters, documents, stories.

It is the likely realization of the "private co-authored family memory keeper"
vision: the tree is the map, the keepsakes and stories are the treasure.

## North star filter

Commercial genealogy is collection gameplay — hint leaves, record counts,
"12,847 people in your tree!" — comparison and extraction in period costume.
This app inverts it:

- **Stories over records.** Dates are scaffolding; what the family *remembers*
  about a person is the point. Every person is a doorway, not a checkbox.
- **No counts, no completeness meters, no hints-as-dopamine.** Ever.
- **Evidence as keepsake, not as score.** A scanned letter is a treasure your
  grandmother touched, presented as itself — not "1 source attached."

## Why its own app (not a Driftless feature)

Driftless's primary object is the *moment* (a stream, gathered into strands).
Here the primary object is the *person*, and the structure is a graph walked
generationally, not chronologically. Same reasoning that made Ballast and
Hearth separate apps: different primary object, different information
architecture, same core underneath.

The bridge: a tree-person is a natural **anchor**, exactly like a #tag in
Driftless. Tap Grandma on the tree → the moments and stories that mention her
gather. (Future: Driftless learns a person-anchor that references a tree
person id.)

## Data model

Four kinds, each an encrypted record synced by the existing engine
(`@lantern/core/sync`, LWW by `updatedAt`, tombstones). Everything meaningful
lives inside the ciphertext; only timestamps ride as plaintext, same trade as
Driftless today.

| kind       | what it is | notes |
|------------|-----------|-------|
| `person`   | a node: names, birth/death events, a freeform *remembrance*, portrait | one sub-document per person so co-edit conflicts stay local to that person |
| `union`    | a partnership: partner ids, typed child links, marriage events | mirrors GEDCOM's FAM record, so import/export maps cleanly |
| `keepsake` | evidence & treasure: an encrypted media blob (photo / letter / document scan) + caption + transcription + the people it's about | media rides the already-built `MediaBlob` object-storage path |
| (meta)     | tree-level record: title, member roles | analog of the shared-strand meta record |

Fuzzy time is a first-class citizen: the `When` type is Driftless's `Anchor`
(epoch + precision + free-text era) extended with a genealogy `qualifier`
("about" / "before" / "after") — because "b. abt. 1885" is the normal case,
not the edge case.

Child links are typed (`birth | adoptive | step | foster | guardian`) —
families are made in more than one way and the model should say so plainly.

## Sharing model

Reuses the shared-strand machinery: a tree has a DEK, wrapped per member with
the existing invite flow (`@lantern/core/sharing`). Every member reads and
writes every record; records carry `author` for attribution.

**The never-silently-dropped rule, generalized:** shared strands guarantee a
piece omitted by a racing order-record still appears. Here: any person no
union references still renders, on an "unplaced" shelf — a relative someone
added is never invisible because the linking write lost a race.

Solo-first, like everything else in the family: build your tree alone with no
account; the account appears when you sync or invite.

## Living people who aren't users

Uncle Dave never consented to being in a database. E2E answers most of it —
plaintext never exists off the family's devices — but the deliberate stance
(spirit of the sensors-and-consent principle):

- `living: true` people get **minimal entries by default** — enriched when
  they join and co-author themselves.
- GEDCOM **export privatizes living people by default** (standard genealogy
  ethics, here enforced rather than suggested).

## Portability

GEDCOM import/export from day one — the informed-trade-offs principle applied:
the family's history is portable, never hostage, and it's the honest on-ramp
for someone arriving from Ancestry with twenty years of research.
Mapping: `INDI ↔ person`, `FAM ↔ union`, `OBJE/SOUR ↔ keepsake`.

## Later, deliberately

- **Digital legacy.** A genealogy app is inherently about mortality; the
  built K-of-N guardian system is already the answer to "what happens to a
  vault when its keeper dies." The tree is where that passing-down naturally
  lives. Design with love, not as a feature checkbox.
- **Driftless person-anchors** (the bridge above).
- Tree layout/visualization — start with the humblest thing that works
  (a person page + parent/partner/child links), not a zoomable canvas.

## Build order

1. **Pure domain lib** (`src/lib/model.ts`) — types, encrypted-payload codecs,
   kin-walking helpers, lifespan formatting. Unit-tested, IO-free. ← *started*
2. Local vault + IndexedDB stores, mirroring Driftless `db.ts`/hook shape.
3. The humble UI: person page, add-relative flow, keepsake attach.
4. Sync + sharing (compose the existing engine + invite flow).
5. GEDCOM import/export.

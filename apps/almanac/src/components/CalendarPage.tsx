// CalendarPage.tsx — one circle's calendar, open on the table. What's coming
// up top under month headings; the wake — where plans go after they've
// happened — settled below, most recent first. Memory, not deletion.
//
// The mark chip is the soul of the shared case: nobody is invited to a
// happening and nobody is pending. The plan is lit; a person says "I'm in."
// The only mark the app will ever write is your own. Silence stays silent —
// no maybe, no declined, no "3 haven't answered".
//
// Every happening offers itself as an .ics, generated on this device — the
// handshake with the friends who live in Google or Apple Calendar. The file
// is made locally and handed over; no service is ever told.

import { useEffect, useState } from "react";
import { displayName, formatWhen, groupByMonth, splitAgenda, whoIsIn, type Calendar, type Happening, type Mark, type Profile } from "../lib/model";
import { toICS } from "../lib/ics";
import type { SharedCalendar } from "../hooks/useAlmanac";
import { Again, CalendarDown, Pencil, ShareOut } from "./icons";
import { HappeningForm, type HappeningDraft } from "./HappeningForm";

// data: URL, not blob: — the CSP-safe download pattern shared with the siblings.
function downloadICS(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(text)}`;
  a.download = filename;
  a.click();
}

// The plan as one line of plain text — for the group chat where it'll be
// talked about anyway. Native share sheet when there is one, clipboard when
// there isn't. Made on-device, like everything.
function planAsText(h: Happening): string {
  const bits = [h.title || "A plan", formatWhen(h)];
  if (h.place) bits.push(h.place);
  if (h.link) bits.push(h.link);
  return bits.join(" — ");
}

async function sharePlanText(h: Happening): Promise<"shared" | "copied" | "no"> {
  const text = planAsText(h);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch {
      return "no"; // dismissed — not an error, not a fallback moment
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "no";
  }
}

function HappeningRow({
  h,
  marks,
  profiles,
  account,
  isShared,
  onSetMark,
  onEdit,
  onSameAgain,
  onRemove,
}: {
  h: Happening;
  marks: Mark[];
  profiles: Profile[];
  account: string | null;
  isShared: boolean;
  onSetMark: (h: Happening, mine: boolean) => void;
  onEdit: () => void;
  onSameAgain: () => void;
  onRemove: () => void;
}) {
  const who = whoIsIn(h.id, marks);
  const mine = !!account && who.includes(account);
  const others = account ? who.filter((w) => w !== account) : who;
  const [confirming, setConfirming] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  async function shareText() {
    const res = await sharePlanText(h);
    if (res === "copied") {
      setShareNote("Copied");
      setTimeout(() => setShareNote(null), 1500);
    }
  }

  return (
    <div className="hap-card">
      <div className="hap-card-head">
        <span className="hap-when">{formatWhen(h)}</span>
        <span className="hap-tools">
          {shareNote ? <span className="hap-sharenote">{shareNote}</span> : null}
          <button className="item-x" onClick={() => void shareText()} title="Share as text — for the group chat" aria-label={`Share ${h.title} as text`}>
            <ShareOut />
          </button>
          <button
            className="item-x"
            onClick={() => downloadICS(`${(h.title || "plan").replace(/[^\w-]+/g, "-").toLowerCase()}.ics`, toICS([h], Date.now()))}
            title="Download for your calendar app (.ics)"
            aria-label={`Download ${h.title} for your calendar app`}
          >
            <CalendarDown />
          </button>
          <button className="item-x" onClick={onSameAgain} title="Same again — a fresh copy for a new day" aria-label={`Plan ${h.title} again`}>
            <Again />
          </button>
          <button className="item-x" onClick={onEdit} aria-label={`Amend ${h.title}`} title="Amend">
            <Pencil />
          </button>
          <button className="item-x" onClick={() => setConfirming(true)} aria-label={`Remove ${h.title}`} title="Remove">×</button>
        </span>
      </div>
      {confirming ? (
        <div className="hap-confirm">
          <span className="hint" style={{ margin: 0 }}>
            {isShared ? "Remove this plan for everyone keeping the calendar?" : "Remove this plan?"}
          </span>
          <button className="linklike" onClick={() => setConfirming(false)}>keep it</button>
          <button className="linklike danger" onClick={onRemove}>remove</button>
        </div>
      ) : null}
      <div className="hap-card-title">{h.title || "Untitled"}</div>
      {h.place ? <div className="hap-place">{h.place}</div> : null}
      {h.note ? <div className="hap-note">{h.note}</div> : null}
      {h.link ? (
        <a className="hap-link" href={/^https?:\/\//.test(h.link) ? h.link : `https://${h.link}`} target="_blank" rel="noreferrer noopener">
          {h.link.replace(/^https?:\/\//, "")}
        </a>
      ) : null}
      {isShared ? (
        <div className="hap-marks">
          {others.length ? <span className="hap-who">{others.map((w) => displayName(w, profiles)).join(", ")}{others.length === 1 ? " is" : " are"} in</span> : null}
          {account ? (
            mine ? (
              <button className="claim claim-mine" onClick={() => onSetMark(h, false)} title="Take your name off">
                you're in ✕
              </button>
            ) : (
              <button className="claim claim-offer" onClick={() => onSetMark(h, true)}>I'm in</button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// A plan gone by: quieter, but not inert — the wake is exactly where "same
// again" earns its keep (the annual fair, last month's trivia night).
function WakeCard({
  h,
  marks,
  profiles,
  isShared,
  onSameAgain,
  onRemove,
}: {
  h: Happening;
  marks: Mark[];
  profiles: Profile[];
  isShared: boolean;
  onSameAgain: () => void;
  onRemove: () => void;
}) {
  const who = whoIsIn(h.id, marks);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="hap-card hap-past">
      <div className="hap-card-head">
        <span className="hap-when">{formatWhen(h)}</span>
        <span className="hap-tools">
          <button className="item-x" onClick={onSameAgain} title="Same again — a fresh copy for a new day" aria-label={`Plan ${h.title} again`}>
            <Again />
          </button>
          <button className="item-x" onClick={() => setConfirming(true)} aria-label={`Remove ${h.title}`} title="Remove">×</button>
        </span>
      </div>
      {confirming ? (
        <div className="hap-confirm">
          <span className="hint" style={{ margin: 0 }}>
            {isShared ? "Remove this from everyone's wake?" : "Remove this from the wake?"}
          </span>
          <button className="linklike" onClick={() => setConfirming(false)}>keep it</button>
          <button className="linklike danger" onClick={onRemove}>remove</button>
        </div>
      ) : null}
      <div className="hap-card-title">{h.title || "Untitled"}</div>
      {who.length ? <div className="hap-who">{who.map((w) => displayName(w, profiles)).join(", ")} went</div> : null}
    </div>
  );
}

export function CalendarPage({
  calendar,
  happenings,
  marks,
  profiles,
  shared,
  account,
  now,
  onBack,
  onRename,
  onAddHappening,
  onEditHappening,
  onRemoveHappening,
  onSetMark,
  onOpenShare,
  onRemoveCalendar,
}: {
  calendar: Calendar;
  happenings: Happening[];
  marks: Mark[];
  profiles: Profile[];
  shared: SharedCalendar | undefined;
  account: string | null;
  now: number;
  onBack: () => void;
  onRename: (title: string) => void;
  onAddHappening: (draft: HappeningDraft) => void;
  onEditHappening: (h: Happening, draft: HappeningDraft) => void;
  onRemoveHappening: (h: Happening) => void;
  onSetMark: (h: Happening, mine: boolean) => void;
  onOpenShare: () => void;
  onRemoveCalendar: () => void;
}) {
  const { coming, wake } = splitAgenda(calendar.id, happenings, now);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(calendar.title);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Happening | null>(null);
  const [again, setAgain] = useState<Happening | null>(null);
  const [showWake, setShowWake] = useState(false);

  useEffect(() => {
    setTitle(calendar.title);
    setRenaming(false);
    setConfirmRemove(false);
    setAdding(false);
    setEditing(null);
    setAgain(null);
    setShowWake(false);
  }, [calendar.id, calendar.title]);

  function rename(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim()) onRename(title);
    setRenaming(false);
  }

  const others = shared ? shared.members.filter((m) => m.email !== account) : [];

  return (
    <>
      <button className="btn btn-ghost btn-sm back" onClick={onBack}>‹ The almanac</button>

      <div className="list-head">
        {renaming ? (
          <form className="row" style={{ flex: 1 }} onSubmit={rename}>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-sm">Save</button>
          </form>
        ) : (
          <h2 className="list-title-lg">
            {calendar.title || "Untitled calendar"}{" "}
            <button className="linklike list-rename" onClick={() => setRenaming(true)}>rename</button>
          </h2>
        )}
        <div className="list-actions">
          <button className="btn btn-sm" onClick={onOpenShare} title={shared ? "Who keeps this calendar" : "Keep this calendar together"}>
            {shared ? `Shared · ${shared.members.length || "…"}` : "Share"}
          </button>
        </div>
      </div>
      {calendar.note ? <p className="list-note">{calendar.note}</p> : null}
      {shared && others.length ? (
        <p className="hint">Kept with {others.map((m) => displayName(m.email, profiles)).join(", ")}.</p>
      ) : null}

      <div className="add-plan">
        <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a plan</button>
        {coming.length > 0 ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => downloadICS(`${(calendar.title || "almanac").replace(/[^\w-]+/g, "-").toLowerCase()}.ics`, toICS(coming, Date.now()))}
            title="Everything coming up, as one .ics file for any calendar app"
          >
            Download all (.ics)
          </button>
        ) : null}
      </div>

      {coming.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: "18px 0" }}>
          Nothing ahead in this book yet. When a plan takes shape, put it in — whoever's going will
          say so.
        </p>
      ) : (
        groupByMonth(coming).map((m) => (
          <div key={m.label}>
            <h3 className="month-head">{m.label}</h3>
            {m.items.map((h) => (
              <HappeningRow
                key={h.id}
                h={h}
                marks={marks}
                profiles={profiles}
                account={account}
                isShared={!!shared}
                onSetMark={onSetMark}
                onEdit={() => setEditing(h)}
                onSameAgain={() => setAgain(h)}
                onRemove={() => onRemoveHappening(h)}
              />
            ))}
          </div>
        ))
      )}

      {wake.length > 0 ? (
        <section className="section" style={{ marginTop: 26 }}>
          <div className="section-head">
            <h2 className="section-title">The wake</h2>
            <button className="linklike" onClick={() => setShowWake((w) => !w)}>
              {showWake ? "Fold it away" : `${wake.length} gone by`}
            </button>
          </div>
          {showWake
            ? wake.map((h) => (
                <WakeCard
                  key={h.id}
                  h={h}
                  marks={marks}
                  profiles={profiles}
                  isShared={!!shared}
                  onSameAgain={() => setAgain(h)}
                  onRemove={() => onRemoveHappening(h)}
                />
              ))
            : null}
        </section>
      ) : null}

      <div className="danger-zone">
        {confirmRemove ? (
          <>
            <p className="hint">
              {shared
                ? "This calendar is shared — removing it removes it for everyone keeping it, the wake included. It can't be undone."
                : "This removes the calendar and everything in it, the wake included. It can't be undone."}
            </p>
            <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>Keep it</button>
              <button className="btn btn-danger" onClick={onRemoveCalendar}>Remove this calendar</button>
            </div>
          </>
        ) : (
          <button className="linklike danger" onClick={() => setConfirmRemove(true)}>
            Remove this calendar
          </button>
        )}
      </div>

      {adding ? (
        <HappeningForm
          onSave={(draft) => {
            onAddHappening(draft);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <HappeningForm
          existing={editing}
          onSave={(draft) => {
            onEditHappening(editing, draft);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {again ? (
        <HappeningForm
          template={again}
          onSave={(draft) => {
            onAddHappening(draft);
            setAgain(null);
          }}
          onClose={() => setAgain(null)}
        />
      ) : null}
    </>
  );
}

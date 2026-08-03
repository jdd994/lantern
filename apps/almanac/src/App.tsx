import { useEffect, useRef, useState } from "react";
import { connectVibeRelay, type VibeRelayHandle } from "@lantern/core/vibe-relay";
import { InstallSheet, useTheme } from "@lantern/ui";
import { useAlmanac } from "./hooks/useAlmanac";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";
import { Home } from "./components/Home";
import { CalendarPage } from "./components/CalendarPage";
import { NewCalendar } from "./components/NewCalendar";
import { SettingsSheet, MOODS } from "./components/SettingsSheet";
import { Sync } from "./components/Sync";
import { ShareSheet } from "./components/ShareSheet";
import { Gear } from "./components/icons";
import { type Profile } from "./lib/model";

// The raw name this account chose (not the fallback) — what the input shows.
function rawMyName(account: string | null, profiles: Profile[]): string {
  if (!account) return "";
  let best: Profile | undefined;
  for (const p of profiles) {
    if (p.who !== account) continue;
    if (!best || p.updatedAt > best.updatedAt) best = p;
  }
  return best?.name ?? "";
}

// Almanac's moods, loosely mapped to the shared @lantern/core vibe vocabulary —
// only for announcing a pick over the local relay so e.g. Aura's lights can
// follow. Publish-only, same as the siblings: Almanac's own look never changes
// because of what another app picked.
const MOOD_TO_VIBE: Record<string, string> = {
  broadsheet: "daylight",
  lamplight: "calm",
  moonrise: "wind-down",
};

const PENDING_INVITE_KEY = "almanac-pending-invite";

// If the app was opened via an invite link (`#join=<id>.<secret>`), capture it,
// stash it (so it survives first-run setup / unlock), and strip the secret from
// the URL so it isn't left in history or accidentally re-shared.
function readPendingInvite(): { inviteId: string; secret: string } | null {
  try {
    const m = /^#join=([^.]+)\.(.+)$/.exec(location.hash);
    if (m) {
      const pi = { inviteId: m[1], secret: m[2] };
      localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(pi));
      history.replaceState(null, "", location.pathname + location.search);
      return pi;
    }
    const stored = localStorage.getItem(PENDING_INVITE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const a = useAlmanac();
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [newCalendar, setNewCalendar] = useState(false);
  const [sync, setSync] = useState(false);
  const [share, setShare] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(() => readPendingInvite());
  const [joinNote, setJoinNote] = useState<string | null>(null);
  const joiningRef = useRef(false);
  const { mood, setMood } = useTheme("almanac-mood", MOODS.map((x) => x.id), "broadsheet");

  // "Now" refreshes every few minutes so tonight's show slips into the wake at
  // midnight without anyone reloading — a calendar has one moving part.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Once we're open and connected, redeem any pending invite link and land the
  // person in the calendar. If they're set up but haven't connected an account,
  // a banner (below) points them to Sync; the invite waits until then.
  useEffect(() => {
    if (!pendingInvite || a.status !== "unlocked" || !a.account || joiningRef.current) return;
    joiningRef.current = true;
    void (async () => {
      const res = await a.joinViaInvite(pendingInvite.inviteId, pendingInvite.secret);
      joiningRef.current = false;
      localStorage.removeItem(PENDING_INVITE_KEY);
      setPendingInvite(null);
      if ("error" in res) {
        setJoinNote(res.error);
      } else {
        setSelected(res.calendarId);
        setJoinNote("You're in — the calendar is yours to keep too.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvite, a.status, a.account]);

  const relayRef = useRef<VibeRelayHandle | null>(null);
  useEffect(() => {
    relayRef.current = connectVibeRelay("almanac", () => {});
    return () => relayRef.current?.close();
  }, []);
  const handleMood = (id: string) => {
    setMood(id);
    const vibeId = MOOD_TO_VIBE[id];
    if (vibeId) relayRef.current?.publish({ vibeId });
  };

  // The Sync sheet is shared by every status: at setup it's "sign in from
  // another device" (no local vault yet, so no create), unlocked it's the
  // full account surface.
  const syncSheet = sync ? (
    <Sync
      account={a.account}
      syncing={a.syncing}
      syncError={a.syncError}
      canCreate={a.status === "unlocked"}
      onCreate={a.connectCreate}
      onSignIn={a.connectSignIn}
      onDisconnect={a.disconnect}
      onDelete={a.deleteAccount}
      onSyncNow={a.syncNow}
      onChangePassphrase={a.changePassphrase}
      onClose={() => setSync(false)}
      guardianCircle={a.guardianCircle}
      onSetupGuardians={a.setupGuardians}
      recoveryStatus={a.recoveryStatus}
      onCancelPendingRecovery={a.cancelPendingRecovery}
      pendingGuardianRequests={a.pendingGuardianRequests}
      onApproveGuardianRequest={a.approveGuardianRequest}
    />
  ) : null;

  if (a.status === "loading") return null;
  if (a.status === "setup") {
    return (
      <>
        <Welcome onSetup={a.setup} busy={a.busy} onSignIn={() => setSync(true)} onInstallHelp={() => setInstallHelp(true)} />
        {syncSheet}
        {installHelp ? <InstallSheet appName="Almanac" onClose={() => setInstallHelp(false)} /> : null}
      </>
    );
  }
  if (a.status === "locked") {
    return (
      <LockScreen
        onUnlock={a.unlock}
        onBiometric={a.unlockWithBiometric}
        hasBiometric={a.hasBiometric}
        error={a.error}
        busy={a.busy}
        account={a.account}
        syncError={a.syncError}
        guardianCircle={a.guardianCircle}
        onRecoverySignIn={a.connectSignIn}
        onLoadGuardianCircle={a.loadGuardianCircle}
        onStartRecovery={a.startRecoveryRequest}
        onPollRecovery={a.pollRecoveryRequest}
        onCancelRecovery={a.cancelRecoveryRequest}
        onFinishRecovery={a.finishRecoveryRequest}
      />
    );
  }

  const calendar = selected ? a.calendars.find((c) => c.id === selected) : undefined;

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">Almanac<span>.</span></h1>
        <div className="top-actions">
          {a.canBiometric && !a.hasBiometric ? (
            <button className="btn btn-sm" onClick={() => void a.enableBiometric()}>Quick unlock</button>
          ) : null}
          <button
            className="btn btn-sm"
            onClick={() => setSync(true)}
            title={a.account ? `Syncing as ${a.account}` : "Sync across devices"}
          >
            {a.syncing ? "Syncing…" : a.account ? "Synced" : "Sync"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSettings(true)}
            title="Settings & vibe"
            aria-label="Settings and vibe"
          >
            <Gear />
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setSelected(null);
              a.lock();
            }}
            title="Lock the vault"
          >
            Lock
          </button>
        </div>
      </header>

      {a.saveError ? (
        <div className="error">
          {a.saveError.message}{" "}
          <button className="linklike" onClick={a.saveError.retry}>Try again</button>
        </div>
      ) : null}

      {pendingInvite && !a.account ? (
        <div className="hint banner">
          You've been invited to keep a calendar together. Connect Sync to join —{" "}
          <button className="linklike" onClick={() => setSync(true)}>open Sync</button>.
        </div>
      ) : null}
      {joinNote ? (
        <div className="hint banner">
          {joinNote}{" "}
          <button className="linklike" onClick={() => setInstallHelp(true)}>Put Almanac on your home screen?</button>{" "}
          <button className="linklike" onClick={() => setJoinNote(null)}>Dismiss</button>
        </div>
      ) : null}

      {calendar ? (
        <CalendarPage
          calendar={calendar}
          happenings={a.happenings}
          marks={a.marks}
          profiles={a.profiles}
          shared={a.shared[calendar.id]}
          account={a.account}
          now={now}
          onBack={() => setSelected(null)}
          onRename={(title) => a.updateCalendar(calendar, { title })}
          onAddHappening={(draft) => void a.addHappening(calendar.id, draft)}
          onEditHappening={(h, draft) => a.updateHappening(h, draft)}
          onRemoveHappening={a.removeHappening}
          onSetMark={a.setMark}
          onImportICS={(text) => {
            const r = a.importICS(text, { calendarId: calendar.id });
            if (typeof r === "string") return r;
            return { added: r.added, skippedRecurring: r.skipped.skippedRecurring, skippedUnreadable: r.skipped.skippedUnreadable };
          }}
          onOpenShare={() => {
            setShare(true);
            void a.syncShared();
          }}
          onRemoveCalendar={() => {
            setSelected(null);
            a.removeCalendar(calendar);
          }}
        />
      ) : (
        <Home
          calendars={a.calendars}
          happenings={a.happenings}
          marks={a.marks}
          profiles={a.profiles}
          shared={a.shared}
          now={now}
          onOpen={setSelected}
          onOpenHappening={setSelected}
          onNew={() => setNewCalendar(true)}
        />
      )}

      {newCalendar ? (
        <NewCalendar
          onCreate={(title, note) => {
            setSelected(a.addCalendar(title, note));
            setNewCalendar(false);
          }}
          onClose={() => setNewCalendar(false)}
        />
      ) : null}
      {settings ? (
        <SettingsSheet
          mood={mood}
          onMood={handleMood}
          account={a.account}
          myName={rawMyName(a.account, a.profiles)}
          onSetName={a.setMyName}
          onExport={a.exportMarkdown}
          onImport={a.importMarkdown}
          onImportICS={a.importICS}
          onInstallHelp={() => {
            setSettings(false);
            setInstallHelp(true);
          }}
          onClose={() => setSettings(false)}
        />
      ) : null}
      {installHelp ? <InstallSheet appName="Almanac" onClose={() => setInstallHelp(false)} /> : null}
      {share && calendar ? (
        <ShareSheet
          calendar={calendar}
          profiles={a.profiles}
          account={a.account}
          shared={a.shared[calendar.id]}
          sharedBusy={a.sharedBusy}
          sharedError={a.sharedError}
          onShare={() => a.shareCalendar(calendar.id)}
          onInvite={(email) => a.inviteToCalendar(calendar.id, email)}
          onCreateLink={() => a.createCalendarInviteLink(calendar.id)}
          onFetchInvites={() => a.fetchCalendarInvites(calendar.id)}
          onRevokeInvite={(inviteId) => a.revokeCalendarInvite(calendar.id, inviteId)}
          onRemoveMember={(userId) => a.removeCalendarMember(calendar.id, userId)}
          onLeave={() => a.leaveCalendar(calendar.id)}
          onRefresh={a.syncShared}
          onOpenSync={() => setSync(true)}
          onClose={() => setShare(false)}
        />
      ) : null}
      {syncSheet}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { connectVibeRelay, type VibeRelayHandle } from "@lantern/core/vibe-relay";
import { InstallSheet, useTheme } from "@lantern/ui";
import { useManifest } from "./hooks/useManifest";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";
import { Home } from "./components/Home";
import { ListPage } from "./components/ListPage";
import { NewList } from "./components/NewList";
import { SettingsSheet, MOODS } from "./components/SettingsSheet";
import { Sync } from "./components/Sync";
import { ShareSheet } from "./components/ShareSheet";
import { Gear } from "./components/icons";

// Manifest's moods, loosely mapped to the shared @lantern/core vibe vocabulary —
// only for announcing a pick over the local relay so e.g. Aura's lights can
// follow. Publish-only, same as Hearth and Grove: Manifest's own look never
// changes because of what another app picked.
const MOOD_TO_VIBE: Record<string, string> = {
  chartroom: "calm",
  nightwatch: "wind-down",
  daybreak: "daylight",
};

const PENDING_INVITE_KEY = "manifest-pending-invite";

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
  const m = useManifest();
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [newList, setNewList] = useState(false);
  const [sync, setSync] = useState(false);
  const [share, setShare] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(() => readPendingInvite());
  const [joinNote, setJoinNote] = useState<string | null>(null);
  const joiningRef = useRef(false);
  const { mood, setMood } = useTheme("manifest-mood", MOODS.map((x) => x.id), "chartroom");

  // Once we're open and connected, redeem any pending invite link and land the
  // person in the list. If they're set up but haven't connected an account, a
  // banner (below) points them to Sync; the invite waits until then.
  useEffect(() => {
    if (!pendingInvite || m.status !== "unlocked" || !m.account || joiningRef.current) return;
    joiningRef.current = true;
    void (async () => {
      const res = await m.joinViaInvite(pendingInvite.inviteId, pendingInvite.secret);
      joiningRef.current = false;
      localStorage.removeItem(PENDING_INVITE_KEY);
      setPendingInvite(null);
      if ("error" in res) {
        setJoinNote(res.error);
      } else {
        setSelected(res.listId);
        setJoinNote("You're in — the list is yours to pack too.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvite, m.status, m.account]);

  const relayRef = useRef<VibeRelayHandle | null>(null);
  useEffect(() => {
    relayRef.current = connectVibeRelay("manifest", () => {});
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
      account={m.account}
      syncing={m.syncing}
      syncError={m.syncError}
      canCreate={m.status === "unlocked"}
      onCreate={m.connectCreate}
      onSignIn={m.connectSignIn}
      onDisconnect={m.disconnect}
      onDelete={m.deleteAccount}
      onSyncNow={m.syncNow}
      onChangePassphrase={m.changePassphrase}
      recoveryKitAt={m.recoveryKitAt}
      onCreateRecoveryKit={m.createRecoveryKit}
      onRemoveRecoveryKit={m.removeRecoveryKit}
      onClose={() => setSync(false)}
      guardianCircle={m.guardianCircle}
      onSetupGuardians={m.setupGuardians}
      recoveryStatus={m.recoveryStatus}
      onCancelPendingRecovery={m.cancelPendingRecovery}
      pendingGuardianRequests={m.pendingGuardianRequests}
      onApproveGuardianRequest={m.approveGuardianRequest}
    />
  ) : null;

  if (m.status === "loading") return null;
  if (m.status === "setup") {
    return (
      <>
        <Welcome onSetup={m.setup} busy={m.busy} onSignIn={() => setSync(true)} onInstallHelp={() => setInstallHelp(true)} />
        {syncSheet}
        {installHelp ? <InstallSheet appName="Manifest" onClose={() => setInstallHelp(false)} /> : null}
      </>
    );
  }
  if (m.status === "locked") {
    return (
      <LockScreen
        onUnlock={m.unlock}
        onBiometric={m.unlockWithBiometric}
        hasBiometric={m.hasBiometric}
        error={m.error}
        busy={m.busy}
        account={m.account}
        syncError={m.syncError}
        guardianCircle={m.guardianCircle}
        onRecoverySignIn={m.connectSignIn}
        onLoadGuardianCircle={m.loadGuardianCircle}
        onStartRecovery={m.startRecoveryRequest}
        onPollRecovery={m.pollRecoveryRequest}
        onCancelRecovery={m.cancelRecoveryRequest}
        onFinishRecovery={m.finishRecoveryRequest}
        onRecoverWithKit={m.recoverWithKit}
      />
    );
  }

  const list = selected ? m.lists.find((l) => l.id === selected) : undefined;

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">Manifest<span>.</span></h1>
        <div className="top-actions">
          {m.canBiometric && !m.hasBiometric ? (
            <button className="btn btn-sm" onClick={() => void m.enableBiometric()}>Quick unlock</button>
          ) : null}
          <button
            className="btn btn-sm"
            onClick={() => setSync(true)}
            title={m.account ? `Syncing as ${m.account}` : "Sync across devices"}
          >
            {m.syncing ? "Syncing…" : m.account ? "Synced" : "Sync"}
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
              m.lock();
            }}
            title="Lock the vault"
          >
            Lock
          </button>
        </div>
      </header>

      {m.saveError ? (
        <div className="error">
          {m.saveError.message}{" "}
          <button className="linklike" onClick={m.saveError.retry}>Try again</button>
        </div>
      ) : null}

      {pendingInvite && !m.account ? (
        <div className="hint banner">
          You've been invited to pack a list together. Connect Sync to join —{" "}
          <button className="linklike" onClick={() => setSync(true)}>open Sync</button>.
        </div>
      ) : null}
      {joinNote ? (
        <div className="hint banner">
          {joinNote}{" "}
          <button className="linklike" onClick={() => setJoinNote(null)}>Dismiss</button>
        </div>
      ) : null}

      {list ? (
        <ListPage
          list={list}
          items={m.items}
          shared={m.shared[list.id]}
          account={m.account}
          onBack={() => setSelected(null)}
          onRename={(title) => m.updateList(list, { title })}
          onAddItem={(text) => void m.addItem(list.id, text)}
          onToggle={m.toggleItem}
          onSetClaim={m.setClaim}
          onEditItem={(item, text) => m.updateItem(item, { text })}
          onMove={m.moveItem}
          onRemoveItem={m.removeItem}
          onDuplicate={() => setSelected(m.duplicateList(list, list.title))}
          onOpenShare={() => {
            setShare(true);
            void m.syncShared();
          }}
          onRemoveList={() => {
            setSelected(null);
            m.removeList(list);
          }}
        />
      ) : (
        <Home lists={m.lists} items={m.items} shared={m.shared} onOpen={setSelected} onNew={() => setNewList(true)} />
      )}

      {newList ? (
        <NewList
          onCreate={(title, note) => {
            setSelected(m.addList(title, note));
            setNewList(false);
          }}
          onClose={() => setNewList(false)}
        />
      ) : null}
      {settings ? (
        <SettingsSheet
          mood={mood}
          onMood={handleMood}
          onExport={m.exportMarkdown}
          onImport={m.importMarkdown}
          onInstallHelp={() => {
            setSettings(false);
            setInstallHelp(true);
          }}
          onClose={() => setSettings(false)}
        />
      ) : null}
      {installHelp ? <InstallSheet appName="Manifest" onClose={() => setInstallHelp(false)} /> : null}
      {share && list ? (
        <ShareSheet
          list={list}
          account={m.account}
          shared={m.shared[list.id]}
          sharedBusy={m.sharedBusy}
          sharedError={m.sharedError}
          onShare={() => m.shareList(list.id)}
          onInvite={(email) => m.inviteToList(list.id, email)}
          onCreateLink={() => m.createListInviteLink(list.id)}
          onFetchInvites={() => m.fetchListInvites(list.id)}
          onRevokeInvite={(inviteId) => m.revokeListInvite(list.id, inviteId)}
          onRemoveMember={(userId) => m.removeListMember(list.id, userId)}
          onLeave={() => m.leaveList(list.id)}
          onRefresh={m.syncShared}
          onOpenSync={() => setSync(true)}
          onClose={() => setShare(false)}
        />
      ) : null}
      {syncSheet}
    </div>
  );
}

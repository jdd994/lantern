import { useEffect, useRef, useState } from "react";
import { connectVibeRelay, type VibeRelayHandle } from "@lantern/core/vibe-relay";
import { InstallSheet, useTheme, useLocale } from "@lantern/ui";
import { LOCALES, activateLocale } from "./lib/i18n";
import { useGrove } from "./hooks/useGrove";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";
import { Home } from "./components/Home";
import { PersonPage } from "./components/PersonPage";
import { TreeView } from "./components/TreeView";
import { AddRelative } from "./components/AddRelative";
import { SettingsSheet, MOODS } from "./components/SettingsSheet";
import { Sync } from "./components/Sync";
import { Family } from "./components/Family";
import { Gear } from "./components/icons";
import type { Relation } from "./lib/model";

// Grove's moods, loosely mapped to the shared @lantern/core vibe vocabulary —
// only for announcing a pick over the local relay so e.g. Aura's lights can
// follow. Publish-only, same as Hearth: Grove's own look never changes because
// of what another app picked.
const MOOD_TO_VIBE: Record<string, string> = {
  canopy: "calm",
  understory: "wind-down",
  meadow: "daylight",
};

// What the add sheet needs to know: who we're anchored to, if anyone.
type Adding = { anchorId?: string; relation?: Relation };

export default function App() {
  const g = useGrove();
  const [selected, setSelected] = useState<string | null>(null);
  const [treeFocus, setTreeFocus] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [sync, setSync] = useState(false);
  const [family, setFamily] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const { mood, setMood } = useTheme("grove-mood", MOODS.map((m) => m.id), "canopy");
  const { locale, setLocale } = useLocale("grove-locale", LOCALES.map((l) => l.id));
  useEffect(() => {
    void activateLocale(locale);
  }, [locale]);

  const relayRef = useRef<VibeRelayHandle | null>(null);
  useEffect(() => {
    relayRef.current = connectVibeRelay("grove", () => {});
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
      account={g.account}
      syncing={g.syncing}
      syncError={g.syncError}
      canCreate={g.status === "unlocked"}
      onCreate={g.connectCreate}
      onSignIn={g.connectSignIn}
      onDisconnect={g.disconnect}
      onDelete={g.deleteAccount}
      onSyncNow={g.syncNow}
      onChangePassphrase={g.changePassphrase}
      recoveryKitAt={g.recoveryKitAt}
      onCreateRecoveryKit={g.createRecoveryKit}
      onRemoveRecoveryKit={g.removeRecoveryKit}
      onClose={() => setSync(false)}
      guardianCircle={g.guardianCircle}
      onSetupGuardians={g.setupGuardians}
      recoveryStatus={g.recoveryStatus}
      onCancelPendingRecovery={g.cancelPendingRecovery}
      pendingGuardianRequests={g.pendingGuardianRequests}
      onApproveGuardianRequest={g.approveGuardianRequest}
    />
  ) : null;

  if (g.status === "loading") return null;
  if (g.status === "setup") {
    return (
      <>
        <Welcome onSetup={g.setup} busy={g.busy} onSignIn={() => setSync(true)} onInstallHelp={() => setInstallHelp(true)} />
        {syncSheet}
        {installHelp ? <InstallSheet appName="Grove" onClose={() => setInstallHelp(false)} /> : null}
      </>
    );
  }
  if (g.status === "locked") {
    return (
      <LockScreen
        onUnlock={g.unlock}
        onBiometric={g.unlockWithBiometric}
        hasBiometric={g.hasBiometric}
        error={g.error}
        busy={g.busy}
        account={g.account}
        syncError={g.syncError}
        guardianCircle={g.guardianCircle}
        onRecoverySignIn={g.connectSignIn}
        onLoadGuardianCircle={g.loadGuardianCircle}
        onStartRecovery={g.startRecoveryRequest}
        onPollRecovery={g.pollRecoveryRequest}
        onCancelRecovery={g.cancelRecoveryRequest}
        onFinishRecovery={g.finishRecoveryRequest}
        onRecoverWithKit={g.recoverWithKit}
      />
    );
  }

  const person = selected ? g.people.find((p) => p.id === selected) : undefined;
  const focusPerson = treeFocus ? g.people.find((p) => p.id === treeFocus) : undefined;
  const anchor = adding?.anchorId ? g.people.find((p) => p.id === adding.anchorId) : undefined;

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">Grove<span>.</span></h1>
        <div className="top-actions">
          {g.canBiometric && !g.hasBiometric ? (
            <button className="btn btn-sm" onClick={() => void g.enableBiometric()}>Quick unlock</button>
          ) : null}
          <button
            className="btn btn-sm"
            onClick={() => {
              setFamily(true);
              void g.syncTree();
            }}
            title={g.tree ? `Shared: ${g.tree.title}` : "Share the tree with family"}
          >
            {g.tree ? "Family" : "Share"}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setSync(true)}
            title={g.account ? `Syncing as ${g.account}` : "Sync across devices"}
          >
            {g.syncing ? "Syncing…" : g.account ? "Synced" : "Sync"}
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
              g.lock();
            }}
            title="Lock the vault"
          >
            Lock
          </button>
        </div>
      </header>

      {g.saveError ? (
        <div className="error">
          {g.saveError.message}{" "}
          <button className="linklike" onClick={g.saveError.retry}>Try again</button>
        </div>
      ) : null}

      {focusPerson ? (
        <TreeView
          focus={focusPerson}
          people={g.people}
          unions={g.unions}
          onFocus={setTreeFocus}
          onOpen={(id) => {
            setSelected(id);
            setTreeFocus(null);
          }}
          onBack={() => setTreeFocus(null)}
        />
      ) : person ? (
        <PersonPage
          person={person}
          people={g.people}
          unions={g.unions}
          keepsakes={g.keepsakes}
          onOpen={setSelected}
          onBack={() => setSelected(null)}
          onUpdate={(patch) => g.updatePerson(person.id, patch)}
          onRemove={() => {
            setSelected(null);
            g.removePerson(person);
          }}
          onTree={() => setTreeFocus(person.id)}
          onAddRelative={(relation) => setAdding({ anchorId: person.id, relation })}
          onAddKeepsake={(draft, file) => void g.addKeepsake(draft, file)}
          onRemoveKeepsake={g.removeKeepsake}
          getMediaUrl={g.getMediaUrl}
        />
      ) : (
        <Home people={g.people} unions={g.unions} onOpen={setSelected} onAddFirst={() => setAdding({})} onTree={setTreeFocus} />
      )}

      {adding ? (
        <AddRelative
          anchor={anchor}
          relation={adding.relation}
          onAdd={(draft, childKind) => {
            if (anchor && adding.relation) {
              g.addRelative(anchor.id, adding.relation, draft, childKind);
            } else {
              setSelected(g.addPerson(draft));
            }
          }}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {settings ? (
        <SettingsSheet
          mood={mood}
          onMood={handleMood}
          locale={locale}
          locales={LOCALES}
          onLocale={setLocale}
          onExport={g.exportGedcom}
          onImport={g.importGedcom}
          onInstallHelp={() => {
            setSettings(false);
            setInstallHelp(true);
          }}
          onClose={() => setSettings(false)}
        />
      ) : null}
      {installHelp ? <InstallSheet appName="Grove" onClose={() => setInstallHelp(false)} /> : null}
      {family ? (
        <Family
          account={g.account}
          tree={g.tree}
          treeBusy={g.treeBusy}
          treeError={g.treeError}
          onCreate={g.createTree}
          onInvite={g.inviteToTree}
          onLeave={g.leaveTree}
          onRefresh={g.syncTree}
          onOpenSync={() => setSync(true)}
          onClose={() => setFamily(false)}
        />
      ) : null}
      {syncSheet}
    </div>
  );
}

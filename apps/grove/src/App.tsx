import { useEffect, useRef, useState } from "react";
import { connectVibeRelay, type VibeRelayHandle } from "@lantern/core/vibe-relay";
import { useTheme } from "@lantern/ui";
import { useGrove } from "./hooks/useGrove";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";
import { Home } from "./components/Home";
import { PersonPage } from "./components/PersonPage";
import { AddRelative } from "./components/AddRelative";
import { SettingsSheet, MOODS } from "./components/SettingsSheet";
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
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState<Adding | null>(null);
  const { mood, setMood } = useTheme("grove-mood", MOODS.map((m) => m.id), "canopy");

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

  if (g.status === "loading") return null;
  if (g.status === "setup") return <Welcome onSetup={g.setup} busy={g.busy} />;
  if (g.status === "locked") return <LockScreen onUnlock={g.unlock} error={g.error} busy={g.busy} />;

  const person = selected ? g.people.find((p) => p.id === selected) : undefined;
  const anchor = adding?.anchorId ? g.people.find((p) => p.id === adding.anchorId) : undefined;

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">Grove<span>.</span></h1>
        <div className="top-actions">
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

      {person ? (
        <PersonPage
          person={person}
          people={g.people}
          unions={g.unions}
          keepsakes={g.keepsakes}
          onOpen={setSelected}
          onBack={() => setSelected(null)}
          onUpdate={(patch) => g.updatePerson(person.id, patch)}
          onAddRelative={(relation) => setAdding({ anchorId: person.id, relation })}
        />
      ) : (
        <Home people={g.people} unions={g.unions} onOpen={setSelected} onAddFirst={() => setAdding({})} />
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
      {settings ? <SettingsSheet mood={mood} onMood={handleMood} onClose={() => setSettings(false)} /> : null}
    </div>
  );
}

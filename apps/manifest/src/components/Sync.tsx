// Sync.tsx — Manifest's words on the shared SyncSheet (@lantern/ui).
// The structure, the two-secrets explanation, and the guardian flow live there.
// Manifest says what syncs (your lists), spells the privacy vow for packing
// together — not an item, not a title, not who's bringing what — and knows who
// a guardian naturally is: the people you travel with.

import { SyncSheet, RecoveryKitSection } from "@lantern/ui";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof SyncSheet>, "copy" | "guardianDefaults" | "recoveryKit"> & {
  recoveryKitAt: number | null;
  onCreateRecoveryKit: () => Promise<{ code: string } | string>;
  onRemoveRecoveryKit: () => Promise<string | null>;
};

export function Sync({ recoveryKitAt, onCreateRecoveryKit, onRemoveRecoveryKit, ...props }: Props) {
  return (
    <SyncSheet
      {...props}
      copy={{
        noun: "lists",
        syncsLine:
          "Your lists sync quietly in the background — nothing is lost if you're offline, it catches up next time.",
        privacyNote: (
          <p className="hint">
            Only encrypted blobs leave this device. Your passphrase, and the key made from it,
            never do — so the server stores noise it can't read: not an item, not a title, not
            who's bringing what.
          </p>
        ),
        signinHint:
          "Signing in downloads your lists to this device. You'll open them with the same passphrase you set on the first one.",
        guardiansPitchExtra:
          "For lists you pack together, the natural guardians are the people you travel with.",
        helpHeading: "Help someone back in",
      }}
      recoveryKit={
        <RecoveryKitSection
          appName="Manifest"
          recoveryKitAt={recoveryKitAt}
          onCreate={onCreateRecoveryKit}
          onRemove={onRemoveRecoveryKit}
        />
      }
    />
  );
}

// Sync.tsx — Grove's words on the shared SyncSheet (@lantern/ui).
// The structure, the two-secrets explanation, and the guardian flow live there.
// Grove says what syncs (the tree), spells the privacy vow out for a family —
// not a name, not a date, not a word of a letter — and knows who a guardian
// naturally is: the family itself.

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
        noun: "tree",
        privacyNote: (
          <p className="hint">
            Only encrypted blobs leave this device. Your passphrase, and the key made from it,
            never do — so the server stores noise it can't read: not a name, not a date, not a
            word of a letter.
          </p>
        ),
        guardiansPitchExtra: "For a family tree, the natural guardians are the family.",
        helpHeading: "Help a family member",
      }}
      recoveryKit={
        <RecoveryKitSection
          appName="Grove"
          recoveryKitAt={recoveryKitAt}
          onCreate={onCreateRecoveryKit}
          onRemove={onRemoveRecoveryKit}
        />
      }
    />
  );
}

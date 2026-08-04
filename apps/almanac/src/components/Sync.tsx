// Sync.tsx — Almanac's words on the shared SyncSheet (@lantern/ui).
// The structure, the two-secrets explanation, and the guardian flow live there.
// Almanac says what syncs (your plans), spells the privacy vow for a shared
// calendar — not an item, not a title, not who's bringing what — and knows who
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
        noun: "almanac",
        syncsLine:
          "Your plans sync quietly in the background — nothing is lost if you're offline, it catches up next time.",
        privacyNote: (
          <p className="hint">
            Only encrypted blobs leave this device. Your passphrase, and the key made from it,
            never do — so the server stores noise it can't read: not an item, not a title, not
            who's bringing what.
          </p>
        ),
        signinHint:
          "Signing in downloads your plans to this device. You'll open them with the same passphrase you set on the first one.",
        guardiansPitchExtra:
          "For calendars you keep together, the natural guardians are the people you travel with.",
        helpHeading: "Help someone back in",
      }}
      recoveryKit={
        <RecoveryKitSection
          appName="Almanac"
          recoveryKitAt={recoveryKitAt}
          onCreate={onCreateRecoveryKit}
          onRemove={onRemoveRecoveryKit}
        />
      }
    />
  );
}

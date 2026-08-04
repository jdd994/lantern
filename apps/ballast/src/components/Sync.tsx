// Sync.tsx — Ballast's words on the shared SyncSheet (@lantern/ui).
// The structure, the two-secrets explanation, and the guardian flow live there.
// Ballast wears its trust badge on the privacy note, and — given the stakes
// here (money, not journal entries) — defaults the guardian setup stricter
// than its siblings: 5 rows, 3 to approve, a 4-day wait.

import { SyncSheet, DELAY_OPTIONS, RecoveryKitSection } from "@lantern/ui";
import type { ComponentProps } from "react";
import { TrustBadge } from "./TrustBadge";

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
        noun: "vault",
        syncsLine:
          "Your changes sync quietly in the background — nothing is lost if you're offline, it catches up next time.",
        privacyNote: (
          <p className="support-note">
            <TrustBadge tier={0} /> Only encrypted blobs leave this device. Your passphrase
            and the key made from it never do, so the server stores noise it can't read.
          </p>
        ),
        passwordHint:
          "Not your vault passphrase — a separate secret, just for signing in. Your passphrase never leaves this device.",
        guardiansPitchExtra:
          "Given this is your money, the defaults here (3 of 5, a 4-day wait) are stricter than a journal's.",
      }}
      guardianDefaults={{ rows: 5, k: 3, delayMs: DELAY_OPTIONS[2].ms }}
      recoveryKit={
        <RecoveryKitSection
          appName="Ballast"
          recoveryKitAt={recoveryKitAt}
          onCreate={onCreateRecoveryKit}
          onRemove={onRemoveRecoveryKit}
        />
      }
    />
  );
}

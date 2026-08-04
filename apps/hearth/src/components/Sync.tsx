// Sync.tsx — Hearth's words on the shared SyncSheet (@lantern/ui).
// The structure, the two-secrets explanation, and the guardian flow live there;
// Hearth only says what syncs: the log.

import { SyncSheet } from "@lantern/ui";
import type { ComponentProps } from "react";
import { RecoveryKitSection } from "./RecoveryKit";

type Props = Omit<ComponentProps<typeof SyncSheet>, "copy" | "guardianDefaults" | "recoveryKit"> & {
  recoveryKitAt: number | null;
  onCreateRecoveryKit: () => Promise<{ code: string } | string>;
  onRemoveRecoveryKit: () => Promise<string | null>;
};

export function Sync({ recoveryKitAt, onCreateRecoveryKit, onRemoveRecoveryKit, ...props }: Props) {
  return (
    <SyncSheet
      {...props}
      copy={{ noun: "log" }}
      recoveryKit={
        <RecoveryKitSection
          appName="Hearth"
          recoveryKitAt={recoveryKitAt}
          onCreate={onCreateRecoveryKit}
          onRemove={onRemoveRecoveryKit}
        />
      }
    />
  );
}

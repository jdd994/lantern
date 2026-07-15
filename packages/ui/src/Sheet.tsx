// Sheet — the shared modal shell (backdrop + card, Escape / click-away to close).
// Styling comes from @lantern/ui/styles.css using each app's own tokens, so a
// sheet looks native in whichever app renders it.
import { useEffect, type ReactNode } from "react";

export function Sheet({
  onClose,
  children,
  ariaLabel,
}: {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="l-sheet-backdrop" onClick={onClose}>
      <div className="l-sheet" role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

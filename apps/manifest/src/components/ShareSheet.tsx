// ShareSheet.tsx — packing a list together. Everyone in it reads and writes
// the whole list. Inviting is by an address you already know — there's no
// directory, no suggestions, no graph. And an item is claimed, never
// assigned: nobody hands out chores here.

import { useEffect, useState } from "react";
import { Sheet } from "@lantern/ui";
import type { Checklist } from "../lib/model";
import type { InviteInfo } from "../lib/api";
import type { SharedList } from "../hooks/useManifest";

export function ShareSheet({
  list,
  account,
  shared,
  sharedBusy,
  sharedError,
  onShare,
  onInvite,
  onCreateLink,
  onFetchInvites,
  onRevokeInvite,
  onRemoveMember,
  onLeave,
  onRefresh,
  onOpenSync,
  onClose,
}: {
  list: Checklist;
  account: string | null;
  shared: SharedList | undefined;
  sharedBusy: boolean;
  sharedError: string | null;
  onShare: () => Promise<string | null>;
  onInvite: (email: string) => Promise<string | null>;
  onCreateLink: () => Promise<{ link: string } | { error: string }>;
  onFetchInvites: () => Promise<InviteInfo[]>;
  onRevokeInvite: (inviteId: string) => Promise<string | null>;
  onRemoveMember: (userId: string) => Promise<string | null>;
  onLeave: () => Promise<string | null>;
  onRefresh: () => Promise<void>;
  onOpenSync: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [invites, setInvites] = useState<InviteInfo[]>([]);

  const isShared = !!shared;
  useEffect(() => {
    if (isShared) void onFetchInvites().then(setInvites);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShared]);

  async function createLink() {
    setLinkBusy(true);
    setLinkErr(null);
    const res = await onCreateLink();
    setLinkBusy(false);
    if ("error" in res) setLinkErr(res.error);
    else {
      setLink(res.link);
      setInvites(await onFetchInvites());
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is visible to copy by hand */
    }
  }

  async function shareLink() {
    if (!link) return;
    try {
      await navigator.share({ text: "Help pack this list on Manifest:", url: link });
    } catch {
      /* dismissed */
    }
  }

  async function revoke(inviteId: string) {
    setLinkErr(null);
    const err = await onRevokeInvite(inviteId);
    if (err) setLinkErr(err);
    setInvites(await onFetchInvites());
  }

  const openInvites = invites.filter((i) => !i.revoked && i.expiresAt > Date.now() && i.uses < i.maxUses);
  const iAmOwner = !!shared?.members.some((m) => m.email === account && m.role === "owner");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);

  async function removeMember(userId: string) {
    setError(null);
    setMemberBusy(true);
    const err = await onRemoveMember(userId);
    setMemberBusy(false);
    setRemovingId(null);
    if (err) setError(err);
  }

  async function share() {
    setError(null);
    const err = await onShare();
    if (err) setError(err);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const em = email.trim();
    if (!em) return;
    const err = await onInvite(em);
    if (err) setError(err);
    else {
      setNotice(`Invited ${em} — the list will be there next time they open Manifest.`);
      setEmail("");
    }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Share this list">
      <h3>Pack it together</h3>

      {!account ? (
        <>
          <p>
            A shared list travels through your account — the server relays encrypted records it
            can't read, wrapped keys it can't open.
          </p>
          <p className="hint">Connect Sync first, then come back here to share it.</p>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={() => { onClose(); onOpenSync(); }}>Open Sync</button>
          </div>
        </>
      ) : !shared ? (
        <>
          <p>
            <strong>{list.title || "This list"}</strong>, packed together. Everyone you invite
            reads and writes the whole list — adds what you'd forget, checks off what's in the
            car.
          </p>
          <p className="hint">
            An item is claimed, never assigned: the list says needed, and someone says "I've got
            it." Nobody hands out chores.
          </p>
          {error ? <div className="error">{error}</div> : null}
          {sharedError ? <div className="error">{sharedError}</div> : null}
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={sharedBusy} onClick={() => void share()}>
              {sharedBusy ? "Sharing…" : "Share this list"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            <strong>{list.title || "This list"}</strong> — packed together. What anyone adds,
            everyone keeps: shared records also back up under your own account, encrypted.
          </p>

          {shared.members.length ? (
            <section className="set-section">
              <h4 className="set-head">Who's packing it</h4>
              {shared.members.map((m) => (
                <div key={m.userId} className="member-row">
                  <span className="member-email">{m.email}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span className="member-role">{m.role}</span>
                    {iAmOwner && m.email !== account ? (
                      removingId === m.userId ? (
                        <>
                          <button className="linklike" disabled={memberBusy} onClick={() => setRemovingId(null)}>keep</button>
                          <button className="linklike danger" disabled={memberBusy} onClick={() => void removeMember(m.userId)}>
                            {memberBusy ? "removing…" : "yes, remove"}
                          </button>
                        </>
                      ) : (
                        <button className="linklike danger" onClick={() => setRemovingId(m.userId)}>remove</button>
                      )
                    ) : null}
                  </span>
                </div>
              ))}
              {removingId ? (
                <p className="hint" style={{ marginTop: 8 }}>
                  Removing re-keys the list, so they can't read anything added afterwards. What's
                  already on their device stays theirs.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="set-section">
            <h4 className="set-head">Invite someone</h4>
            <p className="hint">
              By an address you already know. Their copy of the list's key is wrapped so only they
              can open it — the server just carries the envelope.
            </p>
            <form onSubmit={invite}>
              {notice ? <p className="hint">{notice}</p> : null}
              {error ? <div className="error">{error}</div> : null}
              {sharedError ? <div className="error">{sharedError}</div> : null}
              <div className="row">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="them@example.com"
                />
                <button type="submit" className="btn" disabled={sharedBusy || !email.trim()}>
                  {sharedBusy ? "Inviting…" : "Invite"}
                </button>
              </div>
            </form>
          </section>

          <section className="set-section">
            <h4 className="set-head">Or share a link</h4>
            <p className="hint">
              Anyone with the link can join, for 7 days or 20 uses, whichever comes first. The
              list's key rides inside the link itself — the server only ever holds a locked
              envelope — so send it somewhere you'd trust with the list.
            </p>
            {link ? (
              <>
                <div className="invite-link">{link}</div>
                <div className="sheet-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                  <button className="btn" onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</button>
                  {typeof navigator.share === "function" ? (
                    <button className="btn btn-ghost" onClick={() => void shareLink()}>Share…</button>
                  ) : null}
                </div>
              </>
            ) : (
              <button className="btn" disabled={linkBusy} onClick={() => void createLink()}>
                {linkBusy ? "Making a link…" : "Make an invite link"}
              </button>
            )}
            {linkErr ? <div className="error" style={{ marginTop: 10 }}>{linkErr}</div> : null}
            {openInvites.length ? (
              <div style={{ marginTop: 10 }}>
                {openInvites.map((i) => (
                  <div key={i.inviteId} className="member-row">
                    <span className="hint" style={{ margin: 0 }}>
                      Link from {new Date(i.createdAt).toLocaleDateString()} — used {i.uses} of {i.maxUses}
                    </span>
                    <button className="linklike danger" onClick={() => void revoke(i.inviteId)}>revoke</button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => void onRefresh()} disabled={sharedBusy}>
              {sharedBusy ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>

          <div className="danger-zone">
            {confirmLeave ? (
              <>
                <p className="hint">
                  Leaving stops sharing from this account. Everything already on this device stays
                  — the group's copy stays with the group.
                </p>
                <div className="sheet-actions">
                  <button className="btn btn-ghost" onClick={() => setConfirmLeave(false)}>Stay</button>
                  <button
                    className="btn btn-danger"
                    onClick={async () => {
                      const err = await onLeave();
                      if (err) setError(err);
                      else setConfirmLeave(false);
                    }}
                  >
                    Leave this shared list
                  </button>
                </div>
              </>
            ) : (
              <button className="linklike danger" onClick={() => setConfirmLeave(true)}>
                Leave this shared list
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

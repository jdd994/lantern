// HelpSheet.tsx
// A quiet in-app guide, opened from the "?" in the header. Grove's users
// include relatives who arrive by an invite link with no context at all, so
// this says plainly what each part is for. Topics are native disclosures —
// collapsed, so the sheet reads as a list to pick from, not a wall of text.
// Button names in the copy must match the real ones; keep them in step.
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Sheet } from "@lantern/ui";

function HelpItem({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="help-item" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="help-item-body">{children}</div>
    </details>
  );
}

export function HelpSheet({
  shared,
  onInstallHelp,
  onClose,
}: {
  // In a shared tree the family topic leads — it's what a new arrival needs.
  shared: boolean;
  onInstallHelp: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();

  const family = (
    <HelpItem key="family" title={t`One tree, written by the whole family`} defaultOpen={shared}>
      <p>
        <Trans>
          <b>Share</b> plants a tree the family tends together. It travels through an account, so
          connect <b>Sync</b> first. Then invite people by an email address you already know, or
          make an invite link — good for 7 days or 20 uses — and send it somewhere you'd trust
          with the family's story.
        </Trans>
      </p>
      <p>
        <Trans>
          Everyone in the tree can read and change everything: every person, every bond, every
          keepsake and its photo. That's deliberate — the invitation is the trust. Nothing is
          locked away from anyone you've let in.
        </Trans>
      </p>
      <p>
        <Trans>
          When someone else's hand was the last on a page you'll see <b>last tended by</b> and
          their name; on a keepsake, <b>kept by</b>. It's a byline, like a note in a family
          Bible — never a score.
        </Trans>
      </p>
      <p>
        <Trans>
          What the family writes is also kept, encrypted, under your own account. If you ever
          leave the shared tree, your copy of what was written stays with you.
        </Trans>
      </p>
    </HelpItem>
  );

  const start = (
    <HelpItem key="start" title={t`Start with one person`} defaultOpen={!shared}>
      <p>
        <Trans>
          Add anyone — yourself, a grandmother, whoever you know best. From their page, grow
          outward: <b>Add a parent</b>, <b>a partner</b>, <b>a child</b>, <b>a sibling</b>. Each
          new person is placed in the family in the same step.
        </Trans>
      </p>
      <p>
        <Trans>
          You don't need to know everything. A year can be <b>Exactly</b>, <b>About</b>,
          <b> Before</b> or <b>After</b>, or left empty. Half-known is welcome; it's how families
          actually remember.
        </Trans>
      </p>
      <p>
        <Trans>
          Families are made in more than one way. When you add a child or a parent you can say
          how they're linked — birth, adoptive, step, foster, or guardian — and the tree simply
          says so.
        </Trans>
      </p>
    </HelpItem>
  );

  return (
    <Sheet onClose={onClose} ariaLabel={t`How Grove works`}>
      <h3><Trans>How Grove works</Trans></h3>
      <p className="hint">
        <Trans>A private family tree: the people, how they belong to each other, and what the family still tells about them.</Trans>
      </p>

      <div className="help-body">
        {shared ? [family, start] : [start, family]}

        <HelpItem title={t`Names, the way they're said`}>
          <p>
            <Trans>
              Write a name the way it's actually said, in its own order, however many parts it
              has. If one part is the family name you can say which — Grove never guesses.
            </Trans>
          </p>
          <p>
            <Trans>
              <b>Family name at birth</b> is for a maiden name, or any family name that changed
              later. It shows on their page as <b>born …</b>.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`As the family remembers`}>
          <p>
            <Trans>
              The heart of each page. Who were they? What did they love, what did they always
              say? Write it the way you'd tell it at the table. It saves when you tap away.
            </Trans>
          </p>
          <p>
            <Trans>
              Dates and places tell you where someone stood. This part is who they were — and it's
              the part that disappears first if nobody writes it down.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Keepsakes`}>
          <p>
            <Trans>
              A photo, a scanned letter, a certificate. On a person's page tap <b>Add a keepsake</b>
              , choose a JPEG, PNG or PDF, and say what it is and roughly when it's from.
            </Trans>
          </p>
          <p>
            <Trans>
              <b>What it says, typed out</b> is worth the few minutes. Handwriting fades and is
              hard to read on a phone; typed words can be read aloud, translated, and carried to
              other genealogy tools when you export. The scan stays as the proof; the words become
              the memory.
            </Trans>
          </p>
          <p>
            <Trans>
              Photos are made smaller before they're stored, so a shoebox of scans stays kind to
              your device. A PDF can be up to 10 MB. iPhone photos in HEIC format may need saving
              as a JPEG first.
            </Trans>
          </p>
          <p>
            <Trans>
              Removing a keepsake (the <b>×</b> beside it) removes it for everyone in a shared
              tree, photo and all.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Not yet placed`}>
          <p>
            <Trans>
              Someone you've added but not linked to anyone waits under <b>Not yet placed</b>.
              Nothing is wrong — they still belong. Open a relative's page and add them from
              there when you learn where they fit.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Seeing the tree`}>
          <p>
            <Trans>
              <b>See the tree</b>, or <b>In the tree</b> on anyone's page, draws the family around
              one person: those they came from above, those who came from them below, partners
              alongside on a dashed line.
            </Trans>
          </p>
          <p>
            <Trans>
              Tap anyone to look at the tree from where they stand. Tap the person in the middle,
              or <b>Open their page</b>, to read about them. Brothers and sisters are listed on
              the person's page rather than in the drawing, to keep it readable.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`People who are still living`}>
          <p>
            <Trans>
              Mark someone <b>Still living</b> and Grove keeps only a name and their place in the
              tree. Their story is theirs to tell, when they join. If you export the tree, the
              living are kept private unless you deliberately choose otherwise.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Your passphrase, and the ways back in`}>
          <p>
            <Trans>
              Everything is encrypted on your device with your passphrase before it goes anywhere.
              Nobody else can read your family's tree — which also means nobody can reset the
              passphrase for you. So build a way back in <i>before</i> you need one. Both live
              under <b>Sync</b>:
            </Trans>
          </p>
          <p>
            <Trans>
              <b>A paper recovery kit</b> — a printed code that opens the vault. Keep it where you
              keep a passport.
            </Trans>
          </p>
          <p>
            <Trans>
              <b>Guardians</b> — a few people you trust who can jointly let you back in. You tell
              each of them a codeword out loud. No single guardian, and no server, ever holds
              your key.
            </Trans>
          </p>
          <p>
            <Trans>
              <b>Quick unlock</b> uses this device's fingerprint or face in place of typing. It's a
              convenience for one device; the passphrase stays the real key.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`If someone names you their guardian`}>
          <p>
            <Trans>
              Nothing happens today. If they ever lose their passphrase, a request appears for you
              under <b>Sync</b>. Before you approve, <b>speak to them</b> — in person or by phone
              — and have them say the codeword they once gave you. That spoken word is what
              stops an impostor.
            </Trans>
          </p>
          <p>
            <Trans>
              Enough guardians must approve, and then there's a waiting period of at least a day,
              so the real owner has time to notice and cancel a request that wasn't theirs.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Sync and other devices`}>
          <p>
            <Trans>
              Grove works with no account at all — the tree lives on this device. An account adds
              a backup, your other devices, and sharing. Its password is a separate secret from
              your passphrase: the account says whose data this is; only the passphrase can read
              it, and it never leaves your device.
            </Trans>
          </p>
          <p>
            <Trans>
              On a new phone or computer, open Grove, tap <b>Sign in to sync</b>, and unlock with
              the same passphrase. The button reads <b>Synced</b> when everything is safely backed up.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Taking your history with you`}>
          <p>
            <Trans>
              Under settings (the gear), <b>Export .ged</b> writes the tree as GEDCOM, the format
              every genealogy tool understands. Names, dates, bonds and the typed words of your
              keepsakes travel; the scans themselves stay in Grove.
            </Trans>
          </p>
          <p>
            <Trans>
              <b>Import a .ged</b> brings in a tree from elsewhere. It only ever adds — it never
              overwrites what's here, and it won't try to merge people who look alike.
            </Trans>
          </p>
        </HelpItem>

        <HelpItem title={t`Look, language, and the home screen`}>
          <p>
            <Trans>
              The gear also holds the vibe (three moods of light under the trees) and the
              language. Grove can sit on your home screen like any app —{" "}
              <button type="button" className="linklike" onClick={onInstallHelp}>here's how, step by step</button>.
            </Trans>
          </p>
        </HelpItem>
      </div>

      <div className="sheet-actions">
        <button className="btn btn-primary" onClick={onClose}><Trans>Close</Trans></button>
      </div>
    </Sheet>
  );
}

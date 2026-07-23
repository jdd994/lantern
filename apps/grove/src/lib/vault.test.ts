// vault.test.ts
// Grove's vault lifecycle through @lantern/core/vault, bound to Grove's own
// verifier token. The envelope scheme itself is proven in the core's tests;
// what's nailed down here is the composition: a Person payload sealed under
// the DEK survives unlock and a passphrase change, and the verifier token is
// pinned forever.

import { describe, expect, it } from "vitest";
import { createVault, openVault, rewrapVault } from "@lantern/core/vault";
import { VERIFIER_TEXT, encryptString, decryptString } from "./crypto";
import { decodePerson, encodePerson, type Person } from "./model";

const ITER = 1000; // fast; the real app uses 600k

const june: Person = {
  id: "june",
  names: [{ given: "June", family: "Hale" }],
  living: false,
  events: [{ kind: "birth", when: { time: Date.UTC(1931, 4, 2), precision: "day" } }],
  remembrance: "She sang while she cooked.",
  createdAt: 1000,
  updatedAt: 2000,
};

describe("grove vault", () => {
  it("pins the verifier token forever", () => {
    // Frozen parameter, same discipline as the siblings: change this string
    // and every existing vault stops verifying.
    expect(VERIFIER_TEXT).toBe("grove-ok");
  });

  it("creates, seals a person, and unlocks it again", async () => {
    const { dek, secrets } = await createVault("deep roots", VERIFIER_TEXT, ITER);
    const cipher = await encryptString(dek, encodePerson(june));

    const opened = await openVault("deep roots", secrets, VERIFIER_TEXT);
    expect(opened).not.toBeNull();
    const back = decodePerson(await decryptString(opened!.dek, cipher), {
      id: "june",
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(back).toEqual(june);
  });

  it("returns null on a wrong passphrase", async () => {
    const { secrets } = await createVault("deep roots", VERIFIER_TEXT, ITER);
    expect(await openVault("shallow roots", secrets, VERIFIER_TEXT)).toBeNull();
  });

  it("keeps every ciphertext readable across a passphrase change", async () => {
    const { dek, secrets } = await createVault("deep roots", VERIFIER_TEXT, ITER);
    const cipher = await encryptString(dek, encodePerson(june));

    const rewrapped = await rewrapVault(dek, "deep roots", "firm trunk", secrets, VERIFIER_TEXT, ITER);
    expect(rewrapped).not.toBeNull();
    const vault = { ...secrets, ...rewrapped! };

    expect(await openVault("deep roots", vault, VERIFIER_TEXT)).toBeNull();
    const opened = await openVault("firm trunk", vault, VERIFIER_TEXT);
    expect(opened).not.toBeNull();
    expect(await decryptString(opened!.dek, cipher)).toBe(encodePerson(june));
  });

  it("refuses a passphrase change when the current passphrase is wrong", async () => {
    const { dek, secrets } = await createVault("deep roots", VERIFIER_TEXT, ITER);
    expect(await rewrapVault(dek, "wrong", "next", secrets, VERIFIER_TEXT, ITER)).toBeNull();
  });
});

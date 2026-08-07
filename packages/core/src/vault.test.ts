// vault.test.ts — proves the vault lifecycle crypto end to end: create → open,
// wrong passphrase, legacy migration (no data re-encrypted), and change-passphrase
// (DEK unchanged, new opens, old fails). This is the safety net the three hooks
// lean on when they delegate their setup/unlock/change-passphrase to these.

import { describe, it, expect } from "vitest";
import { createVault, openVault, rewrapVault, setPassphraseFromDEK, verifyDEK } from "./vault";
import {
  deriveKeyFromSalt, makeVerifier, encryptString, decryptString, newSalt, exportKeyRaw,
} from "./crypto";

const TEXT = "test-ok";
const ITER = 1000; // fast; the app uses 600k

describe("vault lifecycle", () => {
  it("create → open: the same passphrase yields a DEK that reads the data", async () => {
    const { dek, secrets } = await createVault("correct horse", TEXT, ITER);
    const cipher = await encryptString(dek, "a secret");

    const opened = await openVault("correct horse", secrets, TEXT);
    expect(opened).not.toBeNull();
    expect(await decryptString(opened!.dek, cipher)).toBe("a secret");
    expect(opened!.migratedWrappedDEK).toBeUndefined(); // envelope vault, no migration
    expect(await verifyDEK(opened!.dek, secrets.verifier, TEXT)).toBe(true);
  });

  it("open with the wrong passphrase returns null", async () => {
    const { secrets } = await createVault("right", TEXT, ITER);
    expect(await openVault("wrong", secrets, TEXT)).toBeNull();
  });

  it("migrates a legacy vault in place, reading data that was never re-encrypted", async () => {
    // Legacy vault: the key is derived straight from the passphrase; verifier is
    // over that key; there is NO wrappedDEK.
    const salt = newSalt();
    const oldKey = await deriveKeyFromSalt("my pass", salt, ITER);
    const legacy = { salt, verifier: await makeVerifier(oldKey, TEXT), iterations: ITER };
    const oldData = await encryptString(oldKey, "written long ago");

    const opened = await openVault("my pass", legacy, TEXT);
    expect(opened).not.toBeNull();
    expect(opened!.migratedWrappedDEK).toBeDefined(); // migrated
    // The DEK is the old derived key, so old data reads without re-encryption.
    expect(await decryptString(opened!.dek, oldData)).toBe("written long ago");

    // And the migrated vault (now with wrappedDEK) reopens envelope-style.
    const migrated = { ...legacy, wrappedDEK: opened!.migratedWrappedDEK };
    const reopened = await openVault("my pass", migrated, TEXT);
    expect(reopened).not.toBeNull();
    expect(reopened!.migratedWrappedDEK).toBeUndefined();
    expect(await decryptString(reopened!.dek, oldData)).toBe("written long ago");
  });

  it("change passphrase: DEK unchanged, new passphrase opens, old one fails", async () => {
    const { dek, secrets } = await createVault("pass-A", TEXT, ITER);
    const dekBefore = await exportKeyRaw(dek);
    const data = await encryptString(dek, "keep me");

    const updated = await rewrapVault(dek, "pass-A", "pass-B", secrets, TEXT, ITER);
    expect(updated).not.toBeNull();

    const newVault = { ...secrets, ...updated! };
    const openedNew = await openVault("pass-B", newVault, TEXT);
    expect(openedNew).not.toBeNull();
    // Data written before the change still reads (DEK never changed).
    expect(await decryptString(openedNew!.dek, data)).toBe("keep me");
    expect(await exportKeyRaw(openedNew!.dek)).toEqual(dekBefore);

    // The old passphrase no longer opens the updated vault.
    expect(await openVault("pass-A", newVault, TEXT)).toBeNull();
  });

  it("change passphrase with the wrong current passphrase returns null", async () => {
    const { dek, secrets } = await createVault("real", TEXT, ITER);
    expect(await rewrapVault(dek, "not-real", "new", secrets, TEXT, ITER)).toBeNull();
  });

  it("setPassphraseFromDEK: sets a fresh passphrase from a DEK obtained without one (social recovery)", async () => {
    const { dek, secrets } = await createVault("original", TEXT, ITER);
    const dekBefore = await exportKeyRaw(dek);
    const data = await encryptString(dek, "recovered data");

    // No current passphrase involved — this is the DEK as reconstructed by a
    // guardian circle, not derived from any passphrase the caller knows.
    const fresh = await setPassphraseFromDEK(dek, "brand-new-passphrase", TEXT, ITER);
    const recoveredVault = { ...secrets, ...fresh };

    const opened = await openVault("brand-new-passphrase", recoveredVault, TEXT);
    expect(opened).not.toBeNull();
    expect(await exportKeyRaw(opened!.dek)).toEqual(dekBefore);
    expect(await decryptString(opened!.dek, data)).toBe("recovered data");

    // The old passphrase no longer opens the vault.
    expect(await openVault("original", recoveredVault, TEXT)).toBeNull();
  });
});

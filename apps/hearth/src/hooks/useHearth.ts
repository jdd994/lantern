// useHearth.ts
// The ONLY place state, IO, and the decrypted key meet. Everything else is pure
// logic (lib/) or a presentational component. If plaintext can only leave memory
// through this file, then verifying "what you ate never reaches disk unencrypted"
// means reading this one file.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportKeyRaw, importKeyRaw, openJSON, sealJSON, PBKDF2_ITERATIONS, VERIFIER_TEXT,
  exportPublicKeyB64,
} from "../lib/crypto";
import { createVault, openVault, rewrapVault, verifyDEK } from "@lantern/core/vault";
import * as db from "../lib/db";
import * as api from "../lib/api";
import { syncNow } from "../lib/sync";
import { biometricSupported, enrollBiometric, unlockBiometric } from "../lib/biometric";
import {
  dayBounds, windowTotal, goalProgress, recipeAsFood,
  type Food, type FoodLog, type FoodLogContent, type Goal, type GoalContent,
  type GoalProgress, type Nutrients, type Recipe, type RecipeContent,
} from "../lib/nutrition";
import type { Metric, MetricContent } from "../lib/metrics";
import { startOfDay, type PlanContent, type PlanEntry } from "../lib/mealplan";
import type { PantryItem } from "../lib/pantry";
import { KITCHEN_META_ID, type Kitchen, type KitchenMeta, type SharedPlan, type SharedPlanContent } from "../lib/kitchen";
import { unwrapPrivateKey, generateDEK } from "@lantern/core/crypto";
import { wrapDEKForRecipient, unwrapDEK, importPublicKeyB64 } from "@lantern/core/sharing";

export type Status = "loading" | "setup" | "locked" | "unlocked";

export type Hearth = {
  status: Status;
  error: string | null;
  busy: boolean;

  logs: FoodLog[];
  goals: Goal[];
  recipes: Recipe[];
  metrics: Metric[];
  plans: PlanEntry[];
  pantry: PantryItem[];

  today: Nutrients; // derived: today's running total
  progressFor: (g: Goal) => GoalProgress;

  canBiometric: boolean;
  hasBiometric: boolean;

  // Cross-device sync. `account` is the connected email, or null when this log
  // lives only on this device. The account (login) is a separate secret from the
  // passphrase: the server authenticates the account and stores opaque
  // ciphertext; the passphrase decrypts it and never leaves the device.
  account: string | null;
  syncing: boolean;
  syncError: string | null;
  connectCreate: (email: string, password: string) => Promise<boolean>;
  connectSignIn: (email: string, password: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
  changePassphrase: (current: string, next: string) => Promise<string | null>;
  syncNow: () => Promise<void>;

  setup: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  enableBiometric: () => Promise<boolean>;
  lock: () => void;

  logFood: (food: Food, amountGrams: number, at?: number, note?: string) => Promise<void>;
  removeLog: (id: string) => Promise<void>;
  addGoal: (content: GoalContent) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;

  addRecipe: (content: RecipeContent) => Promise<void>;
  removeRecipe: (id: string) => Promise<void>;
  logRecipeServing: (recipe: Recipe) => Promise<void>;

  addPlan: (content: PlanContent, at: number) => Promise<void>;
  removePlan: (id: string) => Promise<void>;
  cookPlan: (entry: PlanEntry) => Promise<void>;

  addPantryItem: (foodId: string, name: string) => Promise<void>;
  removePantryItem: (id: string) => Promise<void>;

  // Shared kitchens — the only part of Hearth another person can see, opt-in per
  // kitchen. Your log, body metrics and goals never enter one.
  kitchens: Kitchen[];
  kitchenBusy: boolean;
  kitchenError: string | null;
  createKitchen: (name: string) => Promise<void>;
  sharePlan: (strandId: string, content: SharedPlanContent) => Promise<void>;
  removeSharedPlan: (strandId: string, id: string) => Promise<void>;
  inviteToKitchen: (strandId: string, email: string) => Promise<string | null>;
  shareRecipe: (strandId: string, recipe: Recipe) => Promise<void>;
  syncKitchens: () => Promise<void>;

  logMetric: (content: MetricContent, at?: number) => Promise<void>;
  removeMetric: (id: string) => Promise<void>;
};

const uid = () => crypto.randomUUID();

export function useHearth(): Hearth {
  const keyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [kitchenBusy, setKitchenBusy] = useState(false);
  const [kitchenError, setKitchenError] = useState<string | null>(null);
  // The identity keypair and each kitchen's key stay in refs — never in React
  // state, never persisted in the clear. Same discipline as the vault key.
  const identityRef = useRef<CryptoKeyPair | null>(null);
  const kitchenKeys = useRef<Map<string, { dek: CryptoKey; dekEpoch: number }>>(new Map());
  const [canBiometric, setCanBiometric] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);

  useEffect(() => {
    (async () => {
      const [vault, device, supported, sync] = await Promise.all([
        db.getVault(), db.getDevice(), biometricSupported(), db.getSyncState(),
      ]);
      setCanBiometric(supported);
      setHasBiometric(!!device);
      if (sync?.token) {
        tokenRef.current = sync.token;
        setAccount(sync.accountEmail ?? null);
      }
      setStatus(vault ? "locked" : "setup");
    })();
  }, []);

  const loadAll = useCallback(async (key: CryptoKey) => {
    const [sl, sg, sr, sm, sp, spa] = await Promise.all([
      db.allFoodLogs(), db.allGoals(), db.allRecipes(), db.allMetrics(), db.allMealPlans(), db.allPantry(),
    ]);
    const l = await Promise.all(
      sl.filter((r) => !r.deleted).map(async (r): Promise<FoodLog> => {
        const c = await openJSON<FoodLogContent>(key, r.content);
        return { ...c, id: r.id, at: r.at };
      })
    );
    const g = await Promise.all(
      sg.filter((r) => !r.deleted).map(async (r): Promise<Goal> => {
        const c = await openJSON<GoalContent>(key, r.content);
        return { ...c, id: r.id };
      })
    );
    const rc = await Promise.all(
      sr.filter((r) => !r.deleted).map(async (r): Promise<Recipe> => {
        const c = await openJSON<RecipeContent>(key, r.content);
        return { ...c, id: r.id };
      })
    );
    const m = await Promise.all(
      sm.filter((r) => !r.deleted).map(async (r): Promise<Metric> => {
        const c = await openJSON<MetricContent>(key, r.content);
        return { ...c, id: r.id, at: r.at };
      })
    );
    const pl = await Promise.all(
      sp.filter((r) => !r.deleted).map(async (r): Promise<PlanEntry> => {
        const c = await openJSON<PlanContent>(key, r.content);
        return { ...c, id: r.id, at: r.at };
      })
    );
    const pa = await Promise.all(
      spa.filter((r) => !r.deleted).map(async (r): Promise<PantryItem> => {
        const c = await openJSON<{ foodId: string; name: string }>(key, r.content);
        return { ...c, id: r.id, addedAt: r.createdAt };
      })
    );
    setLogs(l);
    setGoals(g);
    setRecipes(rc);
    setMetrics(m);
    setPlans(pl);
    setPantry(pa);
  }, []);

  // ---- sync ---------------------------------------------------------------
  // Reconcile with the server: pull others' changes (LWW by updatedAt), then
  // push ours. Only ciphertext moves. If the pull changed anything, re-decrypt
  // the view so the screen matches the log.
  const runSync = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const changed = await syncNow(token);
      if (changed) await loadAll(key);
    } catch (e) {
      // A failed sync is never fatal: data is safe locally and dirty records
      // stay dirty, so the next attempt retries them.
      setSyncError(e instanceof Error ? e.message : "Couldn't reach sync just now.");
    } finally {
      setSyncing(false);
    }
  }, [loadAll]);

  // Debounced sync after a write. Coalesces a burst of edits into one round-trip.
  const scheduleSync = useCallback(() => {
    if (!tokenRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync(), 1500);
  }, [runSync]);

  const setup = useCallback(async (passphrase: string) => {
    setBusy(true);
    setError(null);
    try {
      // Envelope model (see @lantern/core/vault): a random DEK encrypts the data;
      // the passphrase only wraps it, so it can change later without re-encrypting.
      const { dek, secrets } = await createVault(passphrase, VERIFIER_TEXT);
      await db.saveVault({ id: "vault", ...secrets, createdAt: Date.now() });
      keyRef.current = dek;
      setStatus("unlocked");
    } finally {
      setBusy(false);
    }
  }, []);

  const finishUnlock = useCallback(async (key: CryptoKey) => {
    keyRef.current = key;
    await loadAll(key);
    setStatus("unlocked");
    if (tokenRef.current) void runSync();
  }, [loadAll, runSync]);

  const unlock = useCallback(async (passphrase: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const vault = await db.getVault();
      if (!vault) return false;
      // Delegates the unwrap-or-migrate logic to the tested vault module.
      const opened = await openVault(passphrase, vault, VERIFIER_TEXT);
      if (!opened) {
        setError("That passphrase doesn't open this vault.");
        return false;
      }
      if (opened.migratedWrappedDEK) {
        await db.saveVault({ ...vault, wrappedDEK: opened.migratedWrappedDEK });
      }
      await finishUnlock(opened.dek);
      return true;
    } finally {
      setBusy(false);
    }
  }, [finishUnlock]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setError(null);
    const [vault, device] = await Promise.all([db.getVault(), db.getDevice()]);
    if (!vault || !device) return false;
    const raw = await unlockBiometric(device);
    if (!raw) { setError("Couldn't unlock with biometrics. Use your passphrase."); return false; }
    const key = await importKeyRaw(raw);
    if (!(await verifyDEK(key, vault.verifier, VERIFIER_TEXT))) {
      await db.clearDevice();
      setHasBiometric(false);
      setError("This device's quick unlock is out of date. Use your passphrase.");
      return false;
    }
    await finishUnlock(key);
    return true;
  }, [finishUnlock]);

  const enableBiometric = useCallback(async (): Promise<boolean> => {
    const key = keyRef.current;
    if (!key) return false;
    const enrollment = await enrollBiometric(await exportKeyRaw(key));
    if (!enrollment) { setError("This device can't do biometric unlock."); return false; }
    await db.saveDevice({ id: "device", ...enrollment });
    setHasBiometric(true);
    return true;
  }, []);

  const lock = useCallback(() => {
    keyRef.current = null;
    setLogs([]);
    setGoals([]);
    setRecipes([]);
    setMetrics([]);
    setPlans([]);
    setPantry([]);
    setKitchens([]);
    identityRef.current = null;
    kitchenKeys.current.clear();
    setError(null);
    setStatus("locked");
  }, []);

  // ---- account (sync) -----------------------------------------------------

  // Connect this device's existing vault to a NEW account. The passphrase is
  // never sent — only the salt + verifier (which reveal nothing) so the same
  // vault can be re-derived on another device. The account password is a
  // separate secret that only authenticates the account.
  const connectCreate = useCallback(async (email: string, password: string): Promise<boolean> => {
    setSyncError(null);
    const em = email.trim().toLowerCase();
    const vault = await db.getVault();
    if (!vault) { setSyncError("Set up your log on this device first."); return false; }
    if (!vault.identityPrivate) { setSyncError("This vault predates sync. Re-create it to connect an account."); return false; }
    setSyncing(true);
    try {
      const { token } = await api.register(
        em, password,
        { salt: vault.salt, verifier: vault.verifier, iterations: vault.iterations, wrappedDEK: vault.wrappedDEK },
        vault.identityPublic ?? "", vault.identityPrivate
      );
      tokenRef.current = token;
      setAccount(em);
      const st = await db.getSyncState();
      await db.saveSyncState({ id: "state", cursor: st?.cursor ?? 0, token, accountEmail: em });
      await db.markAllDirty();
      await runSync();
      return true;
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Couldn't create that account.");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [runSync]);

  // Sign in to an existing account from a second device. Downloads the vault
  // metadata (salt + verifier) so the passphrase can re-derive the same key
  // here. On a fresh device this installs the vault and drops to the lock
  // screen; unlocking then pulls the ciphertext down.
  const connectSignIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    setSyncError(null);
    const em = email.trim().toLowerCase();
    setSyncing(true);
    try {
      const { token } = await api.login(em, password);
      const dto = await api.fetchVault(token);
      tokenRef.current = token;
      setAccount(em);
      const local = await db.getVault();
      if (!local) {
        await db.saveVault({
          id: "vault", salt: dto.salt, verifier: dto.verifier, createdAt: Date.now(),
          iterations: dto.iterations ?? PBKDF2_ITERATIONS,
          wrappedDEK: dto.wrappedDEK ?? undefined,
          identityPrivate: dto.identityPrivWrapped ?? undefined,
        });
        setStatus("locked");
      }
      await db.saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
      if (keyRef.current) await runSync();
      return true;
    } catch (e) {
      tokenRef.current = null;
      setAccount(null);
      setSyncError(e instanceof Error ? e.message : "Couldn't sign in.");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [runSync]);

  // Stop syncing from this device. Local data and the vault stay put; only the
  // token and cursor are dropped, so no more ciphertext moves either way.
  const disconnect = useCallback(async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    tokenRef.current = null;
    setAccount(null);
    setSyncError(null);
    const st = await db.getSyncState();
    await db.saveSyncState({ id: "state", cursor: st?.cursor ?? 0 });
  }, []);

  // Permanently delete the account and every blob on the server, then disconnect.
  // Local data stays on this device — only the cloud copy is removed.
  const deleteAccount = useCallback(async (): Promise<boolean> => {
    const token = tokenRef.current;
    if (!token) return false;
    setSyncError(null);
    setSyncing(true);
    try {
      await api.deleteAccount(token);
      await disconnect();
      return true;
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Couldn't delete the account.");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [disconnect]);

  // Change the passphrase (must be unlocked). Envelope encryption makes this
  // instant and re-encrypts NOTHING — it only re-wraps the DEK under a key from
  // the new passphrase. Other devices keep reading their data with the unchanged
  // DEK, and biometric quick-unlock still works. Returns an error, or null.
  const changePassphrase = useCallback(async (current: string, next: string): Promise<string | null> => {
    const dek = keyRef.current;
    if (!dek) return "Unlock the log first.";
    if (next.length < 8) return "Use at least 8 characters for the new passphrase.";
    const vault = await db.getVault();
    if (!vault) return "No vault on this device.";

    // Verify the current passphrase + re-wrap the DEK, via the tested vault module.
    const rewrapped = await rewrapVault(dek, current, next, vault, VERIFIER_TEXT);
    if (!rewrapped) return "That current passphrase isn't right.";
    const updated = { ...vault, ...rewrapped };
    await db.saveVault(updated);

    const token = tokenRef.current;
    if (token) {
      try {
        await api.updateVault(token, {
          salt: updated.salt, verifier: updated.verifier,
          iterations: updated.iterations, wrappedDEK: updated.wrappedDEK,
        });
      } catch (e) {
        return e instanceof Error
          ? `Changed on this device, but the server didn't update: ${e.message}`
          : "Changed on this device, but the server couldn't be reached.";
      }
    }
    return null;
  }, []);

  // ---- writes: encrypt -> update memory -> persist -----------------------

  const logFood = useCallback(async (food: Food, amountGrams: number, at?: number, note?: string) => {
    const key = keyRef.current;
    if (!key) return;
    const when = at ?? Date.now();
    const content: FoodLogContent = {
      foodId: food.id,
      name: food.name,
      amountGrams,
      per100g: food.per100g, // snapshot — history never rewritten
      note: note?.trim() || undefined,
    };
    const id = uid();
    setLogs((prev) => [...prev, { ...content, id, at: when }]);
    await db.putFoodLog({
      id, at: when, createdAt: Date.now(), updatedAt: Date.now(),
      deleted: false, dirty: true, content: await sealJSON(key, content),
    });
    scheduleSync();
  }, [scheduleSync]);

  const removeLog = useCallback(async (id: string) => {
    setLogs((prev) => prev.filter((l) => l.id !== id));
    const stored = await db.getFoodLog(id);
    if (stored) await db.putFoodLog({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    scheduleSync();
  }, [scheduleSync]);

  const addGoal = useCallback(async (content: GoalContent) => {
    const key = keyRef.current;
    if (!key) return;
    const id = uid();
    setGoals((prev) => [...prev, { ...content, id }]);
    await db.putGoal({
      id, createdAt: Date.now(), updatedAt: Date.now(),
      deleted: false, dirty: true, content: await sealJSON(key, content),
    });
    scheduleSync();
  }, [scheduleSync]);

  const removeGoal = useCallback(async (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    const stored = (await db.allGoals()).find((g) => g.id === id);
    if (stored) await db.putGoal({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    scheduleSync();
  }, [scheduleSync]);

  // ---- recipes -----------------------------------------------------------

  const addRecipe = useCallback(async (content: RecipeContent) => {
    const key = keyRef.current;
    if (!key) return;
    const id = uid();
    setRecipes((prev) => [...prev, { ...content, id }]);
    await db.putRecipe({
      id, createdAt: Date.now(), updatedAt: Date.now(),
      deleted: false, dirty: true, content: await sealJSON(key, content),
    });
    scheduleSync();
  }, [scheduleSync]);

  const removeRecipe = useCallback(async (id: string) => {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    const stored = (await db.allRecipes()).find((r) => r.id === id);
    if (stored) await db.putRecipe({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    scheduleSync();
  }, [scheduleSync]);

  // Cooking a recipe = logging one serving, through the ordinary food-log path
  // (recipeAsFood normalises it, so the serving's nutrients reproduce exactly).
  const logRecipeServing = useCallback(async (recipe: Recipe) => {
    const food = recipeAsFood(recipe);
    await logFood(food, food.portions[0].grams);
  }, [logFood]);

  // ---- meal plans --------------------------------------------------------
  // Planning is a PULL surface: you look at the week when you want to. Nothing
  // here nags, and a day you didn't cook is not a failure — just a day.

  const addPlan = useCallback(async (content: PlanContent, at: number) => {
    const key = keyRef.current;
    if (!key) return;
    const id = uid();
    const day = startOfDay(at);
    setPlans((prev) => [...prev, { ...content, id, at: day }]);
    await db.putMealPlan({
      id, at: day, createdAt: Date.now(), updatedAt: Date.now(),
      deleted: false, dirty: true, content: await sealJSON(key, content),
    });
    scheduleSync();
  }, [scheduleSync]);

  const removePlan = useCallback(async (id: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== id));
    const stored = (await db.allMealPlans()).find((p) => p.id === id);
    if (stored) await db.putMealPlan({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    scheduleSync();
  }, [scheduleSync]);

  // Cooking a planned meal logs it through the ordinary food-log path (so the
  // nutrients reproduce exactly), then marks the entry cooked so the week shows
  // what's been made.
  const cookPlan = useCallback(async (entry: PlanEntry) => {
    const key = keyRef.current;
    if (!key) return;
    if (entry.kind === "recipe") {
      const recipe = recipes.find((r) => r.id === entry.recipeId);
      if (!recipe) {
        setError("That recipe isn't here any more, so there's nothing to log.");
        return;
      }
      const food = recipeAsFood(recipe);
      await logFood(food, food.portions[0].grams * entry.servings);
    } else {
      await logFood(
        {
          id: entry.foodId,
          name: entry.name,
          source: "custom",
          portions: [{ label: "planned", grams: entry.grams }],
          per100g: entry.per100g,
        },
        entry.grams
      );
    }
    const cookedAt = Date.now();
    const { id: _id, at: _at, ...content } = entry;
    const next: PlanContent = { ...content, cookedAt };
    setPlans((prev) => prev.map((p) => (p.id === entry.id ? { ...p, cookedAt } : p)));
    const stored = (await db.allMealPlans()).find((p) => p.id === entry.id);
    if (stored) {
      await db.putMealPlan({
        ...stored, updatedAt: Date.now(), dirty: true, content: await sealJSON(key, next),
      });
    }
    scheduleSync();
  }, [recipes, logFood, scheduleSync]);

  // ---- pantry ------------------------------------------------------------
  // What's in the cupboard, so "what can I make?" can be answered offline. No
  // quantities on purpose: a pantry that demands you weigh your rice is one
  // nobody updates (see lib/pantry.ts).

  const addPantryItem = useCallback(async (foodId: string, name: string) => {
    const key = keyRef.current;
    if (!key) return;
    const id = uid();
    const now = Date.now();
    setPantry((prev) => [...prev, { id, foodId, name, addedAt: now }]);
    await db.putPantryItem({
      id, createdAt: now, updatedAt: now,
      deleted: false, dirty: true, content: await sealJSON(key, { foodId, name }),
    });
    scheduleSync();
  }, [scheduleSync]);

  const removePantryItem = useCallback(async (id: string) => {
    setPantry((prev) => prev.filter((p) => p.id !== id));
    const stored = (await db.allPantry()).find((p) => p.id === id);
    if (stored) await db.putPantryItem({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    scheduleSync();
  }, [scheduleSync]);

  // ---- body metrics ------------------------------------------------------

  const logMetric = useCallback(async (content: MetricContent, at?: number) => {
    const key = keyRef.current;
    if (!key) return;
    const when = at ?? Date.now();
    const id = uid();
    setMetrics((prev) => [...prev, { ...content, id, at: when }]);
    await db.putMetric({
      id, at: when, createdAt: Date.now(), updatedAt: Date.now(),
      deleted: false, dirty: true, content: await sealJSON(key, content),
    });
    scheduleSync();
  }, [scheduleSync]);

  const removeMetric = useCallback(async (id: string) => {
    setMetrics((prev) => prev.filter((m) => m.id !== id));
    const stored = (await db.allMetrics()).find((m) => m.id === id);
    if (stored) await db.putMetric({ ...stored, deleted: true, dirty: true, updatedAt: Date.now() });
    scheduleSync();
  }, [scheduleSync]);

  // ---- derived -----------------------------------------------------------
  const { from, to } = dayBounds(Date.now());
  const today = windowTotal(logs, from, to);
  // ---- shared kitchens ----------------------------------------------------
  // A kitchen has its own key. Its recipes are encrypted with THAT key, and every
  // member holds a copy of it wrapped to their identity key — so the server (and
  // anyone who breaches it) sees only ciphertext and membership, never a recipe.
  //
  // Nothing here is stored locally: a kitchen is pulled fresh each session and
  // decrypted into memory. Sharing a kitchen shares RECIPES — never your food log,
  // your body metrics, or your goals. Cooking one logs privately to you.

  // The identity keypair, unwrapped with the vault key. It's what makes a kitchen's
  // key deliverable to you and to nobody else.
  const ensureIdentity = useCallback(async (): Promise<CryptoKeyPair | null> => {
    if (identityRef.current) return identityRef.current;
    const key = keyRef.current;
    const vault = await db.getVault();
    if (!key || !vault?.identityPublic || !vault?.identityPrivate) return null;
    try {
      identityRef.current = {
        publicKey: await importPublicKeyB64(vault.identityPublic),
        privateKey: await unwrapPrivateKey(key, vault.identityPrivate),
      };
      return identityRef.current;
    } catch {
      return null;
    }
  }, []);

  const syncKitchens = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    const kp = await ensureIdentity();
    if (!kp) return;
    setKitchenBusy(true);
    setKitchenError(null);
    try {
      const { strands } = await api.sharedMine(token);
      const next: Kitchen[] = [];
      for (const s of strands) {
        let entry = kitchenKeys.current.get(s.strandId);
        // New to us, or re-keyed because someone was removed — unwrap our copy again.
        if (!entry || entry.dekEpoch !== s.dekEpoch) {
          try {
            entry = { dek: await unwrapDEK(kp.privateKey, s.ephemeralPub, s.wrappedDEK), dekEpoch: s.dekEpoch };
            kitchenKeys.current.set(s.strandId, entry);
          } catch {
            continue; // can't unwrap our copy — skip rather than guess
          }
        }
        const { changes } = await api.sharedPull(token, s.strandId, 0);
        let name = "Kitchen";
        const shared: Recipe[] = [];
        const sharedPlans: SharedPlan[] = [];
        for (const ch of changes) {
          if (ch.deleted) continue;
          try {
            if (ch.kind === "meta") {
              name = (await openJSON<KitchenMeta>(entry.dek, ch.content)).name || name;
            } else if (ch.kind === "recipe") {
              shared.push({ ...(await openJSON<RecipeContent>(entry.dek, ch.content)), id: ch.id });
            } else if (ch.kind === "mealPlan") {
              sharedPlans.push({ ...(await openJSON<SharedPlanContent>(entry.dek, ch.content)), id: ch.id });
            }
          } catch {
            // one unreadable record shouldn't blank the whole kitchen
          }
        }
        sharedPlans.sort((a, b) => a.at - b.at);
        next.push({
          strandId: s.strandId, ownerId: s.ownerId, role: s.role, dekEpoch: s.dekEpoch,
          name, recipes: shared, plans: sharedPlans,
        });
      }
      setKitchens(next);
    } catch (e) {
      setKitchenError(e instanceof Error ? e.message : "Couldn't reach your kitchens just now.");
    } finally {
      setKitchenBusy(false);
    }
  }, [ensureIdentity]);

  const createKitchen = useCallback(async (name: string) => {
    const token = tokenRef.current;
    if (!token) { setKitchenError("Connect an account first — a kitchen is shared through it."); return; }
    const kp = await ensureIdentity();
    if (!kp) { setKitchenError("This vault has no identity key. Re-create it to share."); return; }
    setKitchenBusy(true);
    setKitchenError(null);
    try {
      const dek = await generateDEK();
      const strandId = uid();
      const mine = await wrapDEKForRecipient(await exportPublicKeyB64(kp.publicKey), dek);
      await api.createShared(token, strandId, mine.ephemeralPub, mine.wrappedDEK);
      kitchenKeys.current.set(strandId, { dek, dekEpoch: 1 });
      const now = Date.now();
      await api.sharedPush(token, strandId, [{
        kind: "meta", id: KITCHEN_META_ID, createdAt: now, updatedAt: now,
        deleted: false, dekEpoch: 1,
        content: await sealJSON(dek, { name: name.trim() || "Our kitchen" } as KitchenMeta),
      }]);
      await syncKitchens();
    } catch (e) {
      setKitchenError(e instanceof Error ? e.message : "Couldn't make that kitchen.");
    } finally {
      setKitchenBusy(false);
    }
  }, [ensureIdentity, syncKitchens]);

  // Invite by an address you already know — there's no directory to browse. We
  // fetch their public key and wrap THIS kitchen's key to it; the server only ever
  // relays the wrapped copy.
  const inviteToKitchen = useCallback(async (strandId: string, email: string): Promise<string | null> => {
    const token = tokenRef.current;
    const entry = kitchenKeys.current.get(strandId);
    if (!token || !entry) return "That kitchen isn't ready yet.";
    setKitchenBusy(true);
    try {
      const { identityPublicKey } = await api.fetchKeys(token, email.trim().toLowerCase());
      if (!identityPublicKey) return "They have an account, but no key to share with yet — ask them to open Hearth once.";
      const wrapped = await wrapDEKForRecipient(identityPublicKey, entry.dek);
      await api.inviteToStrand(token, strandId, email.trim().toLowerCase(), wrapped.ephemeralPub, wrapped.wrappedDEK, entry.dekEpoch);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't invite them just now.";
    } finally {
      setKitchenBusy(false);
    }
  }, []);

  // Put one of your recipes in a kitchen. It's copied in (encrypted with the
  // kitchen's key); your own copy stays yours.
  const shareRecipe = useCallback(async (strandId: string, recipe: Recipe) => {
    const token = tokenRef.current;
    const entry = kitchenKeys.current.get(strandId);
    if (!token || !entry) return;
    setKitchenBusy(true);
    setKitchenError(null);
    try {
      const now = Date.now();
      const { id: _id, ...content } = recipe;
      await api.sharedPush(token, strandId, [{
        kind: "recipe", id: uid(), createdAt: now, updatedAt: now,
        deleted: false, dekEpoch: entry.dekEpoch,
        content: await sealJSON(entry.dek, content as RecipeContent),
      }]);
      await syncKitchens();
    } catch (e) {
      setKitchenError(e instanceof Error ? e.message : "Couldn't share that recipe.");
    } finally {
      setKitchenBusy(false);
    }
  }, [syncKitchens]);

  // Put a meal on the kitchen's week. Co-authored: anyone in the kitchen can add
  // one, and everyone sees it. Still no nagging — you look at it when you want to.
  const sharePlan = useCallback(async (strandId: string, content: SharedPlanContent) => {
    const token = tokenRef.current;
    const entry = kitchenKeys.current.get(strandId);
    if (!token || !entry) return;
    setKitchenBusy(true);
    setKitchenError(null);
    try {
      const now = Date.now();
      await api.sharedPush(token, strandId, [{
        kind: "mealPlan", id: uid(), createdAt: now, updatedAt: now,
        deleted: false, dekEpoch: entry.dekEpoch,
        content: await sealJSON(entry.dek, content),
      }]);
      await syncKitchens();
    } catch (e) {
      setKitchenError(e instanceof Error ? e.message : "Couldn't add that to the plan.");
    } finally {
      setKitchenBusy(false);
    }
  }, [syncKitchens]);

  const removeSharedPlan = useCallback(async (strandId: string, id: string) => {
    const token = tokenRef.current;
    const entry = kitchenKeys.current.get(strandId);
    if (!token || !entry) return;
    setKitchenBusy(true);
    try {
      const now = Date.now();
      await api.sharedPush(token, strandId, [{
        kind: "mealPlan", id, createdAt: now, updatedAt: now,
        deleted: true, dekEpoch: entry.dekEpoch,
        content: await sealJSON(entry.dek, {} as SharedPlanContent),
      }]);
      await syncKitchens();
    } finally {
      setKitchenBusy(false);
    }
  }, [syncKitchens]);

  const progressFor = useCallback((g: Goal) => goalProgress(g, today), [today]);

  return {
    status, error, busy, logs, goals, recipes, metrics, plans, pantry, today, progressFor,
    canBiometric, hasBiometric,
    account, syncing, syncError, connectCreate, connectSignIn, disconnect, deleteAccount, changePassphrase, syncNow: runSync,
    setup, unlock, unlockWithBiometric, enableBiometric, lock,
    logFood, removeLog, addGoal, removeGoal,
    addRecipe, removeRecipe, logRecipeServing,
    addPlan, removePlan, cookPlan,
    addPantryItem, removePantryItem,
    kitchens, kitchenBusy, kitchenError, createKitchen, inviteToKitchen, shareRecipe, syncKitchens,
    sharePlan, removeSharedPlan,
    logMetric, removeMetric,
  };
}

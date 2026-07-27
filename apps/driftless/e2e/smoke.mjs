// e2e/smoke.mjs — end-to-end smoke test for the paths unit tests can't see:
// the state+IO wiring in useJournal. Drives the real app in headless Chromium
// through a full journey and, crucially, RELOADS between writing and reading —
// persistence bugs (like the 2026-07 strand-membership loss, fixed in 6311be9)
// only show up across a reload.
//
//   npm run e2e        (spawns its own dev server on :5199, no setup needed)
//
// Journey: set up a vault → keep a thought in the Stream → create a strand →
// write the first passage into it → start a chapter → add a piece to that
// chapter → drop in a photo → pull in the Stream thought → reload → unlock →
// verify every piece survived, then delete one and verify the removal survives
// a second reload.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const APP_DIR = new URL("..", import.meta.url).pathname;
const PASS = "correct horse battery staple";

// 1x1 PNG for the photo path (compressImage re-encodes it in-browser).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const THOUGHT = "Loose thought about the river.";
const PASSAGE = "She kept the lamp lit until everyone was home.";
const CHAPTER = "Chapter One";
const IN_CHAPTER = "The house smelled of cedar and rain.";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

// ---- dev server -----------------------------------------------------------
const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: APP_DIR,
  detached: true,
  stdio: "ignore",
});
const stopServer = () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
};
process.on("exit", stopServer);

for (let i = 0; ; i++) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (i > 60) {
      fail("dev server never came up on :" + PORT);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---- drive ----------------------------------------------------------------
const errors = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(BASE);

  // First run: welcome → passphrase → device-only (no account, no sync).
  await page.locator(".welcome-begin").click();
  await page.getByPlaceholder("Passphrase").fill(PASS);
  await page.getByPlaceholder("Type it again").fill(PASS);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Skip — keep it on this device/ }).click();

  // Keep a thought in the Stream (pulled into the strand later).
  await page.locator(".capture-input").fill(THOUGHT);
  await page.getByRole("button", { name: "Keep thought" }).click();
  await page.getByText(THOUGHT).first().waitFor();

  // Create a strand and write the first passage straight into it.
  await page.getByRole("tab", { name: "Strands" }).click();
  await page.getByPlaceholder(/Name a strand/).fill("Grandma's story");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator(".strand-compose textarea").fill(PASSAGE);
  await page.getByRole("button", { name: "Add piece" }).click();
  await page.getByText(PASSAGE).first().waitFor();

  // Start a chapter, then write a piece into that chapter.
  await page.getByRole("button", { name: "+ New chapter" }).click();
  await page.getByPlaceholder(/Chapter One/).fill(CHAPTER);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "+ Add to this chapter" }).click();
  await page.locator(".heading-add textarea").fill(IN_CHAPTER);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText(IN_CHAPTER).first().waitFor();

  // Drop a photo in as its own piece.
  await page.locator(".strand-compose input[type=file]").setInputFiles({
    name: "lamp.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.locator(".media-thumb img").first().waitFor();

  // Pull the Stream thought in.
  await page.getByRole("button", { name: "+ Pull in a thought" }).click();
  await page.locator(".strand-pick", { hasText: THOUGHT }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // Let the awaited encrypt+IndexedDB writes land before tearing the page down.
  await page.waitForTimeout(800);

  // "Close the app and come back."
  await page.goto(BASE, { waitUntil: "load" });
  await page.getByPlaceholder("Passphrase").fill(PASS);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("tab", { name: "Strands" }).click();

  const card = page.locator(".strand-card");
  await card.waitFor();
  const cardText = (await card.innerText()).replace(/\n/g, " ");
  if (!/5 pieces/.test(cardText)) fail(`strand card says "${cardText}", expected 5 pieces`);

  await card.click();
  for (const text of [PASSAGE, CHAPTER, IN_CHAPTER, THOUGHT]) {
    if ((await page.getByText(text).count()) === 0) fail(`missing after reload: "${text}"`);
  }
  await page.locator(".media-thumb img").first().waitFor({ timeout: 5000 })
    .catch(() => fail("photo missing after reload"));

  // Remove one piece from the strand and make sure the removal also survives.
  await page
    .locator(".strand-piece", { hasText: THOUGHT })
    .getByTitle("Remove from this strand")
    .click();
  await page.waitForTimeout(800);
  await page.goto(BASE, { waitUntil: "load" });
  await page.getByPlaceholder("Passphrase").fill(PASS);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("tab", { name: "Strands" }).click();
  await card.waitFor();
  const after = (await card.innerText()).replace(/\n/g, " ");
  if (!/4 pieces/.test(after)) fail(`after removal card says "${after}", expected 4 pieces`);

  // The removed piece must still exist as an ordinary thought in the Stream.
  await page.getByRole("tab", { name: "Stream" }).click();
  if ((await page.getByText(THOUGHT).count()) === 0) fail("removed piece vanished from the Stream");

  if (errors.length) fail("console errors: " + errors.join(" | "));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  stopServer();
}

if (process.exitCode) {
  console.error("SMOKE TEST FAILED");
} else {
  console.log("✓ smoke test passed — capture, strand, chapter, photo, pull-in, removal all survive reload");
}

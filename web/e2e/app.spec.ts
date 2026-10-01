import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const AI = "http://localhost:8790";
const NO_AI = "http://localhost:8791";

const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

async function captureText(page: Page, text: string) {
  await page.getByPlaceholder("…or type it here").fill(text);
  await page.getByRole("button", { name: "Save idea" }).click();
  await expect(page.getByTestId("saved-panel")).toContainText("Saved on this device");
}

async function recordVoice(page: Page, ms = 2500) {
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByText(/Recording \d:\d\d/)).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole("button", { name: "Stop and save recording", exact: true }).click();
  await expect(page.getByTestId("saved-panel")).toBeVisible();
}

test("1. text capture saves instantly, gets an AI card, and survives reopening", async ({ page }) => {
  await page.goto(AI);
  await captureText(page, "Abeg make we do song about Lagos rain, chorus: rain dey fall");
  // Fake AI makes a card with a follow-up question; leave it for later.
  await expect(page.getByText("What sparked this idea?")).toBeVisible();
  await page.getByRole("button", { name: "Leave for later" }).click();
  await expect(page.getByText("What sparked this idea?")).toBeHidden();

  await page.reload();
  await nav(page, "Library").click();
  await expect(page.getByTestId("library-list")).toContainText("Abeg make we do song");
  await page.getByTestId("library-list").getByRole("link").first().click();
  // Original words are shown separately, unchanged.
  await expect(page.getByTestId("entry").first()).toContainText("Abeg make we do song about Lagos rain, chorus: rain dey fall");
  await expect(page.getByText("AI suggestion").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Priority" }).getByRole("button", { name: "Not set" })).toHaveAttribute("aria-pressed", "true");
  // Editing the title makes it mine.
  await page.getByLabel("Title").fill("Rain song");
  await page.getByLabel("Summary").click();
  await expect(page.getByText("Yours")).toBeVisible();
});

test("2. voice capture keeps audio, transcribes it, and I can replay and add to it", async ({ page }) => {
  await page.goto(AI);
  await recordVoice(page);
  await page.getByRole("button", { name: "Open card" }).click();
  await expect(page.getByTestId("audio-player")).toBeVisible();
  const duration = await page.getByTestId("audio-player").evaluate(async (el: HTMLAudioElement) => {
    if (el.readyState < 1) await new Promise((r) => el.addEventListener("loadedmetadata", r, { once: true }));
    return el.duration;
  });
  expect(duration).toBeGreaterThan(0);
  await expect(page.getByTestId("entry").getByText("(fake transcript of")).toBeVisible();

  await page.getByLabel("New thought").fill("Second verse: owambe for the weekend");
  await page.getByRole("button", { name: "Add thought" }).click();
  await expect(page.getByTestId("entry")).toHaveCount(2);

  await nav(page, "Library").click();
  await page.getByLabel("Search").fill("owambe");
  await expect(page.getByTestId("library-list").getByRole("link")).toHaveCount(1);
});

test("3. capture works offline (app shell from service worker) and syncs later", async ({ page, context, request }) => {
  await page.goto(AI);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Save idea" })).toBeVisible();
  const text = `Offline idea ${Date.now()}`;
  await captureText(page, text);
  await expect(page.getByTestId("statusbar")).toContainText(/Offline|not reachable/);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () => JSON.stringify(await (await request.get(`${AI}/api/ideas`)).json()), { timeout: 15_000 })
    .toContain(text);
});

test("4. export and restore, including audio", async ({ page }) => {
  await page.goto(AI);
  await captureText(page, "Export me: mama put delivery");
  await page.getByRole("button", { name: "New idea" }).click();
  await recordVoice(page, 1500);
  await nav(page, "Settings").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export everything/ }).click()]);
  const zipPath = await download.path();
  expect(fs.statSync(zipPath).size).toBeGreaterThan(1000);

  // Wipe this device completely, as if it were a new phone.
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("xoba-big-idea"); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.goto(`${NO_AI}/#/settings`); // a fresh origin with an empty server too
  await expect(page.getByText(/^0 ideas/)).toBeVisible();
  await page.getByTestId("restore-input").setInputFiles(zipPath);
  await expect(page.getByTestId("restore-msg")).toContainText(/added, .* 1 recordings added|recordings added/);
  await nav(page, "Library").click();
  await expect(page.getByTestId("library-list")).toContainText("Export me: mama put delivery");
  await page.getByTestId("library-list").getByRole("link", { name: /Voice note|fake transcript/ }).first().click();
  await expect(page.getByTestId("audio-player")).toBeVisible();
});

test("5. with AI switched off, capture, browse and replay still work", async ({ page }) => {
  await page.goto(NO_AI);
  await captureText(page, "No AI today, still saving this");
  await expect(page.getByText(/tidied up by AI when it is available/)).toBeVisible();
  await page.getByRole("button", { name: "New idea" }).click();
  await recordVoice(page, 1500);
  await page.getByRole("button", { name: "Open card" }).click();
  await expect(page.getByTestId("audio-player")).toBeVisible();
  await expect(page.getByText("Waiting for transcription")).toBeVisible();
  await nav(page, "Library").click();
  await expect(page.getByTestId("library-list")).toContainText("No AI today");
  await expect(page.getByTestId("statusbar")).toContainText("AI off");
});

test("6. weekly review shows 3 ideas and every choice is a good answer", async ({ page }) => {
  await page.goto(NO_AI);
  for (const t of ["Review one", "Review two", "Review three", "Review four"]) {
    await captureText(page, t);
    await page.getByRole("button", { name: "New idea" }).click();
  }
  await nav(page, "Review").click();
  await expect(page.getByTestId("review-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Continue my current project" }).click();
  await expect(page.getByTestId("review-done")).toContainText("Good choice");
  await page.getByRole("button", { name: "Look at three more" }).click();
  await page.getByTestId("review-card").first().getByRole("button", { name: "Develop this one" }).click();
  await expect(page.getByTestId("review-done")).toContainText("Chosen");
  await nav(page, "Library").click();
  await page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Chosen" }).click();
  await expect(page.getByTestId("library-list").getByRole("link")).toHaveCount(1);
});

test("7. a recording cut off by closing the app is recovered on reopen", async ({ page }) => {
  await page.goto(NO_AI);
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.waitForTimeout(3000); // a few one-second chunks reach IndexedDB
  await page.reload(); // app closed mid-recording, nothing pressed
  await expect(page.getByText(/Recovered 1 recording/)).toBeVisible();
  await nav(page, "Library").click();
  await page.getByTestId("library-list").getByRole("link").first().click();
  await expect(page.getByTestId("audio-player")).toBeVisible();
});

test("8. words appear live while speaking and are saved with the recording", async ({ page }) => {
  // Stand-in for the phone's speech recognition: "hears" two phrases.
  await page.addInitScript(() => {
    class FakeRec {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onerror = null; onend: (() => void) | null = null;
      start() {
        const say = (t: string, isFinal: boolean, ms: number) =>
          setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: t } }] }), ms);
        say("wetin dey", false, 300);
        say("wetin dey happen for Lagos", true, 700);
      }
      stop() { setTimeout(() => this.onend?.(), 10); }
      abort() { this.stop(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRec;
  });
  await page.goto(NO_AI);
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByTestId("live-words")).toContainText("wetin dey happen for Lagos");
  await page.getByRole("button", { name: "Stop and save recording", exact: true }).click();
  await page.getByRole("button", { name: "Open card" }).click();
  await expect(page.getByTestId("entry").getByText("wetin dey happen for Lagos")).toBeVisible();
  await expect(page.getByText("Transcript, written live as you spoke.")).toBeVisible();
  await expect(page.getByTestId("audio-player")).toBeVisible();
});

test("9. sign in on two devices and see the same ideas", async ({ browser }) => {
  const LOGIN = "http://localhost:8792";
  const laptop = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
  await laptop.goto(LOGIN);
  await expect(laptop.getByRole("button", { name: "Sign in" })).toBeVisible();
  await laptop.getByLabel("Password", { exact: true }).fill("not-it");
  await laptop.getByRole("button", { name: "Sign in" }).click();
  await expect(laptop.getByRole("alert")).toContainText("isn't right");
  await laptop.getByLabel("Password", { exact: true }).fill("e2e-pass");
  await laptop.getByRole("button", { name: "Sign in" }).click();
  await expect(laptop.getByRole("button", { name: "Save idea" })).toBeVisible();
  await captureText(laptop, "Laptop idea: Yoruba film night");
  await expect(laptop.getByTestId("sync-badge")).toContainText("Synced", { timeout: 15_000 });

  // A second, separate browser = another device.
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(LOGIN);
  await phone.getByLabel("Password", { exact: true }).fill("e2e-pass");
  await phone.getByRole("button", { name: "Sign in" }).click();
  await nav(phone, "Library").click();
  await expect(phone.getByTestId("library-list")).toContainText("Laptop idea: Yoruba film night", { timeout: 15_000 });

  // Sign out on the phone from Settings.
  await nav(phone, "Settings").click();
  await expect(phone.getByTestId("signed-in")).toContainText("2 devices signed in");
  await phone.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(phone.getByRole("status").filter({ hasText: "Signed out" })).toBeVisible();
});

test("10. 'Not now' keeps the app usable on this device without signing in", async ({ page }) => {
  await page.goto("http://localhost:8792");
  await page.getByRole("button", { name: /Not now/ }).click();
  await captureText(page, "Captured before signing in");
  await expect(page.getByTestId("statusbar")).toContainText("Not signed in");
});

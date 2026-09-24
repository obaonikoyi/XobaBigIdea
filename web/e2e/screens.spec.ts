import { test } from "@playwright/test";
// Not a check: saves screenshots for eyeballing when SHOTS_DIR is set.
test.skip(!process.env.SHOTS_DIR, "screenshots only on request");
test("screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dir = process.env.SHOTS_DIR!;
  await page.goto("http://localhost:8790");
  await page.getByPlaceholder("…or type it here").fill("Song idea: chorus 'rain dey fall for Lagos, ọmọ mi no worry'");
  await page.getByRole("button", { name: "Save idea" }).click();
  await page.getByText("What sparked this idea?").waitFor();
  await page.screenshot({ path: `${dir}/1-capture.png`, fullPage: true });
  await page.getByRole("button", { name: "Open card" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/2-card.png`, fullPage: true });
  await page.goto("http://localhost:8790/#/library");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/3-library.png`, fullPage: true });
  await page.goto("http://localhost:8790/#/review");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/4-review.png`, fullPage: true });
  await page.goto("http://localhost:8790/#/settings");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/5-settings.png`, fullPage: true });
});

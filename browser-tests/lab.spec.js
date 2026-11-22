import { test, expect } from "@playwright/test";

test("keyboard controls expose the full audience and reveal changed accounts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("status").filter({ hasText: "demo-0001" }),
  ).toBeVisible();
  await page.getByLabel("目前開放比例").press("Home");
  await page.getByLabel("預計開放比例").press("End");
  await expect(page.locator("#entered")).toHaveText("1000");
  await expect(page.locator("#switched")).toHaveText("0");
  await page.getByText("查看有變動的帳號").click();
  await expect(page.locator("#changes tr")).toHaveCount(20);
  await expect(page.locator("#changes tr").first()).toContainText("demo-0001");
  await page.getByLabel("新版設定中的 A 版比例").press("Home");
  await expect(page.locator("#assignment")).toContainText("未開放 → B 版");
  await page.getByLabel("示範帳號編號", { exact: false }).fill("1001");
  await expect(page.locator("#assignment")).toHaveText(
    "請輸入 1 至 1000 的整數。",
  );
});
test("mobile layout supports rollback and member lookup", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByLabel("目前開放比例").press("End");
  await page.getByLabel("預計開放比例").press("Home");
  await expect(page.locator("#exited")).toHaveText("1000");
  await page.getByLabel("示範帳號編號", { exact: false }).fill("1000");
  await expect(page.locator("#assignment")).toContainText("demo-1000");
  await expect(page.locator("#assignment")).toContainText("退出");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

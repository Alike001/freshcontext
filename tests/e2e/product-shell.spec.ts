import { expect, test } from '@playwright/test';

test('overview enters the real setup flow without browser errors', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');

  await expect(page).toHaveTitle('FreshContext');
  await expect(
    page.getByRole('heading', { name: 'Your agent remembers. Your code moved on.' }),
  ).toBeVisible();
  await expect(page.getByText('Example data', { exact: true })).toBeVisible();
  await expect(page.getByText('HydraDB connected', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `/tmp/freshcontext-${testInfo.project.name}-overview.png`,
    fullPage: false,
  });

  await page.getByRole('link', { name: 'Open Proof Console' }).click();
  await expect(page).toHaveURL(/\/console$/u);
  await expect(
    page.getByRole('heading', { name: 'Connect a real repository first.' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Open Setup' }).click();
  await expect(page).toHaveURL(/\/setup$/u);
  await expect(
    page.getByRole('heading', { name: 'Local runtime, clearly accounted for.' }),
  ).toBeVisible();
  await expect(page.getByText('Connected and verified', { exact: true })).toBeVisible();
  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();

  const screenshotName = `/tmp/freshcontext-${testInfo.project.name}-setup.png`;
  await page.screenshot({ path: screenshotName, fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test('keyboard navigation reaches the main content and all routes', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  for (const [name, path] of [
    ['Overview', '/'],
    ['Proof Console', '/console'],
    ['Evaluation', '/evaluation'],
    ['Setup', '/setup'],
  ] as const) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : `${path}$`}`, 'u'));
  }
});

test('mobile layout does not overflow and names a failed local service', async ({ page }) => {
  await page.route('**/api/setup', (route) => route.abort('failed'));
  await page.goto('/setup');

  await expect(page.getByRole('alert')).toContainText('FreshContext service unavailable');
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(contentWidth).toBeLessThanOrEqual(viewportWidth);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
});

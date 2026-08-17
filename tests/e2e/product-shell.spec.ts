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
  await expect(page.getByText('Verified example', { exact: true })).toBeVisible();
  await expect(page.getByText('Memory claim', { exact: true })).toBeVisible();
  await expect(page.getByText('HydraDB connected', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `/tmp/freshcontext-${testInfo.project.name}-overview.png`,
    fullPage: false,
  });

  await page.getByRole('link', { name: 'View evaluation' }).click();
  await expect(page).toHaveURL(/\/evaluation$/u);
  await expect(page.getByRole('heading', { name: 'A graph should earn its place.' })).toBeVisible();
  await expect(page.getByText('Verified offline reference', { exact: true })).toBeVisible();
  const precisionRow = page.getByRole('row').filter({ hasText: 'Precision' });
  await expect(precisionRow.getByText('100.0%', { exact: true })).toBeVisible();
  await expect(precisionRow.getByText('62.5%', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A real fix from the official MCP TypeScript SDK.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /modelcontextprotocol\/typescript-sdk/u }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Same MCP recall. Safe before, withheld after.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Context returned' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent abstained' })).toBeVisible();
  await expect(page.getByText('all_matching_memory_unsafe', { exact: false })).toBeVisible();
  await expect(
    page.getByText('One expected impact remains missed beyond the V1 boundary.'),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/freshcontext-${testInfo.project.name}-evaluation.png`,
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Proof Console', exact: true }).click();
  await expect(page).toHaveURL(/\/console$/u);
  await page.getByRole('button', { name: /Checkout totals add a flat \$2 service fee/u }).click();
  await expect(page.getByRole('heading', { name: 'Why this claim was withheld' })).toBeVisible();
  await expect(page.getByText('Example data', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Ordered HydraDB evidence path')).toContainText('calculateTotal');
  await expect(page.getByLabel('Code change')).toContainText('return amount > 100 ? 4 : 1;');
  await page.screenshot({
    path: `/tmp/freshcontext-${testInfo.project.name}-console.png`,
    fullPage: true,
  });

  if (testInfo.project.name === 'desktop-chromium') {
    const reviewButton = page.getByRole('button', { name: 'Supersede claim' });
    if (await reviewButton.isVisible()) {
      await reviewButton.click();
      await expect(page.getByText('Supersession verified', { exact: true })).toBeVisible();
      await expect(page.getByText('The replacement is current.')).toBeVisible();
    }
  }

  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await expect(page).toHaveURL(/\/setup$/u);
  await expect(
    page.getByRole('heading', { name: 'Local runtime, clearly accounted for.' }),
  ).toBeVisible();
  await expect(page.getByText('Connected and verified', { exact: true })).toBeVisible();
  await expect(page.getByText('Indexed', { exact: true })).toBeVisible();
  await expect(page.getByText('Example data, processed through the real stack')).toBeVisible();

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

test('evaluation failure stays explicit and shows no benchmark numbers', async ({ page }) => {
  await page.route('**/api/evaluation/latest', (route) => route.abort('failed'));
  await page.goto('/evaluation');

  await expect(page.getByRole('alert')).toContainText('Evaluation proof unavailable');
  await expect(page.getByText('100.0%', { exact: true })).toHaveCount(0);
  await expect(page.getByText('62.5%', { exact: true })).toHaveCount(0);
});

test('Proof Console failure stays explicit and shows no cached claim', async ({ page }) => {
  await page.route('**/api/console*', (route) => route.abort('failed'));
  await page.goto('/console');

  await expect(page.getByRole('alert')).toContainText('Proof Console unavailable');
  await expect(page.getByRole('alert')).toContainText('No cached claim was shown');
  await expect(page.getByLabel('Ordered HydraDB evidence path')).toHaveCount(0);
});

test('Overview proof failure stays explicit and shows no hardcoded dossier', async ({ page }) => {
  await page.route('**/api/console*', (route) => route.abort('failed'));
  await page.goto('/');

  await expect(page.getByText('Live proof unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Memory claim', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Ordered HydraDB evidence path')).toHaveCount(0);
});

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

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

test('configured repository can be indexed from Setup with explicit progress', async ({
  page,
}, testInfo) => {
  await page.route('**/api/setup', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: setupBody('not_indexed') }),
  );
  await page.route('**/api/repositories/index', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: setupBody('indexed'),
    }),
  );

  await page.goto('/setup');
  await expect(page.getByText('Selected, waiting for an index', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const indexButton = page.getByRole('button', { name: 'Index repository', exact: true });
  await activateButton(page, indexButton, testInfo);
  await expect(page.getByText('Indexed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync committed changes' })).toBeVisible();
  await expect(page.getByText('2 files, 3 calls, 1 imports, 0 skipped')).toBeVisible();
});

test('configured repository indexing state is explicit and non-interactive', async ({ page }) => {
  await page.route('**/api/setup', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: setupBody('indexing') }),
  );

  await page.goto('/setup');

  await expect(page.getByRole('button', { name: 'Indexing repository…' })).toBeDisabled();
  await expect(page.getByText('Indexing through Git and HydraDB', { exact: true })).toBeVisible();
});

test('configured repository validation failure stays explicit and retryable', async ({
  page,
}, testInfo) => {
  let setupState: 'not_indexed' | 'invalid_repository' = 'not_indexed';
  await page.route('**/api/setup', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: setupBody(setupState),
    }),
  );
  await page.route('**/api/repositories/index', (route) => {
    setupState = 'invalid_repository';
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'unavailable',
        message: 'Repository must have a clean worktree.',
      }),
    });
  });

  await page.goto('/setup');
  await page.evaluate(() => document.fonts.ready);
  const indexButton = page.getByRole('button', { name: 'Index repository', exact: true });
  await activateButton(page, indexButton, testInfo);

  await expect(page.getByText('Repository validation failed', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Repository must have a clean worktree.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry repository index' })).toBeVisible();
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

test('Proof Console names a verified memory with no affected path', async ({ page }) => {
  const memory = {
    memoryId: 'memory-current',
    claim: 'The parser keeps the committed source order.',
    state: 'current',
    sourceCommit: 'a'.repeat(40),
    createdAt: '2026-08-17T10:00:00.000Z',
    evidence: [{ path: 'src/parser.ts', qualifiedName: 'parseSource' }],
  };
  await page.route('**/api/console*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        source: 'configured',
        repositoryId: 'configured-repository',
        repositoryLabel: 'configured-repository',
        selectedCommit: 'a'.repeat(40),
        memories: [memory],
        selected: {
          memory,
          impact: null,
          chronology: [
            {
              eventType: 'created',
              state: 'current',
              commitSha: 'a'.repeat(40),
              occurredAt: '2026-08-17T10:00:00.000Z',
            },
          ],
          replacement: null,
          original: null,
          diff: null,
        },
      }),
    }),
  );

  await page.goto('/console');

  await expect(page.getByText('No active impact proof', { exact: true })).toBeVisible();
  await expect(
    page.getByText('This memory is not currently withheld by a synchronized code change.'),
  ).toBeVisible();
  await expect(page.getByLabel('Ordered HydraDB evidence path')).toHaveCount(0);
});

test('Overview proof failure stays explicit and shows no hardcoded dossier', async ({ page }) => {
  await page.route('**/api/console*', (route) => route.abort('failed'));
  await page.goto('/');

  await expect(page.getByText('Live proof unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Memory claim', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Ordered HydraDB evidence path')).toHaveCount(0);
});

function setupBody(state: 'not_indexed' | 'indexing' | 'indexed' | 'invalid_repository'): string {
  return JSON.stringify({
    status: 'ready',
    hydra: 'connected',
    startupCommand:
      'FRESHCONTEXT_HOST_REPOSITORY_PATH=/absolute/path docker compose -f compose.yaml -f compose.repository.yaml up --wait',
    repository: {
      state,
      source: 'configured',
      id: 'configured-repository',
      path: '/workspace/repository',
      indexedCommit: state === 'indexed' ? 'a'.repeat(40) : null,
      statistics:
        state === 'indexed'
          ? {
              indexedFileCount: 2,
              callEdgeCount: 3,
              importEdgeCount: 1,
              skippedFileCount: 0,
              syntacticDiagnosticCount: 0,
            }
          : null,
      message:
        state === 'invalid_repository'
          ? 'Repository must have a clean worktree.'
          : state === 'indexing'
            ? 'FreshContext is indexing the configured repository through Git and HydraDB.'
            : state === 'indexed'
              ? 'The selected repository has a completed HydraDB index.'
              : 'The repository is selected but has no completed index.',
    },
  });
}

async function activateButton(page: Page, button: Locator, testInfo: TestInfo): Promise<void> {
  await button.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' }),
  );
  await page.evaluate(
    () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())),
  );
  if (testInfo.project.name !== 'mobile-chromium') {
    await button.click();
    return;
  }
  const box = await button.boundingBox();
  if (!box) throw new Error('Mobile action button has no rendered bounds');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env['FRESHCONTEXT_BASE_URL'] ?? 'http://127.0.0.1:3000';
const screenshotDirectory = resolve('demo/screenshots');
const videoDirectory = resolve('demo/video');
const videoTarget = resolve(videoDirectory, 'evaluation-proof.webm');

await mkdir(screenshotDirectory, { recursive: true });
await mkdir(videoDirectory, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: videoDirectory, size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
const video = page.video();

try {
  await page.goto(baseUrl);
  await page.getByText('HydraDB connected', { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(screenshotDirectory, 'overview.png'),
    fullPage: false,
  });
  await page.waitForTimeout(1_200);

  await page.getByRole('link', { name: 'View evaluation' }).click();
  await page.getByText('Verified offline reference', { exact: true }).waitFor();
  await page.getByText('100.0%', { exact: true }).first().waitFor();
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'evaluation.png'),
    fullPage: true,
  });
  await page.getByRole('heading', { name: 'Same changes, same labels' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_500);
  await page
    .getByRole('heading', { name: 'The file baseline missed this 3-hop caller.' })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_500);

  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.getByText('Connected and verified', { exact: true }).waitFor();
  await page.waitForTimeout(1_200);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'setup.png'),
    fullPage: true,
  });
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

if (!video) throw new Error('Playwright did not create a demo video');
const generatedVideo = await video.path();
await rm(videoTarget, { force: true });
await rename(generatedVideo, videoTarget);

process.stdout.write(`Demo screenshots written to ${screenshotDirectory}\n`);
process.stdout.write(`Offline evaluation video written to ${videoTarget}\n`);

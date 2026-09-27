import { expect, test } from '@playwright/test';

// 8×8 red PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64',
);

test('backup survives erase and restore', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await expect(page.getByText(/Demo data loaded/)).toBeVisible();

  // Attach a photo (a small generated PNG) to an item
  await page.goto('/#/items');
  await page.getByText('Nintendo Switch OLED — joy-con drift').click();
  await page
    .locator('input[type="file"][multiple]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('1 photo added')).toBeVisible();
  await expect(page.locator('main img')).not.toHaveCount(0);

  await page.goto('/#/settings#backup');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);

  await page.getByRole('button', { name: 'Erase all data' }).click();
  await page.getByLabel('Type "ERASE" to confirm').fill('ERASE');
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.goto('/#/items?tab=all');
  await expect(page.getByText('No items yet')).toBeVisible();

  await page.goto('/#/settings#backup');
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText(/Imported/)).toBeVisible();

  await expect(page.getByText(/1 photo\b/)).toBeVisible();
  await page.goto('/#/items?tab=all');
  await page.getByText('Nintendo Switch OLED — joy-con drift').click();
  await expect(page.locator('main img')).not.toHaveCount(0);
  await page.goto('/#/projects?tab=all');
  await expect(page.getByText('2011 BMW 320d E90 — breaking')).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';

async function finishOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('first run, demo data, items, sale and reports', async ({ page, isMobile }) => {
  await finishOnboarding(page);
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByRole('button', { name: 'Load demo data' }).click();
  await expect(page.getByText(/Demo data loaded/)).toBeVisible();

  // Items list shows demo items with generated IDs
  await page.goto('/#/items');
  await expect(page.getByText('Sony WH-1000XM4 headphones')).toHaveCount(0); // sold → Finished tab
  await expect(page.getByText('Nintendo Switch OLED — joy-con drift')).toBeVisible();
  await page.getByRole('tab', { name: /Finished/ }).click();
  await expect(page.getByText('Sony WH-1000XM4 headphones')).toBeVisible();

  // Create an item
  await page.goto('/#/items/new');
  await page.getByLabel('Name *').fill('Canon EF 50mm f/1.8 lens');
  await page.getByLabel('Purchase price (total)').fill('35');
  await page.getByLabel('List price').fill('80');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page.getByRole('heading', { name: 'Canon EF 50mm f/1.8 lens' })).toBeVisible();
  await expect(page.getByText(/^FL-\d{5}$/).first()).toBeVisible();

  // Record a sale from the Money tab
  await page.getByRole('tab', { name: 'Money' }).click();
  await page.getByRole('button', { name: 'Record sale' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sale price (goods)').fill('75');
  await dialog.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByText('Sale recorded')).toBeVisible();
  await expect(page.getByText('Sold', { exact: true }).first()).toBeVisible();

  // Projects: the demo part-out tracks break-even
  await page.goto('/#/projects');
  await page.getByText('2011 BMW 320d E90 — breaking').click();
  await expect(page.getByText('Break-even progress')).toBeVisible();

  // Reports render
  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: 'Stats & reports' })).toBeVisible();
  await expect(page.getByText('Profit & loss')).toBeVisible();

  if (isMobile) await expect(page.getByRole('navigation').getByText('More')).toBeVisible();
});

test('settings keep region and AI configuration', async ({ page }) => {
  await finishOnboarding(page);
  await page.goto('/#/settings');
  await page.getByLabel('Currency').selectOption('EUR');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  await page.getByRole('heading', { name: 'AI assistant' }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('API base URL')).toHaveValue('https://api.deepseek.com');
  await page.reload();
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
});

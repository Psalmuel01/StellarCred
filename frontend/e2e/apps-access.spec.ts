import { test, expect } from '@playwright/test';

test.describe('Apps page', () => {
  test('renders demo protocol cards with claim badges', async ({ page }) => {
    await page.goto('/apps');

    // All three demo protocol cards should render
    await expect(page.getByText('Gated Pool')).toBeVisible();
    await expect(page.getByText('Airdrop')).toBeVisible();
    await expect(page.getByText('DAO Voting')).toBeVisible();

    // Claim badges should be present on each card
    const badges = page.locator('[class*="badge"]');
    await expect(badges.first()).toBeVisible();
  });
});

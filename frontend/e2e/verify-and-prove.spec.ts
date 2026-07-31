import { test, expect } from '@playwright/test';

const FIXTURE_CREDENTIAL = {
  type: 'kyc',
  commitment: '0xabcdef1234567890',
  title: 'KYC Verified',
  claim: 'Identity verified',
  issuer: '0xIssuerAddress',
  issuerId: 'issuer-1',
  expiry: '90 days',
};

test.describe('Verify ? Prove flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock /api/issue to return a fixture credential
    await page.route('**/api/issue', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FIXTURE_CREDENTIAL),
      });
    });
  });

  test('navigates to /verify, submits form, and sees credential on /holder', async ({ page }) => {
    await page.goto('/verify');

    // Select KYC credential type
    await page.getByText('KYC').click();

    // Submit the form
    await page.getByRole('button', { name: /submit/i }).click();

    // Should redirect to /holder
    await page.waitForURL('**/holder**');

    // Credential card should be visible
    await expect(page.getByText('KYC Verified')).toBeVisible();
  });

  test('Generate proof button triggers proof flow', async ({ page }) => {
    await page.goto('/holder');

    // Mock localStorage to have a credential
    await page.evaluate((cred) => {
      const stored = [cred];
      localStorage.setItem('stellarcred_credentials', JSON.stringify(stored));
    }, FIXTURE_CREDENTIAL);

    await page.reload();

    // Click Generate proof
    await page.getByRole('button', { name: /generate proof/i }).click();

    // Assert the proof flow UI appears (spinner or step indicator)
    await expect(page.getByText(/compute witness|generating proof/i)).toBeVisible();
  });
});

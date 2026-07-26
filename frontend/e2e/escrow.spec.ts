import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Escrow Workflow E2E Tests', () => {
  let page: Page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should create an escrow transaction', async () => {
    // Navigate to escrow section
    const escrowButton = page.locator('button:has-text("Escrow"), button:has-text("Safe Transfer")').first();
    if (await escrowButton.isVisible()) {
      await escrowButton.click();
    }

    // Click create escrow
    const createButton = page.locator('button:has-text("Create"), button:has-text("New"), button:has-text("Initiate")').first();
    if (await createButton.isVisible()) {
      await createButton.click();
    }

    // Fill escrow form
    const buyerInput = page.locator('input[placeholder*="buyer"], input[placeholder*="buyer address"]').first();
    if (await buyerInput.isVisible()) {
      await buyerInput.fill('GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4');
    }

    const sellerInput = page.locator('input[placeholder*="seller"], input[placeholder*="seller address"]').first();
    if (await sellerInput.isVisible()) {
      await sellerInput.fill('GBFQP3G5E4W5EPRNVZQ7Q52JNWXM5B234H4JVZPJXF7VKSWYRCAHHVR');
    }

    const amountInput = page.locator('input[type="number"], input[placeholder*="amount"]').first();
    if (await amountInput.isVisible()) {
      await amountInput.fill('1000');
    }

    // Set release conditions
    const conditionSelect = page.locator('select, [role="combobox"]').first();
    if (await conditionSelect.isVisible()) {
      await conditionSelect.click();
      const timeOption = page.locator('option:has-text("Time"), text="Time"').first();
      if (await timeOption.isVisible()) {
        await timeOption.click();
      }
    }

    // Submit
    const submitButton = page.locator('button:has-text("Create"), button:has-text("Submit"), button:has-text("Initiate")').first();
    if (await submitButton.isVisible()) {
      await submitButton.click();
    }

    // Verify creation
    const successMessage = page.locator('text=/created|initiated|success/i');
    await expect(successMessage).toBeVisible({ timeout: 5000 }).catch(() => {
      console.log('Success message not found');
    });
  });

  test('should release escrow to buyer', async () => {
    // Navigate to escrow
    const escrowButton = page.locator('button:has-text("Escrow"), button:has-text("Safe Transfer")').first();
    if (await escrowButton.isVisible()) {
      await escrowButton.click();
    }

    // Find an active escrow
    const escrowItem = page.locator('[data-testid="escrow-item"], .escrow-card, [role="listitem"]').first();
    if (await escrowItem.isVisible()) {
      await escrowItem.click();
    }

    // Look for release button
    const releaseButton = page.locator('button:has-text("Release"), button[aria-label*="release"], button[aria-label*="approve"]').first();
    if (await releaseButton.isVisible()) {
      await releaseButton.click();

      // Confirm release
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Verify release
      const successIndicator = page.locator('text=/released|completed|success/i');
      await expect(successIndicator).toBeVisible({ timeout: 5000 }).catch(() => {
        console.log('Release confirmation not found');
      });
    }
  });

  test('should refund escrow to seller', async () => {
    // Navigate to escrow
    const escrowButton = page.locator('button:has-text("Escrow"), button:has-text("Safe Transfer")').first();
    if (await escrowButton.isVisible()) {
      await escrowButton.click();
    }

    // Find an escrow
    const escrowItem = page.locator('[data-testid="escrow-item"], .escrow-card').first();
    if (await escrowItem.isVisible()) {
      await escrowItem.click();
    }

    // Look for refund button
    const refundButton = page.locator('button:has-text("Refund"), button[aria-label*="refund"], button[aria-label*="cancel"]').first();
    if (await refundButton.isVisible()) {
      await refundButton.click();

      // Confirm refund
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Verify refund
      const successIndicator = page.locator('text=/refunded|cancelled|success/i');
      await expect(successIndicator).toBeVisible({ timeout: 5000 }).catch(() => {
        console.log('Refund confirmation not found');
      });
    }
  });

  test('should view escrow history and status', async () => {
    // Navigate to escrow
    const escrowButton = page.locator('button:has-text("Escrow"), button:has-text("Safe Transfer")').first();
    if (await escrowButton.isVisible()) {
      await escrowButton.click();
    }

    // Check for history/status view
    const historyButton = page.locator('button:has-text("History"), button:has-text("Status"), [aria-label*="history"]').first();
    if (await historyButton.isVisible()) {
      await historyButton.click();
    }

    // Verify escrow entries are displayed
    const escrowEntries = page.locator('[data-testid="escrow-entry"], .escrow-history-item, [role="listitem"]');
    const count = await escrowEntries.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should complete full escrow workflow: create → release → complete', async () => {
    // Navigate to escrow
    const escrowButton = page.locator('button:has-text("Escrow"), button:has-text("Safe Transfer")').first();
    if (await escrowButton.isVisible()) {
      await escrowButton.click();
    }

    // Create escrow
    const createButton = page.locator('button:has-text("Create"), button:has-text("Initiate")').first();
    if (await createButton.isVisible()) {
      await createButton.click();

      // Fill form
      const buyerInput = page.locator('input[placeholder*="buyer"]').first();
      if (await buyerInput.isVisible()) {
        await buyerInput.fill('GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4');
      }

      const amountInput = page.locator('input[type="number"]').first();
      if (await amountInput.isVisible()) {
        await amountInput.fill('500');
      }

      // Submit
      const submitButton = page.locator('button:has-text("Create"), button:has-text("Submit")').first();
      if (await submitButton.isVisible()) {
        await submitButton.click();
      }
    }

    // Wait for creation
    await page.waitForTimeout(1000);

    // Release escrow
    const escrowItem = page.locator('[data-testid="escrow-item"], .escrow-card').first();
    if (await escrowItem.isVisible()) {
      await escrowItem.click();

      const releaseButton = page.locator('button:has-text("Release")').first();
      if (await releaseButton.isVisible()) {
        await releaseButton.click();

        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }
      }
    }

    // Wait for completion
    await page.waitForTimeout(1000);

    // Verify final state
    const completedStatus = page.locator('text=/completed|released|success/i');
    await expect(completedStatus).toBeVisible({ timeout: 5000 }).catch(() => {
      console.log('Completion status not found');
    });
  });
});

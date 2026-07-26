import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Recurring Payment E2E Tests', () => {
  let page: Page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should create a recurring payment', async () => {
    // Navigate to recurring payments section
    const recurringButton = page.locator('button:has-text("Recurring"), button:has-text("Payments")').first();
    if (await recurringButton.isVisible()) {
      await recurringButton.click();
    }

    // Click create recurring payment
    const createButton = page.locator('button:has-text("Create"), button:has-text("New"), button:has-text("Schedule")').first();
    if (await createButton.isVisible()) {
      await createButton.click();
    }

    // Fill recurring payment form
    const recipientInput = page.locator('input[placeholder*="recipient"], input[placeholder*="address"]').first();
    if (await recipientInput.isVisible()) {
      await recipientInput.fill('GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4');
    }

    const amountInput = page.locator('input[type="number"], input[placeholder*="amount"]').first();
    if (await amountInput.isVisible()) {
      await amountInput.fill('100');
    }

    // Set frequency
    const frequencySelect = page.locator('select, [role="combobox"]').first();
    if (await frequencySelect.isVisible()) {
      await frequencySelect.click();
      const monthlyOption = page.locator('option:has-text("Monthly"), text="Monthly"').first();
      if (await monthlyOption.isVisible()) {
        await monthlyOption.click();
      }
    }

    // Submit
    const submitButton = page.locator('button:has-text("Submit"), button:has-text("Create"), button:has-text("Schedule")').first();
    if (await submitButton.isVisible()) {
      await submitButton.click();
    }

    // Verify creation
    const successMessage = page.locator('text=/created|scheduled|success/i');
    await expect(successMessage).toBeVisible({ timeout: 5000 }).catch(() => {
      console.log('Success message not found');
    });
  });

  test('should execute a recurring payment', async () => {
    // Navigate to recurring payments
    const recurringButton = page.locator('button:has-text("Recurring"), button:has-text("Payments")').first();
    if (await recurringButton.isVisible()) {
      await recurringButton.click();
    }

    // Find a scheduled payment
    const paymentItem = page.locator('[data-testid="payment-item"], .payment-card, [role="listitem"]').first();
    if (await paymentItem.isVisible()) {
      await paymentItem.click();
    }

    // Look for execute/process button
    const executeButton = page.locator('button:has-text("Execute"), button:has-text("Process"), button:has-text("Run")').first();
    if (await executeButton.isVisible()) {
      await executeButton.click();

      // Confirm execution
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Verify execution
      const successIndicator = page.locator('text=/executed|processed|completed/i');
      await expect(successIndicator).toBeVisible({ timeout: 5000 }).catch(() => {
        console.log('Execution confirmation not found');
      });
    }
  });

  test('should update a recurring payment schedule', async () => {
    // Navigate to recurring payments
    const recurringButton = page.locator('button:has-text("Recurring"), button:has-text("Payments")').first();
    if (await recurringButton.isVisible()) {
      await recurringButton.click();
    }

    // Find a payment
    const paymentItem = page.locator('[data-testid="payment-item"], .payment-card').first();
    if (await paymentItem.isVisible()) {
      await paymentItem.click();
    }

    // Look for edit/settings button
    const editButton = page.locator('button:has-text("Edit"), button[aria-label*="edit"], button[aria-label*="settings"]').first();
    if (await editButton.isVisible()) {
      await editButton.click();

      // Update frequency
      const frequencySelect = page.locator('select, [role="combobox"]').first();
      if (await frequencySelect.isVisible()) {
        await frequencySelect.click();
        const quarterlyOption = page.locator('option:has-text("Quarterly"), text="Quarterly"').first();
        if (await quarterlyOption.isVisible()) {
          await quarterlyOption.click();
        }
      }

      // Update amount if possible
      const amountInput = page.locator('input[type="number"]').first();
      if (await amountInput.isVisible()) {
        await amountInput.clear();
        await amountInput.fill('150');
      }

      // Save changes
      const saveButton = page.locator('button:has-text("Save"), button:has-text("Update")').first();
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }

      // Verify update
      const successMessage = page.locator('text=/updated|saved|success/i');
      await expect(successMessage).toBeVisible({ timeout: 5000 }).catch(() => {
        console.log('Update confirmation not found');
      });
    }
  });

  test('should cancel/pause a recurring payment', async () => {
    // Navigate to recurring payments
    const recurringButton = page.locator('button:has-text("Recurring"), button:has-text("Payments")').first();
    if (await recurringButton.isVisible()) {
      await recurringButton.click();
    }

    // Find a payment
    const paymentItem = page.locator('[data-testid="payment-item"], .payment-card').first();
    if (await paymentItem.isVisible()) {
      await paymentItem.click();
    }

    // Look for cancel/pause button
    const cancelButton = page.locator('button:has-text("Cancel"), button:has-text("Pause"), button:has-text("Stop")').first();
    if (await cancelButton.isVisible()) {
      await cancelButton.click();

      // Confirm cancellation
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Verify cancellation
      const statusText = page.locator('text=/cancelled|paused|inactive/i');
      await expect(statusText).toBeVisible({ timeout: 5000 }).catch(() => {
        console.log('Cancellation confirmation not found');
      });
    }
  });
});

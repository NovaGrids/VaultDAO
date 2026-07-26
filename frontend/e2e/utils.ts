import { Page, expect } from '@playwright/test';

export async function waitForNavigation(page: Page, timeout = 5000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    console.log('Navigation timeout, continuing...');
  }
}

export async function clickIfVisible(page: Page, selector: string, options?: any) {
  const element = page.locator(selector);
  if (await element.isVisible(options)) {
    await element.click();
    return true;
  }
  return false;
}

export async function fillIfVisible(page: Page, selector: string, value: string, options?: any) {
  const element = page.locator(selector);
  if (await element.isVisible(options)) {
    await element.fill(value);
    return true;
  }
  return false;
}

export async function selectOptionIfVisible(page: Page, selector: string, optionText: string) {
  const select = page.locator(selector);
  if (await select.isVisible()) {
    await select.selectOption({ label: optionText });
    return true;
  }
  return false;
}

export async function waitForTextVisible(page: Page, text: RegExp | string, timeout = 5000) {
  try {
    await expect(page.locator(`text=${text}`)).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

export async function getTableData(page: Page, selector: string) {
  const rows = page.locator(`${selector} tbody tr`);
  const count = await rows.count();
  const data = [];

  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    const cellCount = await cells.count();
    const rowData = [];

    for (let j = 0; j < cellCount; j++) {
      const text = await cells.nth(j).textContent();
      rowData.push(text?.trim() || '');
    }

    data.push(rowData);
  }

  return data;
}

export async function isFormValid(page: Page, formSelector: string): Promise<boolean> {
  try {
    const form = page.locator(formSelector);
    return await form.evaluate((el: HTMLFormElement) => el.checkValidity());
  } catch {
    return false;
  }
}

export async function dismissDialog(page: Page) {
  const closeButton = page.locator('[aria-label="Close"], .dialog-close, button.close').first();
  if (await closeButton.isVisible()) {
    await closeButton.click();
    return true;
  }
  return false;
}

export async function waitForElement(page: Page, selector: string, timeout = 5000) {
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

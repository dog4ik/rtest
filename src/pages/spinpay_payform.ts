import * as playwright from "playwright";
import { expect } from "playwright/test";
import { assert } from "vitest";

function formatPan(pan: string) {
  let digits = pan
    .split("")
    .filter((n) => n >= "0" && n <= "9")
    .join("");

  if (digits.length === 16) {
    let result = "";
    for (let i = 0; i < 16; i += 4) {
      result += digits.slice(i, i + 4);
      if (i < 12) result += " ";
    }
    return result;
  }

  return pan;
}

function phoneFormats(num: string) {
  return [
    // app/views/charge_pages/pay_matrix/_en.html.slim:152
    num.replace(/^(\d)(\d{3})(\d{3})(\d{2})(\d{2})$/, "+$1 $2 $3 $4 $5"),
    num,
  ];
}

export class SpinpayRequisitesPage {
  constructor(private p: playwright.Page) {}

  panAmountSpan() {
    return this.p.locator("span.js-amount").nth(0);
  }

  phoneAmountSpan() {
    return this.p.locator("span.js-amount").nth(1);
  }

  cardSpan() {
    return this.p.locator("span#card");
  }

  phoneSpan() {
    return this.p.locator("span#phone");
  }

  bankSpan() {
    return this.p.locator("span#bank");
  }

  nameSpan() {
    return this.p.locator("span#name");
  }

  async validateRequisites({
    type,
    number,
    amount,
    bank,
    name,
  }: {
    type: "sbp" | "card";
    number: string;
    amount: number;
    bank?: string;
    name?: string;
  }) {
    if (type === "sbp") {
      await expect(this.phoneSpan()).toBeVisible();
      let phone = (await this.phoneSpan().textContent()) ?? "";
      assert.include(phoneFormats(phone), number);
      await expect(this.phoneAmountSpan()).toBeVisible();
      await expect(this.phoneAmountSpan()).toHaveText(
        (amount / 100).toString(),
      );

      if (name) {
        await expect(this.nameSpan()).toBeVisible();
        await expect(this.nameSpan()).toHaveText(name);
      }
      if (bank) {
        await expect(this.bankSpan()).toBeVisible();
        await expect(this.bankSpan()).toHaveText(` / ${bank}`);
      }
    } else if (type === "card") {
      await expect(this.cardSpan()).toBeVisible();
      let panText = (await this.cardSpan().textContent()) ?? "";
      assert.strictEqual(panText, formatPan(number));
      await expect(this.panAmountSpan()).toBeVisible();
      await expect(this.panAmountSpan()).toHaveText((amount / 100).toString());
    }
  }
}

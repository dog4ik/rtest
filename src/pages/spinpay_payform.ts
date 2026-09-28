import type * as playwright from "playwright";
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

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(amount / 100)
    .replace(",", ".");
}

export class SpinpayRequisitesPage {
  constructor(private p: playwright.Page) {}

  panAmountDiv() {
    return this.p.locator("div.spf__amt-sum > span").first();
  }

  phoneAmountSpan() {
    return this.p.locator("div.spf__amt-sum > span.js-amount").first();
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

  cardNameSpan() {
    return this.p.locator("#card_name");
  }

  async validateLanguage(lang: "ru" | "en") {
    let content = await this.p.content();
    assert.include(
      content,
      `const locale = "${lang}"`,
      `Expected page locale "${lang}"`,
    );
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
      await expect(this.phoneAmountSpan()).toHaveText(formatAmount(amount));

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
      await expect(this.panAmountDiv()).toBeVisible();
      await expect(this.panAmountDiv()).toContainText(
        (amount / 100).toString(),
      );
    }
  }
}

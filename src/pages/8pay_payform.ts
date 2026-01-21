import * as playwright from "playwright";
import { expect } from "playwright/test";

function formatAmount(value: number) {
  return (
    new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(value / 100)
      .replace(",", ".") + " Р"
  );
}

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

// app/views/charge_pages/pay_matrix/_en.html.slim:152
function formatPhone(num: string) {
  return num.replace(/^(\d)(\d{3})(\d{3})(\d{2})(\d{2})$/, "+$1 $2 $3 $4 $5");
}

export class EightpayRequisitesPage {
  constructor(private p: playwright.Page) {}

  amountSpan() {
    return this.p.locator("span.js-order-amount");
  }

  fioDiv() {
    return this.p.locator("div.payment-info__value").nth(1);
  }

  pageTitle() {
    return this.p.locator("h1.js-result-title");
  }

  paymentPhone() {
    return this.p.locator("div.payment-info__value.js-format-phone");
  }

  paymentPan() {
    return this.p.locator("div.payment-info__value").nth(1);
  }

  qrPayLink() {
    return this.p.locator("#qr_pay_button");
  }

  paidButton() {
    return this.p.locator("button.btn_submit");
  }

  cancelButton() {
    return this.p.locator("button.btn_cancel_pay");
  }

  async validateRequisites({
    type,
    number,
    amount,
    name,
  }: {
    type: "sbp" | "card";
    number: string;
    amount: number;
    name: string | undefined;
    bank: string | undefined;
  }) {
    if (type === "sbp") {
      await expect(this.pageTitle()).toBeVisible();
      await expect(this.pageTitle()).toHaveText("Оплата по СБП");
      await expect(this.paymentPhone()).toBeVisible();
      await expect(this.paymentPhone()).toHaveText(formatPhone(number));
    } else if (type === "card") {
      await expect(this.pageTitle()).toBeVisible();
      await expect(this.pageTitle()).toHaveText("Оплата по номеру карты");
      await expect(this.p.getByText(formatPan(number))).toBeVisible();
    }
    await Promise.all([
      expect(this.fioDiv()).toBeVisible(),
      expect(this.fioDiv()).toHaveText(name ?? ""),
      expect(this.amountSpan()).toBeVisible(),
      expect(this.amountSpan()).toHaveText(formatAmount(amount)),
    ]);
  }
}

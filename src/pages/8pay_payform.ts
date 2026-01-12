import * as playwright from "playwright";

export class EightpayRequisitesPage {
  constructor(private p: playwright.Page) {}

  amountSpan() {
    return this.p.locator("span.js-order-amount");
  }

  fioDiv() {
    return this.p.locator("div.payment-info__value");
  }

  pageTitle() {
    return this.p.locator("h1.js-result-title");
  }

  paymentPhone() {
    return this.p.locator("div.payment-info__value.js-format-phone");
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
}

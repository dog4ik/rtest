import * as playwright from "playwright";
import { expect } from "playwright/test";

export type Platform = "ios" | "android";

const DEEPLINK_SCHEME: Record<Platform, string> = {
  ios: "bank100000000004",
  android: "tinkoffbank",
};

export class EightpayTpayQrForm {
  private deeplink_scheme: string;
  constructor(
    private p: playwright.Page,
    platform: Platform,
  ) {
    this.deeplink_scheme = DEEPLINK_SCHEME[platform];
  }

  pageTitle() {
    return this.p.locator("h1.js-result-title");
  }

  qrPayButton() {
    return this.p.locator(".payment-block__info>a.mobile-only");
  }

  paymentInfoLocator(n: number) {
    return this.p.locator("div.payment-info__value").nth(n);
  }

  bankLocator() {
    return this.paymentInfoLocator(0);
  }

  phoneLocator() {
    return this.paymentInfoLocator(1);
  }

  fioLocator() {
    return this.paymentInfoLocator(2);
  }

  amountLocator() {
    return this.paymentInfoLocator(3);
  }

  deeplikUrl(amount: number, phone: string) {
    return `${this.deeplink_scheme}://Main/PayByMobileNumber?amount=${amount / 100}&numberPhone=%2B${phone}&workflowType=RTLNTransfer`;
  }

  async validateRequisites({
    number,
    amount,
    name,
  }: {
    number: string;
    amount: number;
    name: string | undefined;
    bank: string | undefined;
  }) {
    await expect(this.pageTitle()).toBeVisible();
    await expect(this.pageTitle()).toHaveText("Оплата по T-Pay");
    await expect(this.fioLocator()).toHaveText(name ?? "");
    await expect(this.qrPayButton()).toHaveAttribute(
      "href",
      this.deeplikUrl(amount, number),
    );
  }
}

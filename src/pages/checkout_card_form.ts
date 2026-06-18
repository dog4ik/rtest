import type { CardObject } from "@/common";
import * as playwright from "playwright";
import { expect } from "playwright/test";

export class CheckoutCardForm {
  constructor(private p: playwright.Page) {}

  panInput() {
    return this.p.locator("#form_bank_pan");
  }

  holderInput() {
    return this.p.locator("#form_bank_holder");
  }

  expiresInput() {
    return this.p.locator("#form_bank_expires");
  }

  cvvInput() {
    return this.p.locator("#form_bank_cvv");
  }

  payButton() {
    return this.p.locator("#pay_btn");
  }

  // CardObject stores `expires` as "mm/yyyy" (e.g. "02/2077"); the form's
  // date input expects "mmyy" (e.g. "0277").
  private formatExpires(expires: string) {
    let [month, year] = expires.split("/");
    return `${month}${year.slice(-2)}`;
  }

  async fill_in_card_object(card_object: CardObject) {
    await this.panInput().fill(card_object.pan);
    await this.holderInput().fill(card_object.holder);
    await this.expiresInput().fill(this.formatExpires(card_object.expires));
    await this.cvvInput().fill(card_object.cvv);
  }

  async submit_form() {
    await expect(this.payButton()).toBeEnabled();
    await this.payButton().click();
  }

  async submit_card_object(card_object: CardObject) {
    await this.fill_in_card_object(card_object);
    await this.submit_form();
  }
}

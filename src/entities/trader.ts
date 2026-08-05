import { assert } from "vitest";
import * as common from "@/common";
import type { Trader } from "@/db/core";
import type { TraderMethodToggle } from "@/driver/core";
import { type Bank, TraderDriver } from "@/driver/trader";
import type { Context } from "@/test_context/context";
import { type ExtendedRequisite, extendedRequisite } from "./requisite";

export type ExtendedTrader = ReturnType<typeof extendTrader>;

export function extendTrader(ctx: Context, trader: Trader) {
  let driver = new TraderDriver(ctx);
  return {
    ctx,
    setup,
    bank_accounts,
    cashin,
    cashout,
    wallets,
    driver,
    finalizeTransaction,
    finalize_dispute,
    enable_trader_method,
    ...trader,
  };
}

type TraderSetupOptions = {
  card: boolean;
  sbp: boolean;
  link: boolean;
  account: boolean;
  bank: Bank | {};
};

type BooleanRequisiteKeys = "card" | "sbp" | "link" | "account";

type TraderRequisiteResult<T extends Partial<TraderSetupOptions>> = {
  [K in BooleanRequisiteKeys as T[K] extends true
    ? K
    : never]: ExtendedRequisite;
} & { device_id: string };

const DEFAULT_SETUP: TraderSetupOptions = {
  card: false,
  sbp: false,
  link: false,
  account: false,
  bank: "tbank",
};

async function finalizeTransaction(
  this: ExtendedTrader,
  token: string,
  status: "approved" | "declined",
) {
  let feed = await this.ctx.get_feed(token);
  if (feed.type === "PayinRequest") {
    if (status === "approved") {
      await this.driver.approve_transaction(feed.id);
    } else {
      await this.driver.decline_transaction(feed.id);
    }
  }

  if (feed.type === "PayoutRequest") {
    if (status === "approved") {
      await this.driver.upload_receipt(feed.id);
    } else {
      await this.driver.decline_transaction(feed.id);
    }
  }
  return feed;
}

async function finalize_dispute(
  this: ExtendedTrader,
  dispute_id: number,
  status: "approved" | "declined",
) {
  this.ctx.story.add_chapter(
    "Finalizing trader dispute",
    `${dispute_id} to ${status}`,
  );
  return this.driver.update_dispute(dispute_id, status);
}

async function setup<const T extends Partial<TraderSetupOptions>>(
  this: ExtendedTrader,
  params: T,
): Promise<TraderRequisiteResult<T>> {
  let setup = { ...DEFAULT_SETUP, ...params };
  console.log("trader setup:", setup);
  let device_id = await this.driver.create_device("Test device");

  await this.driver.activate_device(device_id);

  let profile_id: undefined | number;
  let result = {} as Record<string, ExtendedRequisite>;
  let get_profile_id = async () => {
    if (profile_id) {
      return profile_id;
    }
    let profile = await this.driver.create_profile({
      bank: setup.bank,
      device_id,
    });
    assert(profile.id);
    profile_id = profile.id;
    return profile.id;
  };

  if (setup.card) {
    let requisite = await this.driver.add_requisite({
      profile_id: await get_profile_id(),
      requisite_type: "card",
      requisite_value: common.visaCard,
      card_holder: common.fullName,
      title: "Test card",
    });
    assert(requisite.id, "card requisite id");
    await this.driver.activate_requisite(requisite.id);
    result.card = extendedRequisite(
      this.driver,
      requisite.id,
      await get_profile_id(),
    );
    await this.enable_trader_method("card_enabled");
  }

  if (setup.sbp) {
    let requisite = await this.driver.add_requisite({
      profile_id: await get_profile_id(),
      requisite_type: "sbp",
      requisite_value: common.phoneNumber,
      title: common.fullName,
    });
    assert(requisite.id, "sbp requisite id");
    await this.driver.activate_requisite(requisite.id);
    result.sbp = extendedRequisite(
      this.driver,
      requisite.id,
      await get_profile_id(),
    );
    await this.enable_trader_method("sbp_enabled");
  }

  if (setup.account) {
    let requisite = await this.driver.add_requisite({
      profile_id: await get_profile_id(),
      requisite_type: "account",
      requisite_value: common.accountNumber,
      title: common.fullName,
    });
    assert(requisite.id, "account requisite id");
    await this.driver.activate_requisite(requisite.id);
    result.account = extendedRequisite(
      this.driver,
      requisite.id,
      await get_profile_id(),
    );
    await this.enable_trader_method("account_enabled");
  }

  if (setup.link) {
    let requisite = await this.driver.add_requisite({
      profile_id: await get_profile_id(),
      requisite_type: "link",
      requisite_value: common.redirectPayUrl,
      title: "Test link",
    });
    assert(requisite.id, "link requisite id");
    await this.driver.activate_requisite(requisite.id);
    result.link = extendedRequisite(
      this.driver,
      requisite.id,
      await get_profile_id(),
    );
    await this.enable_trader_method("link_enabled");
  }

  return { device_id, ...result } as TraderRequisiteResult<T>;
}

async function bank_accounts(this: ExtendedTrader) {
  return await this.ctx.shared_state().core_db.bank_accounts(this.id);
}

async function wallets(this: ExtendedTrader) {
  let core_db = this.ctx.shared_state().core_db;
  let wallets = await core_db.profileWallets(this.id);
  wallets.sort((a, b) => a.id - b.id);
  let [main, deposit, income] = wallets;
  return {
    main,
    income,
    deposit,
    assertEmpty() {
      let assertWallet = (type: BankAccountWalletType) => {
        assert.strictEqual(
          this[type].available,
          0,
          `${type} available should be empty`,
        );
        assert.strictEqual(this[type].held, 0, `${type} held should be empty`);
      };
      assertWallet("main");
      assertWallet("deposit");
      assertWallet("income");
    },
  };
}

type BankAccountWalletType = "deposit" | "main" | "income";

async function cashin(
  this: ExtendedTrader,
  wallet_type: BankAccountWalletType,
  currency: string,
  amount: number,
) {
  let accounts = await this.bank_accounts();
  this.ctx.story.add_chapter(
    `Trader ${this.id} cashin`,
    `${amount} ${currency} (${wallet_type})`,
  );
  let account = accounts.find((a) => a.kind === wallet_type);
  assert(account, `${wallet_type} bank account`);
  await this.ctx
    .shared_state()
    .core_harness.cashin(this.id, currency, amount, account.id);
}

async function cashout(
  this: ExtendedTrader,
  wallet_type: "main" | "income" | "deposit",
  currency: string,
  amount: number,
) {
  let accounts = await this.bank_accounts();
  this.ctx.story.add_chapter(
    `Trader ${this.id} cashout`,
    `${amount} ${currency} (${wallet_type})`,
  );
  let account = accounts.find((a) => a.kind === wallet_type);
  assert(account, `${wallet_type} bank account`);
  await this.ctx
    .shared_state()
    .core_harness.cashout(this.id, currency, amount, account.id);
}

async function enable_trader_method(
  this: ExtendedTrader,
  method: keyof TraderMethodToggle,
) {
  await this.ctx
    .shared_state()
    .core_harness.enable_trader_method(this.id, method, true);
}

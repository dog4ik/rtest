import * as common from "@/common";
import type { Trader } from "@/db/core";
import type { TraderMethodToggle } from "@/driver/core";
import { TraderDriver, type Bank } from "@/driver/trader";
import type { Context } from "@/test_context/context";
import { assert } from "vitest";

export type ExtendedTrader = ReturnType<typeof extendTrader>;

export function extendTrader(ctx: Context, trader: Trader) {
  let driver = new TraderDriver(ctx);
  return {
    ctx,
    setup,
    bank_accounts,
    cashin,
    wallets,
    driver,
    finalizeTransaction,
    finalize_dispute,
    enable_trader_method,
    ...trader,
  };
}

type SetupParams = {
  card: boolean;
  sbp: boolean;
  link: boolean;
  account: boolean;
  bank: Bank;
};

const DEFAULT_SETUP: SetupParams = {
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
  if (status === "approved") {
    await this.driver.approve_transaction(feed.id);
  } else {
    await this.driver.decline_transaction(feed.id);
  }
  return feed;
}

async function finalize_dispute(
  this: ExtendedTrader,
  dispute_id: number,
  status: "approved" | "declined",
) {
  return this.driver.update_dispute(dispute_id, status);
}

async function setup(this: ExtendedTrader, params: Partial<SetupParams>) {
  let setup = { ...DEFAULT_SETUP, ...params };
  console.log("trader setup:", setup);
  let device_id = await this.driver.create_device("Test device");

  await this.driver.activate_device(device_id);

  let profile_id: undefined | number = undefined;
  let get_profile_id = async () => {
    if (profile_id) {
      return profile_id;
    }
    let profile = await this.driver.create_profile({
      bank: setup.bank,
      device_id,
    });
    assert(profile.id);
    return profile.id;
  };

  if (setup.card) {
    await this.driver
      .add_requisite({
        profile_id: await get_profile_id(),
        requisite_type: "card",
        requisite_value: common.visaCard,
        card_holder: common.fullName,
        title: "Test card",
      })
      .then((r) => this.driver.activate_requisite(r.id!));
    await this.enable_trader_method("card_enabled");
  }

  if (setup.sbp) {
    await this.driver
      .add_requisite({
        profile_id: await get_profile_id(),
        requisite_type: "sbp",
        requisite_value: common.phoneNumber,
        title: "Test phone",
      })
      .then((r) => this.driver.activate_requisite(r.id!));
    await this.enable_trader_method("sbp_enabled");
  }

  if (setup.account) {
    await this.driver
      .add_requisite({
        profile_id: await get_profile_id(),
        requisite_type: "account",
        requisite_value: common.accountNumber,
        title: "Test account",
      })
      .then((r) => this.driver.activate_requisite(r.id!));
    await this.enable_trader_method("account_enabled");
  }

  if (setup.link) {
    await this.driver
      .add_requisite({
        profile_id: await get_profile_id(),
        requisite_type: "link",
        requisite_value: common.redirectPayUrl,
        title: "Test link",
      })
      .then((r) => this.driver.activate_requisite(r.id!));
    await this.enable_trader_method("link_enabled");
  }

  return { device_id };
}

async function bank_accounts(this: ExtendedTrader) {
  return await this.ctx.shared_state().core_db.bank_accounts(this.id);
}

async function wallets(this: ExtendedTrader) {
  let core_db = this.ctx.shared_state().core_db;
  let wallets = await core_db.profileWallets(this.id);
  wallets.sort((a, b) => a.id - b.id);
  let [main, profit, deposit] = wallets;
  return {
    main,
    profit,
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
      assertWallet("profit");
    },
  };
}

type BankAccountWalletType = "deposit" | "main" | "profit";

async function cashin(
  this: ExtendedTrader,
  wallet_type: BankAccountWalletType,
  currency: string,
  amount: number,
) {
  let accounts = await this.bank_accounts();
  await this.ctx
    .shared_state()
    .core_harness.cashin(
      this.id,
      currency,
      amount,
      accounts.find((a) => a.kind == wallet_type)!.id!,
    );
}

async function enable_trader_method(
  this: ExtendedTrader,
  method: keyof TraderMethodToggle,
) {
  await this.ctx
    .shared_state()
    .core_harness.enable_trader_method(this.id, method, true);
}

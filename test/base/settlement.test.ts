import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { CoreOfficeDriver } from "@/driver/core/office";
import { test } from "@/test_context";

const SETTLEMENT_DELAY = 1_000;

describe.concurrent("settlement basics", () => {
  test.concurrent("settlement approved", async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    await merchant.cashin("RUB", 100);
    let office = new CoreOfficeDriver(CONFIG.urls().core);
    await office.login({
      login: `${merchant.company_name}@mail.com`,
      password: common.password,
    });
    await delay(SETTLEMENT_DELAY);
    await office.create_settlment("RUB", 100);
    await delay(SETTLEMENT_DELAY);
    let wallets = await merchant.wallets();
    let settlements = await merchant.settlements();
    let wallet = wallets[0];
    assert.strictEqual(wallet.available, 0, "settlement should hold the funds");
    assert.strictEqual(
      wallet.held,
      100,
      "hold should have the settelment amount",
    );
    assert(wallets.length === 1, "only one wallet must be created");
    let core = ctx.shared_state().core_harness;
    await core.confirm_settlement(settlements[0].id, "approved");
    await delay(1_000);
    wallets = await merchant.wallets();
    wallet = wallets[0];
    assert.strictEqual(wallet.available, 0, "available should be gone");
    assert.strictEqual(wallet.held, 0, "hold should be gone after approved");
  });

  test.concurrent("settlement declined", async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    await merchant.cashin("RUB", 100);
    let office = new CoreOfficeDriver(CONFIG.urls().core);
    await office.login({
      login: `${merchant.company_name}@mail.com`,
      password: common.password,
    });
    await delay(SETTLEMENT_DELAY);
    await office.create_settlment("RUB", 100);
    await delay(SETTLEMENT_DELAY);
    let wallets = await merchant.wallets();
    let settlements = await merchant.settlements();
    let wallet = wallets[0];
    assert.strictEqual(wallet.available, 0, "settlement should hold the funds");
    assert.strictEqual(
      wallet.held,
      100,
      "hold should have the settelment amount",
    );
    assert(wallets.length === 1, "only one wallet must be created");
    let core = ctx.shared_state().core_harness;
    await core.confirm_settlement(settlements[0].id, "declined");
    await delay(1_000);
    wallets = await merchant.wallets();
    wallet = wallets[0];
    assert.strictEqual(wallet.available, 100, "available should returned");
    assert.strictEqual(wallet.held, 0, "hold should be gone");
  });

  test.skip("settlement not enough money", async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    let office = new CoreOfficeDriver(CONFIG.urls().core);
    await office.login({
      login: `${merchant.company_name}@mail.com`,
      password: common.password,
    });
    await delay(SETTLEMENT_DELAY);
    await office.create_settlment("RUB", 100);
    await delay(SETTLEMENT_DELAY);
    let settlements = await merchant.settlements();
    assert.isEmpty(settlements, "settlements should net be created");
  });
});

describe.concurrent("commission healthcheck settlements", () => {
  const AMOUNT = 100_000; // 1000 RUB in cents
  const AMOUNT_RUB = AMOUNT / 100; // 1000 RUB
  const SELF_RATE = 0.1; // 10%
  const COMMISSION_RUB = AMOUNT_RUB * SELF_RATE; // 100 RUB

  async function rubWallet(merchant: {
    wallets(
      c: string,
    ): Promise<
      Array<{ available: number; held: number; currency: string | null }>
    >;
  }) {
    let ws = await merchant.wallets("RUB");
    let w = ws.find((w) => w.currency === "RUB");
    return { available: w?.available ?? 0, held: w?.held ?? 0 };
  }

  async function loginOffice(merchant: { company_name: string }) {
    let office = new CoreOfficeDriver(CONFIG.urls().core);
    await office.login({
      login: `${merchant.company_name}@mail.com`,
      password: common.password,
    });
    return office;
  }

  test.concurrent("settlement approved with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "CashoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 1100, held: 0 },
        "after cashin",
      );
      let office = await loginOffice(merchant);
      await delay(SETTLEMENT_DELAY);
      await office.create_settlment("RUB", AMOUNT_RUB);
      await delay(SETTLEMENT_DELAY);

      let settlements = await merchant.settlements("RUB");
      assert.strictEqual(settlements.length, 1, "settlement should be created");

      if (CONFIG.in_project("spinpay")) {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: COMMISSION_RUB, held: AMOUNT_RUB },
          "pending: settlement amount held, commission stays in available",
        );
      } else {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: AMOUNT_RUB + COMMISSION_RUB },
          "pending: settlement amount and commission held",
        );
      }

      let core = ctx.shared_state().core_harness;
      await core.confirm_settlement(settlements[0].id, "approved");
      await delay(SETTLEMENT_DELAY);

      assert.deepEqual(
        await rubWallet(merchant),
        { available: 0, held: 0 },
        "approved: settlement sent, commission charged",
      );
    }));

  test.concurrent("settlement declined with commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "CashoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB + COMMISSION_RUB);
      assert.deepEqual(
        await rubWallet(merchant),
        { available: 1100, held: 0 },
        "after cashin",
      );
      let office = await loginOffice(merchant);
      await delay(SETTLEMENT_DELAY);
      await office.create_settlment("RUB", AMOUNT_RUB);
      await delay(SETTLEMENT_DELAY);

      let settlements = await merchant.settlements("RUB");
      assert.strictEqual(settlements.length, 1, "settlement should be created");

      if (CONFIG.in_project("spinpay")) {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: COMMISSION_RUB, held: AMOUNT_RUB },
          "pending: settlement amount held, commission stays in available",
        );
      } else {
        assert.deepEqual(
          await rubWallet(merchant),
          { available: 0, held: AMOUNT_RUB + COMMISSION_RUB },
          "pending: settlement amount and commission held",
        );
      }

      let core = ctx.shared_state().core_harness;
      await core.confirm_settlement(settlements[0].id, "declined");
      await delay(SETTLEMENT_DELAY);

      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB + COMMISSION_RUB, held: 0 },
        "declined: full amount returned",
      );
    }));

  test.concurrent("settlement not created when no balance for commission", ({
    ctx,
  }) =>
    ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({ operation: "CashoutRequest" });
      await merchant.cashin("RUB", AMOUNT_RUB); // only base amount, no commission
      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB, held: 0 },
        "after cashin",
      );
      let office = await loginOffice(merchant);
      await delay(SETTLEMENT_DELAY);
      await office.create_settlment("RUB", AMOUNT_RUB);
      await delay(SETTLEMENT_DELAY);

      let settlements = await merchant.settlements("RUB");
      assert.isEmpty(
        settlements,
        "settlement should not be created without commission balance",
      );
      assert.deepEqual(
        await rubWallet(merchant),
        { available: AMOUNT_RUB, held: 0 },
        "funds unchanged when settlement not created",
      );
    }));
});

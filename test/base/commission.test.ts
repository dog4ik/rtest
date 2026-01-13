import * as default_provider from "@/provider_mocks/default";
import { assert, describe } from "vitest";
import { test } from "@/test_context";

const CURRENCY = "RUB";
let AMOUNT = 100 * 1000;

describe.concurrent("basic commission", () => {
  test.concurrent("successful payment with commission", async ({ ctx }) => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(default_provider.fullSettings(CURRENCY));
    await merchant.set_commission({
      operation: "PayinRequest",
      currency: CURRENCY,
      status: "1",
    });
    await merchant.create_payment(
      default_provider.request(CURRENCY, AMOUNT, "pay", true),
    );
    let wallet = (await merchant.wallets())[0];
    assert(wallet.currency == CURRENCY, "created wallet should be in RUB");
    assert(wallet.available == (AMOUNT * 0.9) / 100, "merhant wallet amount");
  });
});

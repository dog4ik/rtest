import { assert } from "vitest";
import { test } from "@/test_context";

test.concurrent("merchant balance increases", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  await merchant.cashin("RUB", 100);
  let wallets = await merchant.wallets();
  console.log(wallets);
  let wallet = wallets[0];
  assert(wallet.available == 100, "cashin amount is now available");
  assert(wallet.held == 0, "held must be empty");
  assert(wallets.length == 1, "only one wallet must be created");
});

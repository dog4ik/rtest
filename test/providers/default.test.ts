import * as default_provider from "@/provider_mocks/default";
import { test } from "@/test_context";
import { assert } from "vitest";

test.concurrent("approved", async ({ ctx }) => {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(default_provider.fullSettings("RUB"));
  let response = await merchant.create_payment(
    default_provider.request("RUB", 12345, "pay", true),
  );
  assert(response.payment.status == "approved");
});

import { assert, describe } from "vitest";
import * as common from "@/common";
import * as default_provider from "@/provider_mocks/default";
import { test } from "@/test_context";

const CARDS = {
  Visa: "4111111111111111",
  MasterCard: "5555555555554444",
  "American Express": "378282246310005",
  Maestro: "6759649826438453",
  Rupay: "6071234567890123",
  Elo: "4011781234567890",
  Mir: "2200222018999288",
  Discover: "6011111111111117",
  "China UnionPay": "6250947000000014",
  JCB: "3566111111111113",
  Dankort: "5019717012345671",
  Hipercard: "6062821234567890120",
  // NOTE: fails validation
  // "Diners Club": "30475498826872",
  // These are not being detected yet they existing in upstream library rp relies on
  // https://github.com/scarfacedeb/credit_card_detector/blob/master/lib/data/brands.yaml
  // These 2 are legacy brands
  // Solo: "6334123456789016",
  // Switch: "6331101234567890",
} as const;

describe.concurrent("card brand names", () => {
  for (let [expected_name, expected_value] of Object.entries(CARDS)) {
    test.concurrent(`${expected_name} card brand`, ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        await merchant.set_settings(default_provider.fullSettings("RUB"));
        let res = await merchant.create_payment({
          ...default_provider.request("RUB", common.amount, "pay", true),
          card: { ...common.cardObject(), pan: expected_value },
        });

        let payment = await ctx.get_payment(res.token);

        let annotation = `${expected_value} should resolve to ${expected_name}`;
        await ctx.annotate(annotation);
        assert.strictEqual(payment.card_brand_name, expected_name, annotation);
      }));
  }
});

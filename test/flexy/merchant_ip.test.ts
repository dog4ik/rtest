import { assert, describe } from "vitest";
import * as common from "@/common";
import * as default_provider from "@/provider_mocks/default";
import { test } from "@/test_context";

const CURRENCY = "RUB";

// IP of the test runner found in business.
const MERCHANT_IP = "172.19.0.1";
const OTHER_IP = "10.20.30.40";

function whitelistRule(mid: number, ips: string[]) {
  return {
    header: { mid },
    body: {
      merchant_ip: {
        in: ips,
      },
    },
  };
}

function blacklistRule(mid: number, ips: string[]) {
  return {
    header: { mid },
    body: {
      merchant_ip: {
        not_in: ips,
      },
    },
  };
}

describe.concurrent("merchant ip whitelist", () => {
  test.concurrent("whitelisted merchant ip is allowed", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.set_settings(default_provider.fullSettings(CURRENCY));
      await ctx.add_flexy_guard_rule(
        whitelistRule(merchant.id, [OTHER_IP, MERCHANT_IP]),
        "merchant ip whitelist",
      );

      let res = await merchant.create_payment(
        default_provider.request(CURRENCY, common.amount, "pay", true),
      );
      assert.strictEqual(res.payment.status, "approved");
    }));

  test.concurrent("not whitelisted merchant ip is declined", ({
    ctx,
    merchant,
  }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.set_settings(default_provider.fullSettings(CURRENCY));
      await ctx.add_flexy_guard_rule(
        whitelistRule(merchant.id, [OTHER_IP]),
        "merchant ip whitelist",
      );

      let err = await merchant.create_payment_err(
        default_provider.request(CURRENCY, common.amount, "pay", true),
      );
      assert.include(err.errors as string, MERCHANT_IP);
    }));
});

describe.concurrent("merchant ip blacklist", () => {
  test.concurrent("not blacklisted merchant ip is allowed", ({
    ctx,
    merchant,
  }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.set_settings(default_provider.fullSettings(CURRENCY));
      await ctx.add_flexy_guard_rule(
        blacklistRule(merchant.id, [OTHER_IP]),
        "merchant ip blacklist",
      );

      let res = await merchant.create_payment(
        default_provider.request(CURRENCY, common.amount, "pay", true),
      );
      assert.strictEqual(res.payment.status, "approved");
    }));

  test.concurrent("blacklisted merchant ip is declined", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      await merchant.set_settings(default_provider.fullSettings(CURRENCY));
      await ctx.add_flexy_guard_rule(
        blacklistRule(merchant.id, [OTHER_IP, MERCHANT_IP]),
        "merchant ip blacklist",
      );

      let err = await merchant.create_payment_err(
        default_provider.request(CURRENCY, common.amount, "pay", true),
      );
      assert.include(err.errors as string, MERCHANT_IP);
    }));
});

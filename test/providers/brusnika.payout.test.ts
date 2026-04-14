import * as common from "@/common";
import { BrusnikaPayout } from "@/provider_mocks/brusnika";
import { payoutSuite } from "@/provider_mocks/brusnika";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  providersSuite,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import { delay } from "@std/async";
import { CONFIG } from "@/config";

const CURRENCY = "UZS";

let brusnikaSuite = () => {
  let suite = providersSuite(CURRENCY, payoutSuite());
  let settings = (secret: string) => {
    let settings = suite.settings(secret);
    settings["payout_providers_card"] = true;
    return settings;
  };
  return { ...suite, settings };
};

describe
  .runIf(CONFIG.in_project("8pay"))
  .concurrent("brusnika 8pay payout", () => {
    callbackFinalizationSuite(brusnikaSuite);
    statusFinalizationSuite(brusnikaSuite);

    test.concurrent("brusnika no balance decline", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.cashin("UZS", common.amount / 100);
        let settings = providers("UZS", {
          ...BrusnikaPayout.settings(ctx.uuid),
          wrapped_to_json_response: true,
        });
        settings["payout_providers_card"] = true;
        await merchant.set_settings(settings);
        let brusnika = ctx.mock_server(
          BrusnikaPayout.mock_params_uzs(ctx.uuid),
        );
        brusnika.queue(BrusnikaPayout.no_balance_handler());
        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(
            callback.status,
            "declined",
            "declined notification",
          );
        });
        let response = await merchant
          .create_payout({
            ...common.payoutRequest("UZS"),
            extra_return_param: "card",
            card: { pan: common.visaCard },
            bank_account: {
              bank_name: "sberbank",
              requisite_type: "card",
            },
          })
          .then((p) => p.followFirstProcessingUrl());
        let err = await response.as_error();
        err.assert_message(
          "gateway response error: Not enough money on balance",
        );
        await notification;
      });
    });

    test.concurrent("brusnika payout skip_processing_url", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.cashin("UZS", common.amount / 100);
        let settings = providers("UZS", {
          ...BrusnikaPayout.settings(ctx.uuid),
          wrapped_to_json_response: true,
        });
        settings["payout_providers_card"] = true;
        settings["gateways"]["skip_processing_url"] = true;
        await merchant.set_settings(settings);
        let brusnika = ctx.mock_server(
          BrusnikaPayout.mock_params_uzs(ctx.uuid),
        );
        let payout = new BrusnikaPayout();
        brusnika.queue(payout.create_handler("in_progress"));
        // For unknown "reasons" we don't in p2p payout responses we get data in payment field.
        let response = await merchant.create_payout_raw({
          product: "Tests PayOut",
          amount: common.amount,
          currency: "UZS",
          card: {
            pan: common.visaCard,
          },
          bank_account: {
            bank_name: "sberbank",
            requisite_type: "card",
          },
          order_number: "123456789",
          customer: {
            email: common.email,
            ip: common.ip,
            first_name: common.firstName,
            last_name: common.lastName,
            phone: "+" + common.phoneNumber,
          },
        });
        let raw_response = response.as_p2p_ok();
        assert(raw_response.payment);
        assert.strictEqual(raw_response.payment["amount"], common.amount);
        assert.strictEqual(raw_response.payment["currency"], "UZS");
        assert.strictEqual(
          raw_response.payment["gateway_amount"],
          common.amount,
        );
        assert.strictEqual(raw_response.payment["gateway_currency"], "UZS");
        assert.strictEqual(raw_response.payment["status"], "pending");
      });
    });

    test.concurrent("brusnika pending if 500", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.cashin("UZS", common.amount / 100);
        let settings = providers("UZS", {
          ...BrusnikaPayout.settings(ctx.uuid),
          wrapped_to_json_response: true,
        });
        settings["payout_providers_card"] = true;
        await merchant.set_settings(settings);
        let brusnika = ctx.mock_server(
          BrusnikaPayout.mock_params_uzs(ctx.uuid),
        );
        brusnika.queue(common.nginx500);
        merchant.queue_notification(() => {
          assert.fail("merchant should not get any notifications");
        });
        let response = await merchant.create_payout({
          ...common.payoutRequest("UZS"),
          extra_return_param: "card",
          card: { pan: common.visaCard },
          bank_account: {
            bank_name: "sberbank",
            requisite_type: "card",
          },
        });
        await response.followFirstProcessingUrl();
        let feed = await ctx.get_feed(response.token);
        assert.strictEqual(feed.status, 0, "feed should be pending");
        await ctx.healthcheck(response.token);
      });
    });

    test.concurrent("brusnika pending if timeout", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.cashin("UZS", common.amount / 100);
        let settings = providers("UZS", {
          ...BrusnikaPayout.settings(ctx.uuid),
          wrapped_to_json_response: true,
        });
        settings["payout_providers_card"] = true;
        await merchant.set_settings(settings);
        let brusnika = ctx.mock_server(
          BrusnikaPayout.mock_params_uzs(ctx.uuid),
        );
        brusnika.queue(async (c) => {
          await delay(950_000);
          c.status(500);
          return c.json({});
        });
        merchant.queue_notification(() => {
          assert.fail("merchant should not get any notifications");
        });
        let response = await merchant.create_payout({
          ...common.payoutRequest("UZS"),
          extra_return_param: "card",
          card: { pan: common.visaCard },
          bank_account: {
            bank_name: "sberbank",
            requisite_type: "card",
          },
        });
        await response.followFirstProcessingUrl();
        let feed = await ctx.get_feed(response.token);
        assert.strictEqual(feed.status, 0, "feed should be pending");
        await ctx.healthcheck(response.token);
      });
    });
  });

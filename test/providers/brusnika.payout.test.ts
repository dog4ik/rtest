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
          .create_payment(common.paymentRequest("UZS"))
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
        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(
            callback.status,
            "declined",
            "declined notification",
          );
        });
        let response = await merchant.create_payout({
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
        assert.strictEqual(response?.payout?.status, "pending");
        await notification;
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
          "gateway response error: Not found available payment details",
        );
        await notification;
      });
    });
  });

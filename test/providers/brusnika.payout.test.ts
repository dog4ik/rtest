import * as common from "@/common";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { payoutSuite } from "@/provider_mocks/brusnika";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  providersSuite,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { test } from "@/test_context";
import { assert } from "vitest";
import { delay } from "@std/async";

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

callbackFinalizationSuite(brusnikaSuite);
statusFinalizationSuite(brusnikaSuite);

test.concurrent("brusnika no balance decline", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    await merchant.cashin("UZS", common.amount / 100);
    let settings = providers("UZS", {
      ...BrusnikaPayment.settings(ctx.uuid),
      wrapped_to_json_response: true,
    });
    settings["payout_providers_card"] = true;
    await merchant.set_settings(settings);
    let brusnika = ctx.mock_server(BrusnikaPayment.mock_params_uzs(ctx.uuid));
    brusnika.queue(BrusnikaPayment.no_requisites_handler());
    let notification = merchant.queue_notification((callback) => {
      assert.strictEqual(callback.status, "declined", "declined notification");
    });
    let response = await merchant
      .create_payment(common.paymentRequest("UZS"))
      .then((p) => p.followFirstProcessingUrl());
    let err = await response.as_error();
    err.assert_message(
      "gateway response error: Not found available payment details",
    );
    await notification;
  });
});

test.concurrent("brusnika pending if 500", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    await merchant.cashin("UZS", common.amount / 100);
    let settings = providers("UZS", {
      ...BrusnikaPayment.settings(ctx.uuid),
      wrapped_to_json_response: true,
    });
    settings["payout_providers_card"] = true;
    await merchant.set_settings(settings);
    let brusnika = ctx.mock_server(BrusnikaPayment.mock_params_uzs(ctx.uuid));
    brusnika.queue(common.nginx500);
    let notification = merchant.queue_notification((callback) => {
      assert.strictEqual(callback.status, "declined", "declined notification");
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

test.concurrent("brusnika pending if timeout", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    await merchant.cashin("UZS", common.amount / 100);
    let settings = providers("UZS", {
      ...BrusnikaPayment.settings(ctx.uuid),
      wrapped_to_json_response: true,
    });
    settings["payout_providers_card"] = true;
    await merchant.set_settings(settings);
    let brusnika = ctx.mock_server(BrusnikaPayment.mock_params_uzs(ctx.uuid));
    brusnika.queue(async (c) => {
      await delay(950_000);
      c.status(500);
      return c.json({});
    });
    let notification = merchant.queue_notification((callback) => {
      assert.strictEqual(callback.status, "declined", "declined notification");
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

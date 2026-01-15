import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  IronpayMethodMap,
  IronpayPayment,
  type IronpayStatus,
} from "@/provider_mocks/ironpay";
import {
  callbackFinalizationSuite,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG, test } from "@/test_context";
import { assert, describe } from "vitest";

const CURRENCY = "RUB";

function ironpaySuite(): Callback & Status {
  let gw = new IronpayPayment();
  let statusMap: Record<PrimeBusinessStatus, IronpayStatus> = {
    approved: "Approved",
    declined: "Canceled",
    pending: "Pending",
  };
  return {
    suite_send_callback: async function (status, secret) {
      await gw.send_callback(statusMap[status], secret);
    },
    suite_create_handler: () => gw.create_handler(),
    mock_options: IronpayPayment.mock_params,
    suite_merchant_request: function () {
      return { ...common.paymentRequest(CURRENCY), extra_return_param: "card" };
    },
    suite_merchant_settings: (secret) =>
      providers(CURRENCY, {
        ...IronpayPayment.settings(secret),
        wrapped_to_json_response: true,
      }),
    suite_status_handler: (s) => gw.status_handler(statusMap[s]),
  };
}

callbackFinalizationSuite(ironpaySuite);
statusFinalizationSuite(ironpaySuite);

test.concurrent("ironpay no requisities decline", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(
      providers("RUB", {
        ...IronpayPayment.settings(ctx.uuid),
        wrapped_to_json_response: true,
      }),
    );
    let ironpay = ctx.mock_server(IronpayPayment.mock_params(ctx.uuid));
    ironpay.queue(IronpayPayment.no_requisites_handler());
    let notification = merchant.notification_handler((callback) => {
      assert.strictEqual(callback.status, "declined", "declined notification");
    });
    let response = await merchant
      .create_payment(common.paymentRequest("RUB"))
      .then((p) => p.followFirstProcessingUrl());
    let err = await response.as_error();
    err.assert_message(
      "gateway response error: There are currently no payment details available. Your request has been rejected, please try again later.",
    );
    await notification;
  });
});

describe
  .skipIf(CONFIG.project !== "8pay")
  .concurrent("ironpay 8pay requisite", () => {
    test.concurrent("ironpay requisite card", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...IronpayPayment.settings(ctx.uuid),
            wrapped_to_json_response: true,
          }),
        );
        let payment = new IronpayPayment();
        let ironpay = ctx.mock_server(IronpayPayment.mock_params(ctx.uuid));
        let create = ironpay.queue(payment.create_handler());
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            extra_return_param: "Cards",
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
        await create;
        assert.strictEqual(
          payment.request_data?.payment_type_id,
          IronpayMethodMap.CARD,
        );
        assert.strictEqual(requisites.pan, common.visaCard);
        assert.strictEqual(requisites.name_seller, common.fullName);
      });
    });

    test.concurrent("ironpay requisite sbp", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...IronpayPayment.settings(ctx.uuid),
            wrapped_to_json_response: true,
          }),
        );
        let payment = new IronpayPayment();
        let ironpay = ctx.mock_server(IronpayPayment.mock_params(ctx.uuid));
        let create = ironpay.queue(payment.create_handler());
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            extra_return_param: "SBP",
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
        await create;
        assert.strictEqual(
          payment.request_data?.payment_type_id,
          IronpayMethodMap.SBP,
        );
        assert.strictEqual(requisites.pan, `+${common.phoneNumber}`);
        assert.strictEqual(requisites.name_seller, common.fullName);
      });
    });
  });

describe
  .skipIf(CONFIG.project === "8pay")
  .concurrent("ironpay pcidss requisite", () => {
    test.concurrent("ironpay requisite card", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        let settings = providers("RUB", {
          ...IronpayPayment.settings(ctx.uuid),
        });
        await merchant.set_settings(settings);
        let payment = new IronpayPayment();
        let ironpay = ctx.mock_server(IronpayPayment.mock_params(ctx.uuid));
        let create = ironpay.queue(payment.create_handler());
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            bank_account: {
              requisite_type: "card",
            },
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await create;
        assert.strictEqual(
          payment.request_data?.payment_type_id,
          IronpayMethodMap.CARD,
        );
        assert.strictEqual(requisites.card?.pan, common.visaCard);
        assert.strictEqual(requisites.card?.name, common.fullName);
      });
    });

    test.concurrent("ironpay requisite sbp", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...IronpayPayment.settings(ctx.uuid),
          }),
        );
        let payment = new IronpayPayment();
        let ironpay = ctx.mock_server(IronpayPayment.mock_params(ctx.uuid));
        let create = ironpay.queue(payment.create_handler());
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            bank_account: {
              requisite_type: "sbp",
            },
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await create;
        assert.strictEqual(
          payment.request_data?.payment_type_id,
          IronpayMethodMap.SBP,
        );
        assert.strictEqual(requisites.sbp?.phone, `+${common.phoneNumber}`);
        assert.strictEqual(requisites.sbp?.name, common.fullName);
      });
    });
  });

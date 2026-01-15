import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  BrusnikaPayment,
  type BrusnikaPaymentStatus,
} from "@/provider_mocks/brusnika";
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

function brusnikaSuite(): Callback & Status {
  let gw = new BrusnikaPayment();
  let statusMap: Record<PrimeBusinessStatus, BrusnikaPaymentStatus> = {
    approved: "success",
    declined: "failed",
    pending: "in_progress",
  };
  return {
    suite_send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    suite_create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: BrusnikaPayment.mock_params,
    suite_merchant_request: function () {
      return common.paymentRequest(CURRENCY);
    },
    suite_merchant_settings: (secret) =>
      providers(CURRENCY, {
        ...BrusnikaPayment.settings(secret),
        wrapped_to_json_response: true,
      }),
    suite_status_handler: (s) => gw.status_handler(statusMap[s]),
  };
}

callbackFinalizationSuite(brusnikaSuite);
statusFinalizationSuite(brusnikaSuite);

test.concurrent("brusnika no requisities decline", async ({ ctx }) => {
  await ctx.track_bg_rejections(async () => {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(
      providers("RUB", {
        ...BrusnikaPayment.settings(ctx.uuid),
        wrapped_to_json_response: true,
      }),
    );
    let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
    brusnika.queue(BrusnikaPayment.no_requisites_handler());
    let notification = merchant.notification_handler((callback) => {
      assert.strictEqual(callback.status, "declined", "declined notification");
    });
    let response = await merchant
      .create_payment(common.paymentRequest("RUB"))
      .then((p) => p.followFirstProcessingUrl());
    let err = await response.as_error();
    err.assert_message(
      "gateway response error: Not found available payment details",
    );
    await notification;
  });
});

describe
  // .skipIf(CONFIG.project !== "8pay")
  .concurrent("brusnika 8pay requisite", () => {
    test.concurrent("brusnika requisite card", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...BrusnikaPayment.settings(ctx.uuid),
            wrapped_to_json_response: true,
          }),
        );
        let payment = new BrusnikaPayment();
        let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
        let create = brusnika.queue(payment.create_handler("in_progress"));
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            extra_return_param: "Cards",
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
        await create;
        assert.strictEqual(payment.request_data?.paymentMethod, "toCard");
        assert.strictEqual(requisites.pan, common.visaCard);
        assert.strictEqual(requisites.name_seller, common.fullName);
      });
    });

    test.concurrent("brusnika requisite sbp", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...BrusnikaPayment.settings(ctx.uuid),
            wrapped_to_json_response: true,
          }),
        );
        let payment = new BrusnikaPayment();
        let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
        let create = brusnika.queue(payment.create_handler("in_progress"));
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            extra_return_param: "SBP",
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
        await create;
        assert.strictEqual(payment.request_data?.paymentMethod, "sbp");
        assert.strictEqual(requisites.pan, `+${common.phoneNumber}`);
        assert.strictEqual(requisites.name_seller, common.fullName);
      });
    });
  });

describe
  .skipIf(CONFIG.project === "8pay")
  .concurrent("brusnika pcidss requisite", () => {
    test.concurrent("brusnika requisite card", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...BrusnikaPayment.settings(ctx.uuid),
          }),
        );
        let payment = new BrusnikaPayment();
        let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
        let create = brusnika.queue(payment.create_handler("in_progress"));
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            bank_account: {
              requisite_type: "card",
            },
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
        await create;
        assert.strictEqual(payment.request_data?.paymentMethod, "toCard");
        assert.strictEqual(requisites.pan, common.visaCard);
        assert.strictEqual(requisites.name_seller, common.fullName);
      });
    });

    test.concurrent("brusnika requisite sbp", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", {
            ...BrusnikaPayment.settings(ctx.uuid),
          }),
        );
        let payment = new BrusnikaPayment();
        let brusnika = ctx.mock_server(BrusnikaPayment.mock_params(ctx.uuid));
        let create = brusnika.queue(payment.create_handler("in_progress"));
        let requisites = await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            bank_account: {
              requisite_type: "phone",
            },
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
        await create;
        assert.strictEqual(payment.request_data?.paymentMethod, "sbp");
        assert.strictEqual(requisites.pan, `+${common.phoneNumber}`);
        assert.strictEqual(requisites.name_seller, common.fullName);
      });
    });
  });

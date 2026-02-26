import { assert } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { defaultSettings } from "@/settings_builder";
import {
  DalapayTransaction,
  OperationStatusMap,
  payinSuite,
} from "@/provider_mocks/dalapay";
import type { Context } from "@/test_context/context";
import {
  CALLBACK_DELAY,
  callbackFinalizationSuite,
  dataFlowTest,
  statusFinalizationSuite,
  type P2PSuite,
} from "@/suite_interfaces";
import { delay } from "@std/async";

const CURRENCY = "CDF";

async function setupMerchant(ctx: Context) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  let settings = defaultSettings(CURRENCY, DalapayTransaction.settings(uuid));
  settings.gateways["allow_h2h_payin_without_card"] = true;
  await merchant.set_settings(settings);
  let dalapay = ctx.mock_server(DalapayTransaction.mock_params(uuid));
  let payment = new DalapayTransaction();
  return { merchant, dalapay, payment, uuid };
}

let dalapaySuite = () => {
  let suite = payinSuite();
  return {
    ...suite,
    settings: (secret) => {
      let settings = defaultSettings(
        suite.request().currency,
        suite.settings(secret),
      );
      settings.gateways["allow_h2h_payin_without_card"] = true;
      return settings;
    },
  } as P2PSuite<DalapayTransaction>;
};

callbackFinalizationSuite(dalapaySuite);
statusFinalizationSuite(dalapaySuite);

dataFlowTest("orange otp code", {
  ...dalapaySuite(),
  request: () => {
    let request = dalapaySuite().request();
    let customer = request.customer as Record<string, any>;
    request.extra_return_param = "Orange Money";
    customer["otp"] = "1111";
    return request;
  },
  after_create_check() {
    console.log({ req: this.gw.request_data });
    assert.strictEqual(
      this.gw.request_data?.extra.otp,
      "1111",
      "otp code should be qual to request.customer.opt",
    );
  },
});

const CASES = [
  [OperationStatusMap.SUCCESS, "approved"],
  [OperationStatusMap.FAILED, "declined"],
] as const;

for (let [dalapay_status, rp_status] of CASES) {
  test
    .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
    .concurrent(
      `callback finalization to ${rp_status} old test`,
      { timeout: 30_000 },
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { merchant, dalapay, payment } = await setupMerchant(ctx);
          dalapay
            .queue(payment.create_handler(OperationStatusMap.IN_PROGRESS))
            .then(async () => {
              await delay(CALLBACK_DELAY);
              await payment.send_callback(dalapay_status);
            });
          dalapay.queue(payment.status_handler(OperationStatusMap.IN_PROGRESS));
          let result = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            customer: {
              email: "test@email.com",
              country: "EU",
              first_name: "test",
              last_name: "testov",
              phone: common.phoneNumber,
            },
          });
          assert.strictEqual(
            result.payment.status,
            "pending",
            "merchant response payment status",
          );
          await merchant.queue_notification(async (notification) => {
            assert.strictEqual(
              notification.status,
              rp_status,
              "merchant notification status",
            );
          });
        });
      },
    );

  test
    .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
    .concurrent(
      `status finalization to ${rp_status} old test`,
      async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { merchant, dalapay, payment } = await setupMerchant(ctx);
          dalapay.queue(payment.create_handler(OperationStatusMap.IN_PROGRESS));

          dalapay.queue(payment.status_handler(dalapay_status));

          let result = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            customer: {
              email: "test@email.com",
              country: "EU",
              first_name: "test",
              last_name: "testov",
              phone: common.phoneNumber,
            },
          });
          assert.strictEqual(
            result.payment.status,
            "pending",
            "merchant response payment status",
          );
          await merchant.queue_notification(async (notification) => {
            assert.strictEqual(
              notification.status,
              rp_status,
              "merchant notification status",
            );
          });
        });
      },
    );
}

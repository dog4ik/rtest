import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  MadsolutionPayment,
  type MadsolutionStatus,
} from "@/provider_mocks/madsolution";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert } from "vitest";

const CURRENCY = "RUB";

function madsolutionSuite(): Callback & Status {
  let gw = new MadsolutionPayment();
  let statusMap: Record<PrimeBusinessStatus, MadsolutionStatus> = {
    approved: "CONFIRMED",
    declined: "CANCELED",
    pending: "PENDING",
  };
  return {
    type: "payin",
    send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: MadsolutionPayment.mock_params,
    request: function () {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "card",
      };
    },
    settings: (secret) =>
      providers(CURRENCY, MadsolutionPayment.settings(secret)),
    status_handler: (s) => gw.status_handler(statusMap[s]),
  };
}

callbackFinalizationSuite(madsolutionSuite);
statusFinalizationSuite(madsolutionSuite);

test.concurrent(
  "madsolution changed amount",
  ({ ctx, merchant, madsolution }) =>
    ctx.track_bg_rejections(async () => {
      let payment = new MadsolutionPayment();
      await merchant.set_settings(
        providers(CURRENCY, {
          ...MadsolutionPayment.settings(ctx.uuid),
          enable_update_amount: true,
          enable_change_final_status: true,
        }),
      );
      let finalization = madsolution
        .queue(payment.create_handler("PENDING"))
        .then(async () => {
          await delay(5_000);
          payment.send_callback("CANCELED");
          await merchant.queue_notification((n) => {
            assert.strictEqual(n.status, "declined");
          });
        });
      await merchant
        .create_payment({
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "card",
        })
        .then((r) => r.followFirstProcessingUrl())
        .then((p) => p.as_8pay_requisite());

      await finalization;
      let updated_notification = merchant.queue_notification((n) => {
        assert.strictEqual(n.status, "approved");
      });
      let new_amount = 6543.21;
      await payment.send_callback("CONFIRMED", new_amount);
      await updated_notification;
      let wallet = (await merchant.wallets()).find(
        (v) => v.currency === CURRENCY,
      );
      assert.strictEqual(wallet?.available, new_amount);
    }),
);

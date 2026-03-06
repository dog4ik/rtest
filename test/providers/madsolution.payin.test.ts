import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  MadsolutionPayment,
  payinSuite,
  type MadsolutionStatus,
} from "@/provider_mocks/madsolution";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  providersSuite,
  statusFinalizationSuite,
  type P2PSuite,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { PROJECT } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import { EightpayRequesiteSchema } from "@/entities/payment/processing_url_response";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

const CURRENCY = "RUB";

let madsolutionWrappedSuite = (wrapped_to_json_response: boolean) => {
  let suite = payinSuite(CURRENCY);
  return {
    ...suite,
    settings: (s) => ({ ...suite.settings(s), wrapped_to_json_response }),
  } as P2PSuite<MadsolutionPayment>;
};

// Madsolution is 8pay only integration.
// It should work on pcidss and 8pay using wrapped_to_json_response and extra_return_param;
let madsolutionJsonSuite = () =>
  providersSuite(CURRENCY, madsolutionWrappedSuite(true));
let madsolutionPfSuite = () =>
  providersSuite(CURRENCY, madsolutionWrappedSuite(false));

describe
  .runIf(PROJECT == "8pay" || PROJECT == "reactivepay")
  .concurrent("madsolution", () => {
    callbackFinalizationSuite(madsolutionJsonSuite);
    statusFinalizationSuite(madsolutionJsonSuite);

    dataFlowTest("card", {
      ...madsolutionJsonSuite(),
      async check_merchant_response({ processing_response, create_response }) {
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.pan, common.visaCard);
        assert.strictEqual(res?.name_seller, common.fullName);
        assert.strictEqual(res?.id, create_response.token);
        assert.deepEqual(res?.support_banks, ["OZON Bank"]);
      },
      request: function () {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "card",
        };
      },
    });

    dataFlowTest("sbp", {
      ...madsolutionJsonSuite(),
      async check_merchant_response({ processing_response, create_response }) {
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.pan, common.phoneNumber);
        assert.strictEqual(res?.name_seller, common.fullName);
        assert.strictEqual(res?.id, create_response.token);
        assert.deepEqual(res?.support_banks, ["OZON Bank"]);
      },
      request: function () {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "sbp",
        };
      },
    });

    describe.runIf(PROJECT === "8pay").concurrent("8pay payform", () => {
      payformDataFlowTest("sbp", {
        ...madsolutionPfSuite(),
        check_pf_page: async (page) => {
          let form = new EightpayRequisitesPage(page);
          await form.validateRequisites({
            amount: common.amount,
            bank: "OZON Bank",
            name: common.fullName,
            number: common.phoneNumber,
            type: "sbp",
          });
        },
        request: function () {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "sbp",
          };
        },
      });

      payformDataFlowTest("card", {
        ...madsolutionPfSuite(),
        check_pf_page: async (page) => {
          let form = new EightpayRequisitesPage(page);
          await form.validateRequisites({
            amount: common.amount,
            bank: "OZON Bank",
            name: common.fullName,
            number: common.visaCard,
            type: "card",
          });
        },
        request: function () {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          };
        },
      });
    });

    test.concurrent(
      "madsolution skip_processing_url",
      ({ ctx, merchant, madsolution }) =>
        ctx.track_bg_rejections(async () => {
          let payment = new MadsolutionPayment();
          let settings = providers(CURRENCY, {
            ...MadsolutionPayment.settings(ctx.uuid),
            enable_update_amount: true,
            enable_change_final_status: true,
            wrapped_to_json_response: true,
          });
          settings.gateways["skip_processing_url"] = true;
          await merchant.set_settings(settings);
          madsolution.queue(payment.create_handler("PENDING"));
          let res = await merchant.create_payment_raw({
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "card",
          });
          let requisites = EightpayRequesiteSchema.parse(res.json);
          assert.strictEqual(requisites.pan, common.visaCard);
          assert.strictEqual(requisites.name_seller, common.fullName);
        }),
    );

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
              wrapped_to_json_response: true,
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
  });

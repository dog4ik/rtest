import * as common from "@/common";
import { IronpayMethodMap, IronpayPayment } from "@/provider_mocks/ironpay";
import { payinSuite } from "@/provider_mocks/ironpay";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  statusFinalizationSuite,
  type P2PSuite,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

const CURRENCY = "RUB";

function ironpaySuite(): P2PSuite<IronpayPayment> {
  let suite = payinSuite(CURRENCY);
  return {
    ...suite,
    settings: (secret) => providers(CURRENCY, suite.settings(secret)),
    request(): common.PaymentRequest {
      if (PROJECT === "8pay") {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "Cards",
        };
      } else {
        return {
          ...common.paymentRequest(CURRENCY),
          bank_account: {
            requisite_type: "card",
          },
        };
      }
    },
  };
}

describe
  .runIf(CONFIG.in_project(["8pay", "spinpay", "reactivepay"]))
  .concurrent("ironpay gateway", () => {
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
        if (PROJECT == "spinpay") {
          ironpay.queue(IronpayPayment.login_handler(ctx.uuid));
        }
        ironpay.queue(IronpayPayment.no_requisites_handler());
        let notification = merchant.queue_notification((callback) => {
          assert.strictEqual(
            callback.status,
            "declined",
            "declined notification",
          );
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
      .skipIf(CONFIG.project === "8pay")
      .concurrent("ironpay pcidss", () => {
        dataFlowTest("sbp bank_account", {
          ...ironpaySuite(),
          request() {
            return {
              ...common.paymentRequest(CURRENCY),
              bank_account: {
                requisite_type: "sbp",
              },
            };
          },
          after_create_check() {
            let req = this.gw.request_data;
            assert.strictEqual(req?.payment_type_id, IronpayMethodMap.SBP);
            assert.strictEqual(req?.curr, CURRENCY);
            assert.strictEqual(req?.local_amount, common.amount / 100);
          },
          async check_merchant_response({ processing_response }) {
            await processing_response?.validateRequisites({
              name: common.fullName,
              number: `+${common.phoneNumber}`,
              type: "sbp",
              bank: ["Rosselkhozbank", "Россельхозбанк"],
            });
          },
        });

        dataFlowTest("card bank_account", {
          ...ironpaySuite(),
          request() {
            return {
              ...common.paymentRequest(CURRENCY),
              bank_account: {
                requisite_type: "card",
              },
            };
          },
          after_create_check() {
            let req = this.gw.request_data;
            assert.strictEqual(req?.payment_type_id, IronpayMethodMap.CARD);
            assert.strictEqual(req?.curr, CURRENCY);
            assert.strictEqual(req?.local_amount, common.amount / 100);
          },
          async check_merchant_response({ processing_response }) {
            await processing_response?.validateRequisites({
              name: common.fullName,
              number: common.visaCard,
              type: "card",
              bank: ["Rosselkhozbank", "Россельхозбанк"],
            });
          },
        });
      });

    describe.runIf(PROJECT == "8pay").concurrent("ironpay 8pay", () => {
      dataFlowTest("sbp extra_return_param", {
        ...ironpaySuite(),
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "sbp",
          };
        },
        after_create_check() {
          let req = this.gw.request_data;
          assert.strictEqual(req?.payment_type_id, IronpayMethodMap.SBP);
          assert.strictEqual(req?.curr, CURRENCY);
          assert.strictEqual(req?.local_amount, common.amount / 100);
        },
        async check_merchant_response({ processing_response }) {
          let requisites = await processing_response?.as_8pay_requisite();
          assert.strictEqual(requisites?.pan, `+${common.phoneNumber}`);
          assert.strictEqual(requisites?.name_seller, common.fullName);
          assert.strictEqual(requisites?.id, this.gw.gateway_id.toString());
        },
      });

      dataFlowTest("payment_method", {
        ...ironpaySuite(),
        settings(secret) {
          return providers(CURRENCY, {
            ...IronpayPayment.settings(secret),
            payment_method: "sbp",
          });
        },
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
          };
        },
        after_create_check() {
          let req = this.gw.request_data;
          assert.strictEqual(req?.payment_type_id, IronpayMethodMap.SBP);
        },
        async check_merchant_response({ processing_response }) {
          await processing_response?.as_8pay_requisite();
        },
      });

      dataFlowTest("use_settings_method_priority", {
        ...ironpaySuite(),
        settings(secret) {
          return providers(CURRENCY, {
            ...IronpayPayment.settings(secret),
            payment_method: "sbp",
            use_setting_method_priority: true,
          });
        },
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          };
        },
        after_create_check() {
          let req = this.gw.request_data;
          assert.strictEqual(req?.payment_type_id, IronpayMethodMap.SBP);
        },
        async check_merchant_response({ processing_response }) {
          await processing_response?.as_8pay_requisite();
        },
      });

      dataFlowTest("card extra_return_param", {
        ...ironpaySuite(),
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          };
        },
        after_create_check() {
          let req = this.gw.request_data;
          assert.strictEqual(req?.payment_type_id, IronpayMethodMap.CARD);
          assert.strictEqual(req?.curr, CURRENCY);
          assert.strictEqual(req?.local_amount, common.amount / 100);
        },
        async check_merchant_response({ processing_response }) {
          let requisites = await processing_response?.as_8pay_requisite();
          assert.strictEqual(requisites?.pan, common.visaCard);
          assert.strictEqual(requisites?.name_seller, common.fullName);
          assert.strictEqual(requisites?.id, this.gw.gateway_id.toString());
        },
      });

      payformDataFlowTest("card", {
        ...ironpaySuite(),
        settings(secret) {
          return providers(CURRENCY, {
            ...IronpayPayment.settings(secret),
            wrapped_to_json_response: false,
          });
        },
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          };
        },
        async check_pf_page(page) {
          let form = new EightpayRequisitesPage(page);
          await form?.validateRequisites({
            name: common.fullName,
            amount: common.amount,
            number: common.visaCard,
            type: "card",
            bank: "Россельхозбанк",
          });
        },
      });

      payformDataFlowTest("sbp", {
        ...ironpaySuite(),
        settings(secret) {
          return providers(CURRENCY, {
            ...IronpayPayment.settings(secret),
            wrapped_to_json_response: false,
          });
        },
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "sbp",
          };
        },
        async check_pf_page(page) {
          let form = new EightpayRequisitesPage(page);
          await form?.validateRequisites({
            name: common.fullName,
            amount: common.amount,
            number: `+${common.phoneNumber}`,
            type: "sbp",
            bank: "Россельхозбанк",
          });
        },
      });
    });
  });

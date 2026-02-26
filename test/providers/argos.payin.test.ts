import * as common from "@/common";
import { ArgosPayment } from "@/provider_mocks/argos";
import { payinSuite } from "@/provider_mocks/argos";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  statusFinalizationSuite,
  providersSuite,
  maskedSuite,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

const CURRENCY = "RUB";

describe
  .runIf(CONFIG.in_project(["reactivepay", "8pay"]))
  .concurrent("argos pay gateway", () => {
    let argosSuite = () => providersSuite(CURRENCY, payinSuite());
    let maskedArgosSuite = () =>
      providersSuite(CURRENCY, maskedSuite(payinSuite()));

    callbackFinalizationSuite(argosSuite);
    statusFinalizationSuite(argosSuite);

    test.concurrent("argos no requisities decline", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        let merchant = await ctx.create_random_merchant();
        let payment = new ArgosPayment();
        await merchant.set_settings(
          providers("RUB", {
            ...ArgosPayment.settings(ctx.uuid),
            wrapped_to_json_response: true,
          }),
        );
        let argos = ctx.mock_server(ArgosPayment.mock_params(ctx.uuid));
        argos.queue(payment.no_requisites_handler());
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
          "gateway response error: ACQUIRER_ERROR: Transaction has been denied by acquirer.Please contact gateway customer service.",
        );
        await notification;
      });
    });

    describe.runIf(PROJECT === "8pay").concurrent("argos 8pay", () => {
      callbackFinalizationSuite(maskedArgosSuite, {
        tag: "masked_provider",
      });

      statusFinalizationSuite(maskedArgosSuite, {
        tag: "masked_provider",
      });

      dataFlowTest("extra_return_param cards", {
        ...argosSuite(),
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          };
        },
        async check_merchant_response({
          processing_response,
          create_response,
        }) {
          assert.strictEqual(this.gw.request_data?.paymentMode, "V2C");
          assert.strictEqual(
            this.gw.request_data?.txDetails.orderData.amount,
            common.amount / 100,
          );
          assert.strictEqual(
            this.gw.request_data?.txDetails.orderData.orderId,
            create_response.token,
          );
          let res = await processing_response?.as_8pay_requisite();
          assert.strictEqual(res?.name_seller, common.fullName);
          assert.strictEqual(res?.pan, common.visaCard);
        },
      });

      payformDataFlowTest("card", {
        ...argosSuite(),
        settings: (secret) =>
          providers(CURRENCY, {
            ...ArgosPayment.settings(secret),
            wrapped_to_json_response: false,
          }),
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          };
        },
        async check_pf_page(page) {
          let form = new EightpayRequisitesPage(page);
          await form.validateRequisites({
            type: "card",
            amount: common.amount,
            number: common.visaCard,
            name: common.fullName,
            bank: common.bankName,
          });
        },
      });

      payformDataFlowTest("sbp", {
        ...argosSuite(),
        settings: (secret) =>
          providers(CURRENCY, {
            ...ArgosPayment.settings(secret),
            wrapped_to_json_response: false,
          }),
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "SBP",
          };
        },
        // FIX: phone requisite is not formatted properly on the payform
        async check_pf_page(page) {
          let form = new EightpayRequisitesPage(page);
          await form.validateRequisites({
            type: "sbp",
            amount: common.amount,
            number: `+${common.phoneNumber}`,
            name: common.fullName,
            bank: common.bankName,
          });
        },
      });

      dataFlowTest("payment_method", {
        ...argosSuite(),
        settings(secret) {
          return providers(CURRENCY, {
            ...ArgosPayment.settings(secret),
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
          assert.strictEqual(req?.metaData.bankName, "SBP");
        },
        async check_merchant_response({ processing_response }) {
          await processing_response?.as_8pay_requisite();
        },
      });

      dataFlowTest("use_settings_method_priority", {
        ...argosSuite(),
        settings(secret) {
          return providers(CURRENCY, {
            ...ArgosPayment.settings(secret),
            payment_method: "sbp",
            use_setting_method_priority: true,
          });
        },
        request() {
          return {
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "card",
          };
        },
        after_create_check() {
          let req = this.gw.request_data;
          assert.strictEqual(req?.metaData.bankName, "SBP");
        },
        async check_merchant_response({ processing_response }) {
          await processing_response?.as_8pay_requisite();
        },
      });
    });

    describe
      .skipIf(CONFIG.project === "8pay")
      .concurrent("argos pcidss requisite", () => {
        dataFlowTest("bank_account sbp", {
          ...argosSuite(),
          request() {
            return {
              ...common.paymentRequest(CURRENCY),
              bank_account: {
                requisite_type: "sbp",
              },
            };
          },
          async check_merchant_response({
            processing_response,
            create_response,
          }) {
            assert.strictEqual(this.gw.request_data?.metaData.bankName, "SBP");
            assert.strictEqual(
              this.gw.request_data?.txDetails.orderData.amount,
              common.amount / 100,
            );
            let requisites = await processing_response?.as_8pay_requisite();
            assert.strictEqual(requisites?.pan, `+${common.phoneNumber}`);
            assert.strictEqual(requisites?.name_seller, common.fullName);
            assert.strictEqual(requisites?.id, create_response.token);
          },
        });

        dataFlowTest("bank_account card", {
          ...argosSuite(),
          request() {
            return {
              ...common.paymentRequest(CURRENCY),
              bank_account: {
                requisite_type: "card",
              },
            };
          },
          async check_merchant_response({
            processing_response,
            create_response,
          }) {
            assert.notStrictEqual(
              this.gw.request_data?.metaData.bankName,
              "SBP",
            );
            assert.strictEqual(
              this.gw.request_data?.txDetails.orderData.amount,
              common.amount / 100,
            );
            let requisites = await processing_response?.as_8pay_requisite();
            assert.strictEqual(requisites?.pan, common.visaCard);
            assert.strictEqual(requisites?.name_seller, common.fullName);
            assert.strictEqual(requisites?.id, create_response.token);
          },
        });
      });
  });

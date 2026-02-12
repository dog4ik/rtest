import * as common from "@/common";
import { FortaPayment } from "@/provider_mocks/forta";
import { payinSuite } from "@/provider_mocks/forta";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  type PayformDataFlow,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import { err_bad_status } from "@/fetch_utils";
import { EightpayTpayQrForm, type Platform } from "@/pages/8pay_tpayform";
import { z } from "zod";

const CURRENCY = "RUB";

function fortaSuite() {
  let suite = payinSuite(CURRENCY);
  return {
    ...suite,
    settings: (secret: string) =>
      providers(CURRENCY, {
        ...FortaPayment.settings(secret),
        wrapped_to_json_response: true,
      }),
  };
}

describe.runIf(PROJECT === "8pay").concurrent("forta 8pay", () => {
  callbackFinalizationSuite(fortaSuite);

  test.concurrent("forta no requisities decline", async ({ ctx }) => {
    await ctx.track_bg_rejections(async () => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(
        providers("RUB", {
          ...FortaPayment.settings(ctx.uuid),
          wrapped_to_json_response: true,
        }),
      );
      let forta = ctx.mock_server(FortaPayment.mock_params(ctx.uuid));
      forta.queue(FortaPayment.no_requisites_handler());
      let notification = merchant.queue_notification((callback) => {
        assert.strictEqual(
          callback.status,
          "declined",
          "declined notification",
        );
      });
      let response = await merchant
        .create_payment({
          ...common.paymentRequest("RUB"),
          extra_return_param: "ANY",
        })
        .then((p) => p.followFirstProcessingUrl());
      let json = await response.as_raw_json();

      if (CONFIG.project === "8pay") {
        z.object({
          declination_reason: z.literal(
            "gateway response error: Произошла непредвиденная ошибка, обратитесь в службу поддержки",
          ),
        }).parse(json);
      } else {
        z.object({
          declination_reason: z.literal(
            "Произошла непредвиденная ошибка, обратитесь в службу поддержки",
          ),
        }).parse(json);
      }

      assert.strictEqual(response.status(), 200);
      await notification;
    });
  });

  describe.concurrent("forta 8pay requisite", () => {
    dataFlowTest("extra_return_param sbp", {
      ...fortaSuite(),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "SBP",
        };
      },
      async check_merchant_response({ processing_response, create_response }) {
        assert.strictEqual(this.gw.request_data?.bank, "SBP");
        assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
        assert.strictEqual(
          this.gw.request_data?.orderId,
          create_response.token,
        );
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.name_seller, common.fullName);
        assert.strictEqual(res?.pan, `+${common.phoneNumber}`);
      },
    });

    dataFlowTest("extra_return_param cards", {
      ...fortaSuite(),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "Cards",
        };
      },
      async check_merchant_response({ processing_response, create_response }) {
        assert.strictEqual(this.gw.request_data?.bank, "ANY");
        assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
        assert.strictEqual(
          this.gw.request_data?.orderId,
          create_response.token,
        );
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.name_seller, common.fullName);
        assert.strictEqual(res?.pan, common.visaCard);
      },
    });

    dataFlowTest("extra_return_param tbank", {
      ...fortaSuite(),
      request() {
        return {
          ...common.paymentRequest(CURRENCY),
          extra_return_param: "tpay",
        };
      },
      async check_merchant_response({ processing_response, create_response }) {
        assert.strictEqual(this.gw.request_data?.bank, "tpay");
        assert.strictEqual(this.gw.request_data?.amount, common.amount / 100);
        assert.strictEqual(
          this.gw.request_data?.orderId,
          create_response.token,
        );
        let res = await processing_response?.as_8pay_requisite();
        assert.strictEqual(res?.name_seller, common.fullName);
        assert(res?.deeplink);
        let httpRes = await fetch(res.deeplink, {
          redirect: "manual",
          method: "GET",
        }).then(err_bad_status);
        assert.strictEqual(httpRes.status, 302);
        assert.strictEqual(
          httpRes.headers.get("location"),
          `tinkoffbank://Main/PayByMobileNumber?amount=${common.amount / 100}&numberPhone=%2B${common.phoneNumber}&workflowType=RTLNTransfer`,
        );
        assert.strictEqual(res?.pan, `+${common.phoneNumber}`);
      },
    });
  });
});

describe.runIf(PROJECT == "8pay").concurrent("forta 8pay form", () => {
  payformDataFlowTest("card", {
    ...payinSuite(CURRENCY),
    settings: (secret) =>
      providers(CURRENCY, {
        ...FortaPayment.settings(secret),
        wrapped_to_json_response: false,
      }),
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "ANY",
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
    ...payinSuite(CURRENCY),
    settings: (secret) =>
      providers(CURRENCY, {
        ...FortaPayment.settings(secret),
        wrapped_to_json_response: false,
        masked_provider: true,
      }),
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "SBP",
        locale: "en",
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

  const tpaySuite = (platform: Platform): PayformDataFlow => ({
    ...payinSuite(CURRENCY),
    settings: (secret) =>
      providers(CURRENCY, {
        ...FortaPayment.settings(secret),
        wrapped_to_json_response: false,
        masked_provider: true,
      }),
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "tpay",
      };
    },
    async check_pf_page(page) {
      let form = new EightpayTpayQrForm(page, platform);
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.phoneNumber,
      });
    },
  });

  payformDataFlowTest("tpay android", {
    ...tpaySuite("android"),
    browser_context(browser) {
      return browser.newContext({ userAgent: common.androidUserAgent });
    },
  });

  payformDataFlowTest("tpay ios", {
    ...tpaySuite("ios"),
    browser_context(browser) {
      return browser.newContext({ userAgent: common.iosUserAgent });
    },
  });

  payformDataFlowTest("tpay desktop", {
    ...tpaySuite("android"),
    browser_context(browser) {
      return browser.newContext({ userAgent: common.desktopUserAgent });
    },
  });

  payformDataFlowTest("tpay en locale", {
    ...tpaySuite("android"),
    browser_context(browser) {
      return browser.newContext({ userAgent: common.desktopUserAgent });
    },
    request() {
      return {
        ...common.paymentRequest(CURRENCY),
        extra_return_param: "tpay",
        locale: "en",
      };
    },
  });
});

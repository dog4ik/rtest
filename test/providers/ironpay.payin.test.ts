import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  IronpayMethodMap,
  IronpayPayment,
  type IronpayStatus,
} from "@/provider_mocks/ironpay";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  payformDataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
} from "@/suite_interfaces";
import { providers } from "@/settings_builder";
import { CONFIG, test } from "@/test_context";
import { assert, describe } from "vitest";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

const CURRENCY = "RUB";

function ironpaySuite() {
  let gw = new IronpayPayment();
  let statusMap: Record<PrimeBusinessStatus, IronpayStatus> = {
    approved: "Approved",
    declined: "Canceled",
    pending: "Pending",
  };
  return {
    send_callback: async function (status, secret) {
      await gw.send_callback(statusMap[status], secret);
    },
    type: "payin",
    create_handler: () => gw.create_handler(),
    mock_options: IronpayPayment.mock_params,
    request: function () {
      return { ...common.paymentRequest(CURRENCY), extra_return_param: "card" };
    },
    settings: (secret) =>
      providers(CURRENCY, {
        ...IronpayPayment.settings(secret),
      }),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    gw,
  } satisfies Callback & Status & { gw: IronpayPayment };
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
    let notification = merchant.queue_notification((callback) => {
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
    await processing_response?.validateRequisites({
      name: common.fullName,
      number: `+${common.phoneNumber}`,
      type: "sbp",
      bank: "Россельхозбанк",
    });
  },
});

describe
  .skipIf(CONFIG.project === "8pay")
  .concurrent("pcidss bank_account", () => {
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
          bank: "Россельхозбанк",
        });
      },
    });

    dataFlowTest("card extra_return_param", {
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
          bank: "Россельхозбанк",
        });
      },
    });
  });

dataFlowTest("card extra_return_param", {
  ...ironpaySuite(),
  request() {
    return {
      ...common.paymentRequest(CURRENCY),
      extra_return_param: "card",
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
      bank: "Россельхозбанк",
    });
  },
});

describe
  .skipIf(CONFIG.project !== "8pay")
  .concurrent("ironpay 8pay payform", () => {
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
          extra_return_param: "card",
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

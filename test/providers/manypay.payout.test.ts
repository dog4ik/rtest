import type { PrimeBusinessStatus } from "@/db/business";
import * as common from "@/common";
import {
  ManypayPayout,
  type ManypayStatus,
  ManypayStatusMap,
} from "@/provider_mocks/manypay";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  statusFinalizationSuite,
  type Callback,
  type Status,
  type TestCaseOptions,
} from "@/suite_interfaces";
import { defaultSettings, SettingsBuilder } from "@/settings_builder";
import { CONFIG } from "@/test_context";
import { assert } from "vitest";

const CURRENCY = "RUB";

function manypaySuite() {
  let gw = new ManypayPayout();
  let statusMap: Record<PrimeBusinessStatus, ManypayStatus> = {
    approved: ManypayStatusMap.SUCCESSFUL,
    declined: ManypayStatusMap.CANCELED,
    pending: ManypayStatusMap.PENDING,
  };
  return {
    type: "payout",
    send_callback: async function (status, _) {
      await gw.send_callback(statusMap[status]);
    },
    create_handler: (s) => gw.create_handler(statusMap[s]),
    mock_options: ManypayPayout.mock_params,
    request: function () {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
      };
    },
    settings: (secret) =>
      new SettingsBuilder()
        .addP2P(CURRENCY, "manypay")
        .withGateway(ManypayPayout.settings(secret), "manypay")
        .withGatewayParam("skip_card_payout_validation", true)
        .build(),
    status_handler: (s) => gw.status_handler(statusMap[s]),
    gw,
  } satisfies Callback & Status & { gw: ManypayPayout };
}
manypaySuite().gw;

const OPTS: TestCaseOptions = { skip_if: !CONFIG.extra_mapping?.["manypay"] };

callbackFinalizationSuite(manypaySuite, OPTS);
statusFinalizationSuite(manypaySuite, OPTS);

dataFlowTest(
  "bank_list mapping",
  {
    ...manypaySuite(),
    settings(secret) {
      return defaultSettings(CURRENCY, {
        ...ManypayPayout.settings(secret),
        bank_list: {
          Сбербанк: "sberbank",
        },
      });
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "Сбербанк",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "sberbank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "bank_list mapping miss",
  {
    ...manypaySuite(),
    settings(secret) {
      return defaultSettings(CURRENCY, {
        ...ManypayPayout.settings(secret),
        bank_list: {
          Сбербанк: "sberbank",
        },
      });
    },
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "tbank",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "tbank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "card extra_return_param",
  {
    ...manypaySuite(),
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
        extra_return_param: "sberbank",
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.strictEqual(this.gw.request_data?.payment.bank, "sberbank");
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "card no bank",
  {
    ...manypaySuite(),
    request() {
      return {
        ...common.payoutRequest(CURRENCY),
        card: { pan: common.visaCard },
      };
    },
    after_create_check() {
      assert.strictEqual(this.gw.request_data?.payment.number, common.visaCard);
      assert.isUndefined(this.gw.request_data?.payment.bank);
      assert.strictEqual(
        this.gw.request_data?.payment.payment_method,
        "card2card",
      );
    },
  },
  OPTS,
);

dataFlowTest(
  "sbp extra_return_param",
  {
    ...manypaySuite(),
    request() {
      let req = common.payoutRequest(CURRENCY);
      return {
        ...req,
        customer: {
          ...req.customer,
          phone: common.phoneNumber,
        },
        extra_return_param: "tbank",
      };
    },
    after_create_check() {
      assert.strictEqual(
        this.gw.request_data?.payment.number,
        common.phoneNumber,
      );
      assert.strictEqual(this.gw.request_data?.payment.bank, "tbank");
      assert.strictEqual(this.gw.request_data?.payment.payment_method, "sbp");
    },
  },
  OPTS,
);

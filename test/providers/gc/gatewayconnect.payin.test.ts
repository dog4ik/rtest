import {
  GatewayConnectTransaction,
  payinSuite,
} from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  defaultSuite,
  providersSuite,
  statusFinalizationSuite,
  type P2PSuite,
} from "@/suite_interfaces";
import * as common from "@/common";
import { assert } from "vitest";
import { PROJECT } from "@/config";

let providersP2PSuite = () => providersSuite("RUB", payinSuite());

callbackFinalizationSuite(providersP2PSuite);
statusFinalizationSuite(providersP2PSuite);

let requisitesP2PSuite = (requisite: "card" | "sbp") => {
  let suite = payinSuite();
  return providersSuite("RUB", {
    ...suite,
    create_handler(s) {
      return this.gw.requisites_payin_handler(s, requisite);
    },
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: true,
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
};

dataFlowTest("card", {
  ...requisitesP2PSuite("card"),
  check_merchant_response: async (data) => {
    await data.processing_response?.validateRequisites({
      bank: common.bankName,
      name: common.fullName,
      type: "card",
      number: common.visaCard,
    });
  },
});

dataFlowTest(
  "sbp pcidss",
  {
    ...requisitesP2PSuite("sbp"),
    check_merchant_response: async (data) => {
      let req = await data.processing_response?.as_trader_requisites();
      assert.strictEqual(req?.card?.pan, common.phoneNumber);
      assert.strictEqual(req?.card?.name, common.fullName);
      assert.strictEqual(req?.card?.bank, common.bankName);
    },
  },
  { skip_if: PROJECT != "reactivepay" },
);

let ecomPayinSuite = () => {
  let suite = payinSuite();
  return defaultSuite("RUB", {
    ...suite,
    create_handler() {
      return this.gw.redirect_3ds_response_handler();
    },
    settings: (s) => ({
      ...suite.settings(s),
      wrapped_to_json_response: true,
    }),
    request: () => ({
      ...common.paymentRequest("RUB"),
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
};

dataFlowTest("ecom redirect 3ds", {
  ...ecomPayinSuite(),
  check_merchant_response(data) {
    data.create_response;
  },
});

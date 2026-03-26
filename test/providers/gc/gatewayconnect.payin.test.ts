import {
  GatewayConnectTransaction,
  payinSuite,
  type GcRequisiteType,
} from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  dataFlowTest,
  defaultSuite,
  payformDataFlowTest,
  providersSuite,
  statusFinalizationSuite,
  type P2PSuite,
} from "@/suite_interfaces";
import * as common from "@/common";
import { assert } from "vitest";
import { CONFIG, PROJECT } from "@/config";
import { describe } from "vitest";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

let MAP: Record<GcRequisiteType, string> = {
  card: "Cards",
  sbp: "SBP",
  link: "sbp_aquiring",
  deeplink: "sbp_aquiring",
};

let providersP2PSuite = () => providersSuite("RUB", payinSuite());

callbackFinalizationSuite(providersP2PSuite);
statusFinalizationSuite(providersP2PSuite);

let requisitesP2PSuite = (requisite: GcRequisiteType) => {
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
  request: () => common.p2pPaymentRequest("RUB", "card"),
  check_merchant_response: async (data) => {
    await data.processing_response?.validateRequisites({
      bank: common.bankName,
      name: common.fullName,
      type: "card",
      number: common.visaCard,
    });
  },
});

dataFlowTest("sbp", {
  ...requisitesP2PSuite("sbp"),
  request: () => common.p2pPaymentRequest("RUB", "sbp"),
  check_merchant_response: async (data) => {
    await data.processing_response?.validateRequisites({
      bank: common.bankName,
      name: common.fullName,
      type: "sbp",
      number: common.phoneNumber,
    });
  },
});

dataFlowTest("link", {
  ...requisitesP2PSuite("link"),
  request: () => common.p2pPaymentRequest("RUB", "link"),
  async check_merchant_response(data) {
    let json = (await data.processing_response?.as_raw_json()) as any;
    assert.strictEqual(json.link?.deeplink, common.redirectPayUrl);
    assert.strictEqual(json.deeplink, common.redirectPayUrl);
    assert.strictEqual(json.name_seller, common.fullName);
    assert.strictEqual(json.id, this.gw.gateway_id);
  },
});

describe.runIf(CONFIG.in_project("8pay")).concurrent("8pay form", () => {
  let formRequisitesP2PSuite = (requisite: GcRequisiteType) => {
    let suite = payinSuite();
    return providersSuite("RUB", {
      ...suite,
      create_handler(s) {
        return this.gw.requisites_payin_handler(s, requisite);
      },
      request: () => {
        let req = suite.request();
        return {
          ...req,
          extra_return_param: MAP[requisite],
        };
      },
      settings: (s) => ({
        ...suite.settings(s),
        wrapped_to_json_response: false,
      }),
    }) as P2PSuite<GatewayConnectTransaction>;
  };

  payformDataFlowTest("sbp", {
    ...formRequisitesP2PSuite("sbp"),
    check_pf_page: async (page) => {
      let form = new EightpayRequisitesPage(page);
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.phoneNumber,
        type: "sbp",
      });
    },
  });

  payformDataFlowTest("link", {
    ...formRequisitesP2PSuite("link"),
    check_pf_page: async (page) => {
      let form = new EightpayRequisitesPage(page);
      await form.validate_qr();
    },
  });

  payformDataFlowTest("card", {
    ...formRequisitesP2PSuite("card"),
    check_pf_page: async (page) => {
      let form = new EightpayRequisitesPage(page);
      await form.validateRequisites({
        amount: common.amount,
        bank: common.bankName,
        name: common.fullName,
        number: common.visaCard,
        type: "card",
      });
    },
  });
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
  { skip_if: !CONFIG.in_project(["reactivepay", "spinpay"]) },
);

describe
  .runIf(CONFIG.in_project("8pay"))
  .concurrent("8pay method setting", () => {
    let methodPayformSuite = (
      requisite: GcRequisiteType,
      method: "card" | "sbp" | "sbp_aquiring",
    ) => {
      let suite = payinSuite();
      return providersSuite("RUB", {
        ...suite,
        create_handler(s) {
          return this.gw.requisites_payin_handler(s, requisite);
        },
        request: () => common.paymentRequest("RUB"),
        settings: (s) => ({
          ...suite.settings(s),
          wrapped_to_json_response: false,
          method,
        }),
      }) as P2PSuite<GatewayConnectTransaction>;
    };

    let methodH2HSuite = (
      requisite: GcRequisiteType,
      method: "card" | "sbp" | "sbp_aquiring",
    ) => {
      let suite = payinSuite();
      return providersSuite("RUB", {
        ...suite,
        create_handler(s) {
          return this.gw.requisites_payin_handler(s, requisite);
        },
        request: () => common.paymentRequest("RUB"),
        settings: (s) => ({
          ...suite.settings(s),
          wrapped_to_json_response: true,
          method,
        }),
      }) as P2PSuite<GatewayConnectTransaction>;
    };

    payformDataFlowTest("card method setting", {
      ...methodPayformSuite("card", "card"),
      check_pf_page: async (page) => {
        let form = new EightpayRequisitesPage(page);
        await form.validateRequisites({
          amount: common.amount,
          bank: common.bankName,
          name: common.fullName,
          number: common.visaCard,
          type: "card",
        });
      },
    });

    payformDataFlowTest("link method setting", {
      ...methodPayformSuite("link", "sbp_aquiring"),
      check_pf_page: async (page) => {
        let form = new EightpayRequisitesPage(page);
        await form.validate_qr();
      },
    });

    dataFlowTest("card method setting", {
      ...methodH2HSuite("card", "card"),
      async check_merchant_response({ processing_response }) {
        let req = await processing_response?.as_8pay_requisite();
        assert.strictEqual(req?.pan, common.visaCard);
        assert.strictEqual(req?.name_seller, common.fullName);
        assert.strictEqual(req?.id, this.gw.gateway_id);
      },
    });

    dataFlowTest("sbp method setting", {
      ...methodH2HSuite("sbp", "sbp"),
      async check_merchant_response({ processing_response }) {
        let req = await processing_response?.as_8pay_requisite();
        assert.strictEqual(req?.pan, common.phoneNumber);
        assert.strictEqual(req?.name_seller, common.fullName);
        assert.strictEqual(req?.id, this.gw.gateway_id);
      },
    });

    dataFlowTest("link method setting", {
      ...methodH2HSuite("link", "sbp_aquiring"),
      async check_merchant_response({ processing_response }) {
        let json = (await processing_response?.as_raw_json()) as any;
        assert.strictEqual(json.link?.deeplink, common.redirectPayUrl);
        assert.strictEqual(json.deeplink, common.redirectPayUrl);
        assert.strictEqual(json.name_seller, common.fullName);
        assert.strictEqual(json.id, this.gw.gateway_id);
      },
    });
  });

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
      card: common.cardObject(),
    }),
  }) as P2PSuite<GatewayConnectTransaction>;
};

dataFlowTest("ecom redirect 3ds", {
  ...ecomPayinSuite(),
  check_merchant_response(data) {
    data.create_response;
  },
});

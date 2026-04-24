import * as mad from "@/provider_mocks/madsolution";
import * as mil from "@/provider_mocks/millennium";
import * as brus from "@/provider_mocks/brusnika";
import * as iron from "@/provider_mocks/ironpay";
import * as forta from "@/provider_mocks/forta";
import * as pixel from "@/provider_mocks/pixelwave";
import * as argos from "@/provider_mocks/argos";
import * as gatewayconnect from "@/provider_mocks/gateway_connect";
import { CONFIG } from "@/config";
import { describe } from "vitest";
import * as common from "@/common";
import * as playwright from "playwright";
import {
  maskedSuite,
  routingFinalizationSuite,
  type Callback,
  type P2PSuite,
  type Routable,
} from "@/suite_interfaces";
import type { ProcessingUrlResponse } from "@/entities/payment/processing_url_response";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";
import { GatewayConnectTransaction } from "@/provider_mocks/gateway_connect";
import { SpinpayRequisitesPage } from "@/pages/spinpay_payform";

const use_status_handler = true;

function gatewayConnectRoutingSuite(
  req_type: gatewayconnect.GcRequisiteType,
  wrapped_to_json_response = true,
): P2PSuite<GatewayConnectTransaction> {
  let suite = gatewayconnect.payinSuite(undefined, crypto.randomUUID());
  return {
    ...suite,
    create_handler() {
      return this.gw.requisites_payin_handler("pending", req_type);
    },
    no_requisites_handler() {
      return this.gw.requisites_payin_handler("declined", req_type);
    },
    settings(secret) {
      return {
        ...suite.settings(secret),
        wrapped_to_json_response,
      };
    },
  } as P2PSuite<GatewayConnectTransaction>;
}

const CURRENCY = "RUB";

describe.runIf(CONFIG.in_project("8pay")).concurrent("routing 8pay", () => {
  let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
  let check_merchant_requisites = (r: ProcessingUrlResponse) =>
    r.as_8pay_requisite();
  let check_missed_requisites = (r: ProcessingUrlResponse) => r.as_error();
  let check_merchant_payform = async (page: playwright.Page) => {
    let payform = new EightpayRequisitesPage(page);
    await payform.validateRequisites({
      type: "card",
      number: common.visaCard,
      bank: undefined,
      amount: common.amount,
      name: common.fullName,
    });
  };

  function allCases(): (() => (Routable & Callback)[])[] {
    let cases: (() => (Routable & Callback)[])[] = [
      () => [
        forta.payinSuite(),
        mil.payinSuite(),
        mad.payinSuite(),
        brus.payinSuite(),
      ],
      () => [brus.payinSuite(), mil.payinSuite(), mad.payinSuite()],
      () => [brus.payinSuite(), mad.payinSuite(), mil.payinSuite()],
      () => [
        mad.payinSuite(),
        brus.payinSuite(),
        iron.payinSuite(),
        forta.payinSuite(),
      ],
      () => [brus.payinSuite(), forta.payinSuite()],
      () => [gatewayConnectRoutingSuite("card"), brus.payinSuite()],
      () => [
        gatewayConnectRoutingSuite("card"),
        gatewayConnectRoutingSuite("card"),
        gatewayConnectRoutingSuite("card"),
      ],
      () => [brus.payinSuite(), gatewayConnectRoutingSuite("card")],
    ];
    if (CONFIG.extra_mapping?.["pixelwave"]) {
      cases.push(() => [pixel.payinSuite(), brus.payinSuite()]);
      cases.push(() => [brus.payinSuite(), pixel.payinSuite()]);
      cases.push(() => [
        brus.payinSuite(),
        pixel.payinSuite(),
        forta.payinSuite(),
      ]);
    }
    return cases;
  }

  for (let c of allCases()) {
    routingFinalizationSuite(
      c() as [...Routable[], Routable & Callback],
      req,
      {
        check_merchant_requisites,
        check_merchant_payform,
        check_missed_requisites,
      },
      { use_status_handler },
    );
  }

  describe.concurrent("masked routing", () => {
    for (let c of allCases().map((c) =>
      c().map((link) => {
        // Gateway connect integrations fail with masked_provider setting
        if (
          link.gw instanceof pixel.PixelwavePayment ||
          link.gw instanceof gatewayconnect.GatewayConnectTransaction
        ) {
          return link;
        }
        return maskedSuite(link);
      }),
    )) {
      routingFinalizationSuite(
        c as [...Routable[], Routable & Callback],
        req,
        {
          check_merchant_requisites,
          check_merchant_payform,
          check_missed_requisites,
        },
        {},
      );
    }
  });

  routingFinalizationSuite(
    [forta.payinSuite(), mil.payinSuite(), mad.payinSuite(), brus.payinSuite()],
    req,
    { check_merchant_requisites, check_merchant_payform },
    { use_status_handler },
  );

  routingFinalizationSuite(
    [brus.payinSuite(), mil.payinSuite(), mad.payinSuite()],
    req,
    { check_merchant_requisites, check_merchant_payform },
    { use_status_handler },
  );

  routingFinalizationSuite(
    [brus.payinSuite(), mad.payinSuite(), mil.payinSuite()],
    req,
    { check_merchant_requisites, check_merchant_payform },
    { use_status_handler },
  );
  routingFinalizationSuite(
    [
      mad.payinSuite(),
      brus.payinSuite(),
      iron.payinSuite(),
      forta.payinSuite(),
    ],
    req,
    { check_merchant_requisites, check_merchant_payform },
    { use_status_handler },
  );
});

describe
  .runIf(CONFIG.in_project("spinpay"))
  .concurrent("routing spinpay", () => {
    let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
    let check_merchant_requisites = (r: ProcessingUrlResponse) =>
      r.as_trader_requisites();
    let check_missed_requisites = (r: ProcessingUrlResponse) => r.as_error();

    let check_merchant_payform = async (page: playwright.Page) => {
      let payform = new SpinpayRequisitesPage(page);
      await payform.validateRequisites({
        type: "card",
        number: common.visaCard,
        bank: undefined,
        amount: common.amount,
        name: common.fullName,
      });
    };

    function allCases(): (() => (Routable & Callback)[])[] {
      return [
        () => [brus.payinSuite(), iron.payinSuite()],
        () => [iron.payinSuite(), brus.payinSuite()],
        () => [
          gatewayConnectRoutingSuite("card"),
          iron.payinSuite(),
          brus.payinSuite(),
        ],
        () => [brus.payinSuite(), gatewayConnectRoutingSuite("card")],
        () => [iron.payinSuite(), gatewayConnectRoutingSuite("card")],
        () => [gatewayConnectRoutingSuite("card"), iron.payinSuite()],
        () => [
          gatewayConnectRoutingSuite("card"),
          iron.payinSuite(),
          gatewayConnectRoutingSuite("card"),
        ],
        () => [
          gatewayConnectRoutingSuite("card"),
          gatewayConnectRoutingSuite("card"),
        ],
        () => [gatewayConnectRoutingSuite("card"), brus.payinSuite()],
        () => [brus.payinSuite(), iron.payinSuite()],
      ];
    }

    for (let c of allCases()) {
      routingFinalizationSuite(
        c() as [...Routable[], Routable & Callback],
        req,
        {
          check_merchant_requisites,
          check_merchant_payform,
          check_missed_requisites,
        },
        { use_status_handler },
      );
    }

    describe.concurrent("masked routing", () => {
      for (let c of allCases().map((c) =>
        c().map((link) => {
          if (link.gw instanceof GatewayConnectTransaction) {
            return link;
          }
          return maskedSuite(link);
        }),
      )) {
        routingFinalizationSuite(
          c as [...Routable[], Routable & Callback],
          req,
          {
            check_merchant_requisites,
            check_merchant_payform,
            check_missed_requisites,
          },
          { is_masked: true, use_status_handler },
        );
      }
    });
  });

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("routing pcidss", () => {
    let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
    let check_merchant_requisites = (r: ProcessingUrlResponse) =>
      r.as_trader_requisites();
    let check_missed_requisites = (r: ProcessingUrlResponse) => r.as_error();

    function allCases(): (() => (Routable & Callback)[])[] {
      return [
        () => [
          brus.payinSuite(),
          mad.payinSuite(),
          iron.payinSuite(),
          gatewayConnectRoutingSuite("card"),
        ],
        () => [brus.payinSuite(), gatewayConnectRoutingSuite("card")],
        () => [argos.payinSuite(), brus.payinSuite()],
        () => [
          brus.payinSuite(),
          gatewayConnectRoutingSuite("card"),
          iron.payinSuite(),
        ],
        () => [
          gatewayConnectRoutingSuite("card"),
          gatewayConnectRoutingSuite("card"),
          gatewayConnectRoutingSuite("card"),
        ],
        () => [brus.payinSuite(), mad.payinSuite(), iron.payinSuite()],
        () => [mad.payinSuite(), iron.payinSuite(), brus.payinSuite()],
        () => [
          mad.payinSuite(),
          iron.payinSuite(),
          argos.payinSuite(),
          brus.payinSuite(),
        ],
      ];
    }

    for (let c of allCases()) {
      routingFinalizationSuite(
        c() as [...Routable[], Routable & Callback],
        req,
        { check_merchant_requisites, check_missed_requisites },
        { use_status_handler },
      );
    }

    describe.concurrent("masked routing", () => {
      for (let c of allCases().map((c) =>
        c().map((link) => maskedSuite(link)),
      )) {
        routingFinalizationSuite(
          c as [...Routable[], Routable & Callback],
          req,
          { check_merchant_requisites, check_missed_requisites },
          { is_masked: true, use_status_handler },
        );
      }
    });
  });

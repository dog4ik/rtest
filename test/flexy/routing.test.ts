import * as mad from "@/provider_mocks/madsolution";
import * as mil from "@/provider_mocks/millennium";
import * as brus from "@/provider_mocks/brusnika";
import * as iron from "@/provider_mocks/ironpay";
import * as forta from "@/provider_mocks/forta";
import * as pixel from "@/provider_mocks/pixelwave";
import * as argos from "@/provider_mocks/argos";
import * as flint from "@/provider_mocks/flintpays";
import { CONFIG } from "@/config";
import { describe } from "vitest";
import * as common from "@/common";
import * as playwright from "playwright";
import {
  maskedSuite,
  routingFinalizationSuite,
  type Callback,
  type Routable,
} from "@/suite_interfaces";
import type { ProcessingUrlResponse } from "@/entities/payment/processing_url_response";
import { EightpayRequisitesPage } from "@/pages/8pay_payform";

const CURRENCY = "RUB";

describe.runIf(CONFIG.in_project("8pay")).concurrent("routing 8pay", () => {
  let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
  let check_merchant_requisites = (r: ProcessingUrlResponse) =>
    r.as_8pay_requisite();
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
      req(),
      { check_merchant_requisites, check_merchant_payform },
    );
  }

  describe.concurrent("masked routing", () => {
    for (let c of allCases().map((c) =>
      c().map((link) => {
        // Gateway connect integrations fail with masked_provider setting
        if (link.gw instanceof pixel.PixelwavePayment) {
          return link;
        }
        return maskedSuite(link);
      }),
    )) {
      routingFinalizationSuite(
        c as [...Routable[], Routable & Callback],
        req(),
        { check_merchant_requisites, check_merchant_payform },
        true,
      );
    }
  });

  routingFinalizationSuite(
    [forta.payinSuite(), mil.payinSuite(), mad.payinSuite(), brus.payinSuite()],
    req(),
    { check_merchant_requisites, check_merchant_payform },
  );

  routingFinalizationSuite(
    [brus.payinSuite(), mil.payinSuite(), mad.payinSuite()],
    req(),
    { check_merchant_requisites, check_merchant_payform },
  );

  routingFinalizationSuite(
    [brus.payinSuite(), mad.payinSuite(), mil.payinSuite()],
    req(),
    { check_merchant_requisites, check_merchant_payform },
  );
  routingFinalizationSuite(
    [
      mad.payinSuite(),
      brus.payinSuite(),
      iron.payinSuite(),
      forta.payinSuite(),
    ],
    req(),
    { check_merchant_requisites, check_merchant_payform },
  );
});

describe
  .runIf(CONFIG.in_project("spinpay"))
  .concurrent("routing spinpay", () => {
    let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
    let check_merchant_requisites = (r: ProcessingUrlResponse) =>
      r.as_trader_requisites();
    routingFinalizationSuite([brus.payinSuite(), iron.payinSuite()], req(), {
      check_merchant_requisites,
    });

    routingFinalizationSuite([iron.payinSuite(), brus.payinSuite()], req(), {
      check_merchant_requisites,
    });

    routingFinalizationSuite(
      [brus.payinSuite(), flint.payinSuite(), iron.payinSuite()],
      req(),
      { check_merchant_requisites },
    );
    routingFinalizationSuite([flint.payinSuite(), brus.payinSuite()], req(), {
      check_merchant_requisites,
    });
  });

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("routing pcidss", () => {
    let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
    let check_merchant_requisites = (r: ProcessingUrlResponse) =>
      r.as_trader_requisites();
    routingFinalizationSuite(
      [brus.payinSuite(), mad.payinSuite(), iron.payinSuite()],
      req(),
      { check_merchant_requisites },
    );

    routingFinalizationSuite(
      [
        brus.payinSuite(),
        flint.payinSuite(),
        mad.payinSuite(),
        iron.payinSuite(),
      ],
      req(),
      { check_merchant_requisites },
    );

    routingFinalizationSuite(
      [mad.payinSuite(), iron.payinSuite(), brus.payinSuite()],
      req(),
      { check_merchant_requisites },
    );

    routingFinalizationSuite(
      [
        mad.payinSuite(),
        iron.payinSuite(),
        argos.payinSuite(),
        brus.payinSuite(),
      ],
      req(),
      { check_merchant_requisites },
    );
  });

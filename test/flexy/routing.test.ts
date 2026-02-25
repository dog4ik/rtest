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
import {
  maskedSuite,
  routingFinalizationSuite,
  type Callback,
  type P2PSuite,
  type Routable,
} from "@/suite_interfaces";
import type { ProcessingUrlResponse } from "@/entities/payment/processing_url_response";

const CURRENCY = "RUB";

describe.runIf(CONFIG.in_project("8pay")).concurrent("routing 8pay", () => {
  let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
  let check = (r: ProcessingUrlResponse) => r.as_8pay_requisite();

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
    }
    return cases;
  }
  for (let c of allCases()) {
    routingFinalizationSuite(
      c() as [...Routable[], Routable & Callback],
      req(),
      check,
    );
  }

  describe.concurrent("masked routing", () => {
    for (let c of allCases().map((c) => c().map(maskedSuite))) {
      routingFinalizationSuite(
        c as [...Routable[], Routable & Callback],
        req(),
        check,
        true,
      );
    }
  });

  routingFinalizationSuite(
    [forta.payinSuite(), mil.payinSuite(), mad.payinSuite(), brus.payinSuite()],
    req(),
    check,
  );

  routingFinalizationSuite(
    [brus.payinSuite(), mil.payinSuite(), mad.payinSuite()],
    req(),
    check,
  );

  routingFinalizationSuite(
    [brus.payinSuite(), mad.payinSuite(), mil.payinSuite()],
    req(),
    check,
  );
  routingFinalizationSuite(
    [
      mad.payinSuite(),
      brus.payinSuite(),
      iron.payinSuite(),
      forta.payinSuite(),
    ],
    req(),
    check,
  );
});

describe
  .runIf(CONFIG.in_project("spinpay"))
  .concurrent("routing spinpay", () => {
    let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
    let check = (r: ProcessingUrlResponse) => r.as_trader_requisites();
    routingFinalizationSuite(
      [brus.payinSuite(), iron.payinSuite()],
      req(),
      check,
    );

    routingFinalizationSuite(
      [iron.payinSuite(), brus.payinSuite()],
      req(),
      check,
    );

    routingFinalizationSuite(
      [brus.payinSuite(), flint.payinSuite(), iron.payinSuite()],
      req(),
      check,
    );
    routingFinalizationSuite(
      [flint.payinSuite(), brus.payinSuite()],
      req(),
      check,
    );
  });

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("routing pcidss", () => {
    let req = () => ({ ...common.p2pPaymentRequest(CURRENCY, "card") });
    let check = (r: ProcessingUrlResponse) => r.as_trader_requisites();
    routingFinalizationSuite(
      [brus.payinSuite(), mad.payinSuite(), iron.payinSuite()],
      req(),
      check,
    );

    routingFinalizationSuite(
      [
        brus.payinSuite(),
        flint.payinSuite(),
        mad.payinSuite(),
        iron.payinSuite(),
      ],
      req(),
      check,
    );

    routingFinalizationSuite(
      [mad.payinSuite(), iron.payinSuite(), brus.payinSuite()],
      req(),
      check,
    );

    routingFinalizationSuite(
      [
        mad.payinSuite(),
        iron.payinSuite(),
        argos.payinSuite(),
        brus.payinSuite(),
      ],
      req(),
      check,
    );
  });

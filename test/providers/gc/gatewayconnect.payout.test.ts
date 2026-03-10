import { payoutSuite } from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  defaultSuite,
  payoutPendingSuite,
  providersSuite,
  statusFinalizationSuite,
} from "@/suite_interfaces";
import { test } from "@/test_context";
import * as common from "@/common";

let p2pSuite = () => providersSuite("RUB", payoutSuite());
let ecomSuite = () => {
  let suite = payoutSuite();
  return defaultSuite("RUB", {
    ...suite,
    request: () => ({ ...suite.request(), card: { pan: common.visaCard } }),
  });
};

callbackFinalizationSuite(p2pSuite);
statusFinalizationSuite(p2pSuite);

payoutPendingSuite(ecomSuite());

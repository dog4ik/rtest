import { payoutSuite } from "@/provider_mocks/gateway_connect";
import {
  callbackFinalizationSuite,
  providersSuite,
  statusFinalizationSuite,
} from "@/suite_interfaces";

let p2pSuite = () => providersSuite("RUB", payoutSuite());

callbackFinalizationSuite(p2pSuite);
statusFinalizationSuite(p2pSuite);

import { describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import {
  type GatewayConnectTransaction,
  payinSuite,
} from "@/provider_mocks/gateway_connect";
import { defaultSuite, type P2PSuite } from "@/suite_interfaces";
import { test } from "@/test_context";

describe
  .runIf(CONFIG.in_project(["kotulapay"]))
  .concurrent("skip_processing_url", () => {
    function providersTestSuite(): P2PSuite<GatewayConnectTransaction> {
      let suite = payinSuite("RUB");
      return defaultSuite(
        "RUB",
        {
          ...suite,
          settings: (s) => {
            let settings = suite.settings(s);
            return { ...settings, wrapped_to_json_response: false };
          },
          request: () => ({
            ...common.paymentRequest("RUB"),
            customer: {
              email: common.email,
              phone: common.phoneNumber,
            },
            extra_return_param: "Mpesa",
          }),
        },
        { skip_processing_url: false, allow_h2h_payin_without_card: true },
      ) as P2PSuite<GatewayConnectTransaction>;
    }

    test.concurrent("without requisite", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let suite = providersTestSuite();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(suite.settings(ctx.uuid));
        let provider = ctx.mock_server(suite.mock_options(ctx.uuid));

        let provider_request = provider.queue(
          suite.gw.basic_payin_handler("pending"),
        );

        provider.queue(suite.gw.status_handler("approved"));

        await merchant.create_payment(suite.request());
        await provider_request;
      }));
  });

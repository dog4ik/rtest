import { describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { BrusnikaPayment, payinSuite } from "@/provider_mocks/brusnika";
import * as gcgcgen from "@/provider_mocks/gcgcgen";
import { providers } from "@/settings_builder";
import { providersSuite } from "@/suite_interfaces";
import { test } from "@/test_context";

describe
  .runIf(CONFIG.extra_mapping?.gcgcgen1)
  .concurrent("gcgcgen tests", () => {
    test.concurrent("payin status approved", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let suite = providersSuite("RUB", payinSuite());
        let gw = suite.gw;
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", gcgcgen.settings(ctx.uuid)),
        );
        let server = ctx.mock_server(suite.mock_options(ctx.uuid));
        let create = server.queue(gw.create_handler("in_progress"));
        await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await create;
        let success = merchant.queue_notification(() => {}, {
          expect: { status: 1 },
          skip_interaction_log_card_check: true,
        });
        await server.queue(gw.status_handler("success"));
        await success;
      }));

    test.concurrent("payin status declined", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let suite = providersSuite("RUB", payinSuite());
        let gw = suite.gw;
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", gcgcgen.settings(ctx.uuid)),
        );
        let server = ctx.mock_server(suite.mock_options(ctx.uuid));
        let create = server.queue(gw.create_handler("in_progress"));
        await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        await create;
        let decline = merchant.queue_notification(() => {}, {
          expect: { status: 2 },
          skip_interaction_log_card_check: true,
        });
        await server.queue(gw.status_handler("failed"));
        await decline;
      }));

    test.concurrent("payin error", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let suite = providersSuite("RUB", payinSuite());
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(
          providers("RUB", gcgcgen.settings(ctx.uuid)),
        );
        let server = ctx.mock_server(suite.mock_options(ctx.uuid));
        let create = server.queue(BrusnikaPayment.no_requisites_handler());
        await merchant
          .create_payment(common.p2pPaymentRequest("RUB", "card"))
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
        await create;
      }));
  });

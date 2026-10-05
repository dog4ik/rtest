import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import { JusanPayment } from "@/provider_mocks/jusan";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

function createJusanInstance(ctx: Context) {
  let uuid = crypto.randomUUID();
  let server = ctx.mock_server(JusanPayment.mock_params(uuid));
  let payment = new JusanPayment();
  return { uuid, settings: JusanPayment.settings(uuid), server, payment };
}

test
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("ecom settings test", ({ ctx, merchant }) =>
    ctx.track_bg_rejections(async () => {
      let jusan1 = createJusanInstance(ctx);
      let jusan2 = createJusanInstance(ctx);
      let jusan3 = createJusanInstance(ctx);
      await merchant.set_settings({
        USD: {
          gateways: {
            pay: {
              default: "jusan1",
            },
            payout: {
              default: "jusan1",
            },
          },
        },
        RUB: {
          gateways: {
            pay: {
              default: "jusan2",
            },
            payout: {
              default: "jusan2",
            },
          },
        },
        USDT: {
          gateways: {
            pay: {
              default: "jusan3",
            },
            payout: {
              default: "jusan3",
            },
          },
        },
        convert_to: "USDT",
        gateways: {
          allow_host2host: true,
          jusan1: jusan1.settings,
          jusan2: jusan2.settings,
          jusan3: jusan3.settings,
        },
        payout_providers_card: true,
      });
      let provider_request = jusan3.server.queue(
        jusan3.payment.create_response_handler("approved"),
      );
      await merchant.create_payment({
        ...common.paymentRequest("EUR"),
        card: common.cardObject(),
      });
      await provider_request;
    }),
  );

import * as brusnika from "@/provider_mocks/brusnika";
import * as gc from "@/provider_mocks/gateway_connect";
import { SettingsBuilder } from "@/settings_builder";

describe
  .runIf(CONFIG.in_project(["8pay"]))
  .concurrent("8pay providers settings", () => {
    test.concurrent("payout provider selects correct gateway", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let brusnika_suite = brusnika.payoutSuite("RUB");
        let gc_suite = gc.payoutSuite("RUB");
        let gc_mock = ctx.mock_server(gc_suite.mock_options(ctx.uuid));
        let brusnika_mock = ctx.mock_server(
          brusnika_suite.mock_options(ctx.uuid),
        );

        gc_mock.queue(gc_suite.gw.basic_payout_handler("pending"));

        brusnika_mock.queue(() => {
          assert.fail("brusnika should not be rearched");
        });

        let settings = new SettingsBuilder()
          .addP2P("RUB", "manypay", "manypay")
          .addP2P("RUB", "brusnika", "brusnika")
          .withGateway(gc_suite.settings(ctx.uuid), "manypay")
          .withGateway(brusnika_suite.settings(ctx.uuid), "brusnika")
          .build();
        await merchant.set_settings(settings);
        await merchant.cashin("RUB", common.amount / 100);

        let res = await merchant.create_payout({ ...gc_suite.request() });
        await res
          .followFirstProcessingUrl()
          .then((r) => r.as_payout_response());
      }));

    test.concurrent("payin provider selects correct gateway", ({
      ctx,
      merchant,
    }) =>
      ctx.track_bg_rejections(async () => {
        let brusnika_suite = brusnika.payoutSuite("RUB");
        let gc_suite = gc.payinSuite("RUB");
        let gc_mock = ctx.mock_server(gc_suite.mock_options(ctx.uuid));
        let brusnika_mock = ctx.mock_server(
          brusnika_suite.mock_options(ctx.uuid),
        );

        gc_mock.queue(gc_suite.gw.requisites_payin_handler("pending", "card"));

        brusnika_mock.queue(() => {
          assert.fail("brusnika should not be rearched");
        });

        let settings = new SettingsBuilder()
          .addP2P("RUB", "manypay", "manypay")
          .addP2P("RUB", "brusnika", "brusnika")
          .withGateway(gc_suite.settings(ctx.uuid), "manypay")
          .withGateway(brusnika_suite.settings(ctx.uuid), "brusnika")
          .build();
        await merchant.set_settings(settings);

        await merchant
          .create_payment({ ...gc_suite.request() })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_8pay_requisite());
      }));
  });

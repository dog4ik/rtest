import { JusanPayment } from "@/provider_mocks/jusan";
import * as common from "@/common";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";
import { CONFIG } from "@/config";

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

import * as common from "@/common";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { providers } from "@/settings_builder";
import { CONFIG, PROJECT, test } from "@/test_context";
import { assert } from "vitest";

const CURRENCY = "RUB";

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "expires_in setting",
    { timeout: 120_000 },
    async ({ brusnika, merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new BrusnikaPayment();
        let settings = providers(CURRENCY, {
          ...BrusnikaPayment.settings(ctx.uuid),
          pay_expired_minutes: 1,
        });
        await merchant.set_settings(settings);
        brusnika.queue(payment.create_handler("created"));
        brusnika.queue(payment.status_handler("in_progress"));
        brusnika.queue(payment.status_handler("in_progress"));
        brusnika.queue(payment.status_handler("in_progress"));

        if (PROJECT === "8pay") {
          await merchant
            .create_payment({
              ...common.paymentRequest(CURRENCY),
              extra_return_param: "Cards",
            })
            .then((p) => p.followFirstProcessingUrl())
            .then((u) => u.as_8pay_requisite());
        } else {
          await merchant
            .create_payment({
              ...common.paymentRequest(CURRENCY),
              bank_account: {
                requisite_type: "card",
              },
            })
            .then((p) => p.followFirstProcessingUrl())
            .then((u) => u.as_trader_requisites());
        }
        await merchant.queue_notification(
          (callback) => {
            assert.strictEqual(callback.status, "expired");
          },
          { skip_healthcheck: true },
        );
      }),
  );

import { delay } from "@std/async";
import { assert } from "vitest";
import * as common from "@/common";
import { CONFIG, PROJECT } from "@/config";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { GatewayConnectTransaction } from "@/provider_mocks/gateway_connect";
import { providers } from "@/settings_builder";
import { test } from "@/test_context";

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

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay"]))
  .concurrent(
    "expires_in setting (payout)",
    { timeout: 120_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        let settings = providers(CURRENCY, {
          ...payment.settings(ctx.uuid),
          payout_expired_minutes: 1,
        });
        await merchant.set_settings(settings);
        await merchant.cashin(CURRENCY, common.amount / 100);
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.basic_payout_handler("pending"));
        gw.queue(payment.status_handler("pending"));
        gw.queue(payment.status_handler("pending"));
        gw.queue(payment.status_handler("pending"));

        await merchant
          .create_payout(common.payoutRequest(CURRENCY))
          .then((p) => p.followFirstProcessingUrl())
          .then((u) => u.as_payout_response());

        await merchant.queue_notification(
          (callback) => {
            assert.strictEqual(callback.status, "expired");
          },
          { skip_healthcheck: true },
        );
      }),
  );

// 8pay runs business with EXPIRED_PAYOUT_DISABLED=true
test
  .runIf(CONFIG.in_project(["8pay"]))
  .concurrent(
    "expires_in setting does not expire payout",
    { timeout: 180_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        let settings = providers(CURRENCY, {
          ...payment.settings(ctx.uuid),
          payout_expired_minutes: 1,
        });
        await merchant.set_settings(settings);
        await merchant.cashin(CURRENCY, common.amount / 100);
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.basic_payout_handler("pending"));
        for (let i = 0; i < 5; i++) {
          gw.queue(payment.status_handler("pending"));
        }

        let notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `payout must not be finalized, got status ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        let payout = await merchant.create_payout(
          common.payoutRequest(CURRENCY),
        );
        await payout.followFirstProcessingUrl().then((u) => u.as_raw_json());
        let token = payout.token;

        // expire worker fires after 1 minute + 30 seconds
        await Promise.race([notification, delay(120_000)]);

        let business_payment = await ctx.get_payment(token);
        assert.notStrictEqual(business_payment.status, "expired");
        assert.strictEqual(business_payment.status, "pending");
      }),
  );

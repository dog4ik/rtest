import { CONFIG, PROJECT } from "@/config";
import * as common from "@/common";
import { GatewayConnectTransaction } from "@/provider_mocks/gateway_connect";
import { test } from "@/test_context";
import { assert } from "vitest";
import { delay } from "@std/async";

const CURRENCY = "RUB";

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "expires_in with concurrent approved status/notification",
    { timeout: 120_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        let settings = {
          USDT: {
            gateways: {
              pay: {
                providers: [
                  {
                    trader: "gateway",
                  },
                ],
              },
              payout: {
                providers: [
                  {
                    trader: "gateway",
                  },
                ],
              },
            },
          },
          convert_to: "USDT",
          gateways: {
            allow_host2host: true,
            gateway: {
              ...payment.settings(ctx.uuid),
              pay_expired_minutes: 1,
              masked_provider: true,
              enable_change_final_status: true,
              enable_update_amount: true,
            },
          },
          payout_providers_card: true,
        };
        await merchant.set_settings(settings);
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.requisites_payin_handler("pending", "card"));
        gw.queue(payment.status_handler("approved")).then(async () => {
          await payment.send_callback("approved");
        });
        gw.queue(payment.status_handler("approved"));
        gw.queue(payment.status_handler("approved"));

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
        let approved_notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "approved");
        });
        let another_notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Merchant should not get any more notifications, got: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await approved_notification;
        await Promise.race([delay(5_000), another_notification]);
      }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay"]))
  .concurrent(
    "expires_in with concurrent approved status/notification (payout)",
    { timeout: 120_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        let settings = {
          USDT: {
            gateways: {
              pay: {
                providers: [
                  {
                    trader: "gateway",
                  },
                ],
              },
              payout: {
                providers: [
                  {
                    trader: "gateway",
                  },
                ],
              },
            },
          },
          convert_to: "USDT",
          gateways: {
            allow_host2host: true,
            gateway: {
              ...payment.settings(ctx.uuid),
              pay_expired_minutes: 1,
              masked_provider: true,
              enable_change_final_status: true,
              enable_update_amount: true,
            },
          },
          payout_providers_card: true,
        };
        await merchant.cashin("USDT", common.amount / 100);
        await merchant.set_settings(settings);
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.basic_payout_handler("pending"));
        gw.queue(payment.status_handler("approved")).then(async () => {
          await payment.send_callback("approved");
        });
        gw.queue(payment.status_handler("approved"));
        gw.queue(payment.status_handler("approved"));

        await merchant
          .create_payout({
            ...common.payoutRequest(CURRENCY),
            bank_account: {
              requisite_type: "card",
            },
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((u) => u.as_payout_response());

        let approved_notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "approved");
        });
        let another_notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Merchant should not get any more notifications, got: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await approved_notification;
        await Promise.race([delay(5_000), another_notification]);
      }),
  );

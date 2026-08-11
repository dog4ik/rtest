import { delay } from "@std/async";
import { assert } from "vitest";
import * as common from "@/common";
import { CONFIG, PROJECT } from "@/config";
import { traderNoConvertSettings } from "@/driver/trader";
import * as default_provider from "@/provider_mocks/default";
import { GatewayConnectTransaction } from "@/provider_mocks/gateway_connect";
import { providers } from "@/settings_builder";
import { test } from "@/test_context";

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
          [CURRENCY]: {
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
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "concurrent approved callback & approved status",
    { timeout: 60_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        await merchant.set_settings(
          providers(CURRENCY, {
            ...payment.settings(ctx.uuid),
            enable_change_final_status: true,
          }),
        );
        await merchant.cashin(CURRENCY, 10);
        await merchant.cashout(CURRENCY, 10);
        await merchant.set_balance(CURRENCY, {
          hold: 9999999,
          available: 9999999,
        });
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.requisites_payin_handler("pending", "card"));
        // When the status checker polls and gets "approved", it races with the concurrent
        // callback that fires at the same moment via a different code path.
        gw.queue(payment.status_handler("approved")).then(async () => {
          await payment.send_callback("approved");
          await delay(100);
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
              bank_account: { requisite_type: "card" },
            })
            .then((p) => p.followFirstProcessingUrl())
            .then((u) => u.as_trader_requisites());
        }

        let approved_notification = merchant.queue_notification((callback) => {
          assert.notOk(
            callback.gatewayDetails?.decline_reason,
            "declination reason should be empty",
          );
          assert.strictEqual(callback.status, "approved");
        });
        let duplicate_notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Expected only one notification, got second: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await approved_notification;
        await Promise.race([delay(5_000), duplicate_notification]);
      }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "concurrent approved callback & pending status",
    { timeout: 60_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        await merchant.set_settings(
          providers(CURRENCY, {
            ...payment.settings(ctx.uuid),
            enable_change_final_status: true,
          }),
        );
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.requisites_payin_handler("pending", "card"));
        // When the status checker polls and gets "approved", it races with the concurrent
        // callback that fires at the same moment via a different code path.
        gw.queue(payment.status_handler("pending")).then(async () => {
          await payment.send_callback("approved");
        });

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
              bank_account: { requisite_type: "card" },
            })
            .then((p) => p.followFirstProcessingUrl())
            .then((u) => u.as_trader_requisites());
        }

        let approved_notification = merchant.queue_notification((callback) => {
          assert.notOk(
            callback.gatewayDetails?.decline_reason,
            "declination reason should be empty",
          );
          assert.strictEqual(callback.status, "approved");
        });
        let duplicate_notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Expected only one notification, got second: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await approved_notification;
        await Promise.race([delay(5_000), duplicate_notification]);
      }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "concurrent approved status & declined callback",
    { timeout: 60_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        await merchant.set_settings(
          providers(CURRENCY, {
            ...payment.settings(ctx.uuid),
            // Required so the decline attempt can reach the lock even if confirm wins first.
            enable_change_final_status: true,
          }),
        );
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.requisites_payin_handler("pending", "card"));
        gw.queue(payment.status_handler("approved")).then(async () => {
          await payment.send_callback("declined");
        });
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
              bank_account: { requisite_type: "card" },
            })
            .then((p) => p.followFirstProcessingUrl())
            .then((u) => u.as_trader_requisites());
        }

        let outcome_notification = merchant.queue_notification((callback) => {
          assert.ok(
            callback.status === "approved" || callback.status === "declined",
            `Expected approved or declined, got: ${callback.status}`,
          );
        });
        let duplicate_notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Expected only one outcome, got second notification: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await outcome_notification;
        await Promise.race([delay(5_000), duplicate_notification]);
      }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay"]))
  .concurrent(
    "approved callback and status processed only once (payout)",
    { timeout: 60_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        await merchant.set_settings({
          ...providers(CURRENCY, {
            ...payment.settings(ctx.uuid),
            enable_change_final_status: true,
          }),
          payout_providers_card: true,
        });
        await merchant.cashin(CURRENCY, common.amount / 100);
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
            bank_account: { requisite_type: "card" },
          })
          .then((p) => p.followFirstProcessingUrl())
          .then((u) => u.as_payout_response());

        let approved_notification = merchant.queue_notification((callback) => {
          assert.strictEqual(callback.status, "approved");
        });
        let duplicate_notification = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Expected only one notification, got second: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await approved_notification;
        await Promise.race([delay(5_000), duplicate_notification]);
      }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "double core manage decline",
    { timeout: 60_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        await merchant.set_settings(
          providers(CURRENCY, {
            ...payment.settings(ctx.uuid),
            enable_change_final_status: true,
          }),
        );
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.requisites_payin_handler("pending", "card"));
        gw.queue(payment.status_handler("approved"));

        let payment_response: Awaited<
          ReturnType<typeof merchant.create_payment>
        >;
        if (PROJECT === "8pay") {
          payment_response = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          });
          await payment_response
            .followFirstProcessingUrl()
            .then((u) => u.as_8pay_requisite());
        } else {
          payment_response = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            bank_account: { requisite_type: "card" },
          });
          await payment_response
            .followFirstProcessingUrl()
            .then((u) => u.as_trader_requisites());
        }

        let approved_notification = merchant.queue_notification(
          (callback) => {
            assert.strictEqual(callback.status, "approved");
          },
          { expect: { status: 1 } },
        );
        await payment.send_callback("approved");
        await approved_notification;

        let feed = await ctx.get_feed(payment_response.token);

        let declined_notification = merchant.queue_notification(
          (callback) => {
            assert.strictEqual(callback.status, "declined");
          },
          { expect: { status: 2 } },
        );
        let duplicate_declined = merchant.queue_notification(
          (callback) => {
            assert.fail(
              `Expected only one reversal notification, got second: ${callback.status}`,
            );
          },
          { skip_healthcheck: true },
        );

        await delay(2_000);

        let core = ctx.shared_state().core_harness;
        // Intentionally ignore 500
        await Promise.allSettled([
          core.change_status(feed.id, "declined"),
          core.change_status(feed.id, "declined"),
        ]);

        await declined_notification;
        await Promise.race([delay(5_000), duplicate_declined]);
      }),
  );

test
  .runIf(CONFIG.in_project(["reactivepay", "spinpay", "8pay"]))
  .concurrent(
    "concurrent callbacks with mixed statuses and amounts leave payment in consistent state",
    { timeout: 60_000 },
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let payment = new GatewayConnectTransaction("manypay", {});
        await merchant.set_settings(
          providers(CURRENCY, {
            ...payment.settings(ctx.uuid),
            enable_change_final_status: true,
            enable_update_amount: true,
          }),
        );
        let gw = ctx.mock_server(payment.mock_params(ctx.uuid));
        gw.queue(payment.requisites_payin_handler("pending", "card"));
        gw.queue(payment.status_handler("approved"));
        gw.queue(payment.status_handler("approved"));
        gw.queue(payment.status_handler("approved"));

        let payment_response: Awaited<
          ReturnType<typeof merchant.create_payment>
        >;
        if (PROJECT === "8pay") {
          payment_response = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            extra_return_param: "Cards",
          });
          await payment_response
            .followFirstProcessingUrl()
            .then((u) => u.as_8pay_requisite());
        } else {
          payment_response = await merchant.create_payment({
            ...common.paymentRequest(CURRENCY),
            bank_account: { requisite_type: "card" },
          });
          await payment_response
            .followFirstProcessingUrl()
            .then((u) => u.as_trader_requisites());
        }

        let outcome_notification = merchant.queue_notification((callback) => {
          assert.ok(
            callback.status === "approved" || callback.status === "declined",
            `Expected approved or declined, got: ${callback.status}`,
          );
        });

        const spam: [status: "approved" | "declined", amount: number][] = [
          ["approved", common.amount],
          ["declined", common.amount + 1000],
          ["approved", common.amount - 500],
          ["declined", common.amount * 2],
          ["approved", common.amount],
        ];
        await Promise.allSettled(
          spam.map(async ([status, amount], i) => {
            await delay(i * 100);
            await payment.send_callback(status, amount);
          }),
        );

        await outcome_notification;
        await ctx.healthcheck(payment_response.token);
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

test.concurrent("concurrent requests create currency wallet once (default)", async ({
  merchant,
  ctx,
}) =>
  ctx.track_bg_rejections(async () => {
    await merchant.set_settings(default_provider.fullSettings("RUB"));
    await Promise.all([
      merchant.create_payment(
        default_provider.request("RUB", common.amount, "pay", true),
      ),
      merchant.create_payment(
        default_provider.request("RUB", common.amount, "pay", true),
      ),
    ]);
    let wallets = await merchant.wallets();
    assert.lengthOf(wallets, 1, "only one wallet should be created");
  }));

test
  .runIf(CONFIG.in_project(["a2", "reactivepay"]))
  .only(
    "concurrent requests create currency wallet once (trader)",
    async ({ merchant, ctx }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader({ usdt: false });
        await trader.cashin("main", "RUB", 999999999999);
        await trader.setup({ card: true, bank: "sberbank" });
        await merchant.set_settings(
          traderNoConvertSettings("RUB", [trader.id]),
        );
        let payments = await Promise.all(
          [...Array(6)].map((_, i) =>
            merchant.create_payment({
              ...common.p2pPaymentRequest("RUB", "card"),
              amount: common.amount + i,
            }),
          ),
        );
        let requisites = await Promise.all(
          payments.map((p) =>
            p.followFirstProcessingUrl().then((r) => r.as_trader_requisites()),
          ),
        );
        await Promise.all(
          requisites.map((p) =>
            trader.finalizeTransaction(p.token, "approved"),
          ),
        );

        await delay(1_000);

        let wallets = await merchant.wallets();
        assert.lengthOf(wallets, 1, "only one wallet should be created");
      }),
  );

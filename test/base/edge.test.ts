import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import * as common from "@/common";
import { defaultSettings, providers } from "@/settings_builder";
import * as default_gateway from "@/provider_mocks/default";
import { test } from "@/test_context";
import { delay } from "@std/async";
import { assert } from "vitest";
import { CONFIG } from "@/config";
import { payinSuite, RoyalpayPayment } from "@/provider_mocks/royalpay";

test.concurrent(
  "payin insufficient balance p2p",
  { timeout: 20_000 },
  async ({ ctx, merchant, brusnika: _, onTestFailed }) => {
    onTestFailed(async (ctx) => {
      await ctx.annotate(
        "This test can fail if required commission definitions are missing",
      );
    });
    await ctx.track_bg_rejections(async () => {
      await merchant.set_settings(
        providers("RUB", BrusnikaPayment.settings(ctx.uuid)),
      );
      await merchant.set_commission({
        self_fee: "10000",
        operation: "PayinRequest",
      });
      let res = await merchant.create_payment(common.paymentRequest("RUB"));
      let notification = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "approved");
      });
      console.log(
        await res
          .followFirstProcessingUrl()
          .then((r) => r.as_trader_requisites()),
      );
      await notification;
    });
  },
);

test.concurrent(
  "payin insufficient balance default",
  async ({ ctx, merchant, onTestFailed }) => {
    await ctx.track_bg_rejections(async () => {
      onTestFailed(async (ctx) => {
        await ctx.annotate(
          "This test can fail if required commission definitions are missing",
        );
      });
      await merchant.set_settings(default_gateway.fullSettings("RUB"));
      await merchant.set_commission({
        self_fee: "10000",
        operation: "PayinRequest",
      });
      let notification = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "declined");
      });
      await merchant.create_payment(
        default_gateway.request("RUB", 1000, "pay", true),
      );
      await notification;
    });
  },
);

test.concurrent("refund on empty wallet", async ({ ctx, merchant }) => {
  await ctx.track_bg_rejections(async () => {
    await merchant.set_settings(default_gateway.fullSettings("RUB"));
    let notification = merchant.queue_notification((notification) => {
      assert.strictEqual(notification.status, "approved");
    });
    merchant.queue_notification((notification) => {
      assert.strictEqual(notification.status, "approved");
    });
    let res = await merchant.create_payment(
      default_gateway.request("RUB", common.amount, "pay", true),
    );
    await merchant.cashout("RUB", common.amount / 100);
    let err = await merchant.create_refund_err({
      token: res.token,
      amount: common.amount,
    });

    err.as_common_error().assert_error([{ code: "amount_no_money" }]);
    let w = (await merchant.wallets())[0];
    assert.strictEqual(w.currency, "RUB");
    assert.strictEqual(w.available, 0);
    assert.strictEqual(w.held, 0);

    await notification;
  });
});

test.concurrent(
  "refund on unsupported gateway",
  async ({ ctx, merchant, brusnika }) => {
    await ctx.track_bg_rejections(async () => {
      await merchant.set_settings(
        providers("RUB", BrusnikaPayment.settings(ctx.uuid)),
      );
      let payment = new BrusnikaPayment();
      brusnika
        .queue(payment.create_handler("in_progress"))
        .then(() => delay(11_000))
        .then(() => payment.send_callback("success"));
      let notification = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "approved");
      });
      let res = await merchant.create_payment(
        default_gateway.request("RUB", common.amount, "pay", true),
      );
      await res.followFirstProcessingUrl();
      await notification;

      let refund_notification = merchant.queue_notification((c) => {
        assert.strictEqual(c.type, "refund");
        assert.strictEqual(c.status, "declined");
      });

      let err = await merchant.create_refund_err({
        token: res.token,
        amount: common.amount,
      });
      err.as_common_error().assert_error([{ code: "amount_no_money" }]);

      await refund_notification;

      let w = (await merchant.wallets())[0];
      assert.strictEqual(w.currency, "RUB");
      assert.strictEqual(w.available, 0);
      assert.strictEqual(w.held, 0);
    });
  },
);

test.concurrent(
  "refund with no balance for commission",
  async ({ ctx, merchant }) => {
    await ctx.track_bg_rejections(async () => {
      await merchant.set_settings(default_gateway.fullSettings("RUB"));
      let notification = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "approved");
      });

      const FEE = 10;
      await merchant.set_commission({
        self_fee: FEE.toString(),
        status: "1",
        operation: "RefundRequest",
      });
      merchant.queue_notification((notification) => {
        assert.strictEqual(notification.status, "approved");
      });
      let res = await merchant.create_payment(
        default_gateway.request("RUB", common.amount, "pay", true),
      );
      await merchant.create_refund_err({
        token: res.token,
        amount: common.amount,
      });

      let w = (await merchant.wallets())[0];
      assert.strictEqual(w.currency, "RUB");
      assert.strictEqual(w.available, common.amount / 100);
      assert.strictEqual(w.held, 0);

      await notification;
    });
  },
);

test
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent(
    "pending refund holds highest of 2 commission rules (royalpay)",
    { timeout: 120_000 },
    async ({ ctx, merchant }) => {
      await ctx.track_bg_rejections(async () => {
        let royalpay = ctx.mock_server(RoyalpayPayment.mock_params(ctx.uuid));
        let suite = payinSuite("EUR");
        let payment = new RoyalpayPayment();
        await merchant.set_settings(
          defaultSettings("EUR", RoyalpayPayment.settings(ctx.uuid)),
        );

        ctx.annotate(`MID: ${merchant.id}`);

        let transaction_notification = merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.status, "approved");
          },
        );
        royalpay
          .queue(payment.create_handler())
          .then(() => payment.send_callback("ok", ctx.uuid));

        const FEE = 10;
        let commission_amount_double_fee = (common.amount / 100) * ((FEE / 100) * 2);
        let commission_amount_fee = (common.amount / 100) * (FEE / 100);
        console.log({ commission_amount: commission_amount_double_fee });
        await merchant.cashin("EUR", commission_amount_double_fee);
        await Promise.all([
          merchant.set_commission({
            self_rate: FEE.toString(),
            status: "1",
            operation: "RefundRequest",
          }),
          merchant.set_commission({
            self_rate: (FEE * 2).toString(),
            status: "2",
            operation: "RefundRequest",
          }),
        ]);
        let res = await merchant.create_payment(suite.request());
        await transaction_notification;

        let transaction_refunded = merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "pay");
            assert.strictEqual(notification.status, "refunded");
          },
        );

        let refund_approved = merchant.queue_notification((notification) => {
          assert.strictEqual(notification.type, "refund");
          assert.strictEqual(notification.status, "approved");
        });

        royalpay
          .queue(payment.create_refund_handler("pending"))
          .then(async () => {
            await delay(5_000);
            return payment.send_refund_callback("ok", ctx.uuid);
          });

        await merchant.create_refund({
          token: res.token,
        });

        let wallet = (await merchant.wallets())[0];
        assert.strictEqual(wallet.currency, "EUR");
        assert.strictEqual(wallet.available, 0, "available should be 0");
        assert.strictEqual(
          wallet.held,
          common.amount / 100 + commission_amount_double_fee,
          "held should be amount + commission",
        );

        await transaction_refunded;
        await refund_approved;

        let w = (await merchant.wallets())[0];
        assert.strictEqual(w.currency, "EUR");
        assert.strictEqual(
          w.available,
          commission_amount_fee,
          "available should be empty after successful refund",
        );
        assert.strictEqual(
          w.held,
          0,
          "held should be empty afetr secusseful refund",
        );
      });
    },
  );

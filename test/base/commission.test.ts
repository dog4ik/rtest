import * as default_provider from "@/provider_mocks/default";
import * as common from "@/common";
import { assert, describe } from "vitest";
import { CONFIG, test } from "@/test_context";

const CURRENCY = "RUB";
let AMOUNT = 100 * 1000;

describe.concurrent("basic commission", () => {
  test.concurrent(
    "successful payment with commission",
    async ({ ctx, onTestFailed }) => {
      onTestFailed(async (ctx) => {
        await ctx.annotate(
          "This test can fail if required commission definitions are missing",
        );
      });

      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(default_provider.fullSettings(CURRENCY));
      await merchant.set_commission({
        operation: "PayinRequest",
        currency: CURRENCY,
        status: "1",
      });
      await merchant.create_payment(
        default_provider.request(CURRENCY, AMOUNT, "pay", true),
      );
      let wallet = (await merchant.wallets())[0];
      assert(wallet.currency == CURRENCY, "created wallet should be in RUB");
      assert(wallet.available == (AMOUNT * 0.9) / 100, "merhant wallet amount");
    },
  );
});

describe
  .skipIf(CONFIG.project !== "reactivepay")
  .concurrent("refund commission", () => {
    test.concurrent("Refund commission", async ({ ctx }) => {
      let merchant = await ctx.create_random_merchant();
      await merchant.set_settings(default_provider.fullSettings("RUB"));
      await merchant.cashin("RUB", (common.amount / 100) * 0.1);
      await merchant.set_commission({
        operation: "RefundRequest",
        currency: "RUB",
      });

      // merchant should get 3 notifications
      let approveNotifiaction = merchant.queue_notification((n) => {
        assert.strictEqual(n.status, "approved");
      });
      let refundNotification = merchant.queue_notification(
        (n) => {
          assert.strictEqual(n.status, "refunded");
        },
        { skip_healthcheck: true },
      );
      let refundApprovedNotificication = merchant.queue_notification(
        (n) => {
          assert.strictEqual(n.status, "approved");
          assert.strictEqual(n.type, "refund");
        },
        { skip_healthcheck: true },
      );

      let res = await merchant.create_payment(
        default_provider.request("RUB", common.amount, "pay", true),
      );
      assert.strictEqual(res.payment.status, "approved");

      let refundRes = await merchant.create_refund({ token: res.token });
      let originalFeed = await ctx.get_feed(res.token);
      assert.strictEqual(originalFeed.status, 4);
      assert.strictEqual(originalFeed.commission_amount, 0);
      let refundFeed = await ctx.get_feed(refundRes.refund.token);
      assert.strictEqual(refundFeed.type, "RefundRequest");
      assert.strictEqual(refundFeed.status, 1);
      console.log(refundRes);

      await approveNotifiaction;
      await refundNotification;
      await refundApprovedNotificication;
    });
  });

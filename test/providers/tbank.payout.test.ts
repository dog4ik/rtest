import { assert, describe } from "vitest";
import * as common from "@/common";
import { defaultSettings } from "@/settings_builder";
import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import { TbankPayout } from "@/provider_mocks/tbank";
import type { Context } from "@/test_context/context";

const CURRENCY = "RUB";

async function setupMerchant(ctx: Context) {
  let uuid = crypto.randomUUID();
  let merchant = await ctx.create_random_merchant();
  let settings = defaultSettings(CURRENCY, TbankPayout.settings(uuid));
  settings.gateways["skip_card_payout_validation"] = true;
  await merchant.set_settings(settings);
  let tbank = ctx.mock_server(TbankPayout.mock_params(uuid));
  let payment = new TbankPayout();
  await merchant.cashin(CURRENCY, common.amount / 100);
  return { merchant, tbank, payment, uuid };
}

describe
  .runIf(CONFIG.project === "reactivepay" || PROJECT === "paygateway")
  .concurrent("pcidss tbank gateway", () => {
    describe.concurrent("tbank card", () => {
      const customer = {
        email: "test@email.com",
        // phone: "+898989898",
        ip: "8.8.8.8",
      };

      const card = {
        pan: common.visaCard,
        expires: common.cardObject().expires,
      };

      test.concurrent(
        "tbank approved status",
        { timeout: 90_000 },
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.init_card_handler());
            tbank.queue(payment.payout_card_handler("pending"));
            tbank.queue(payment.remove_card_handler());
            tbank.queue(payment.status_handler("approved"));

            let notification = merchant.queue_notification(
              async (notification) => {
                assert.strictEqual(
                  notification.status,
                  "approved",
                  "merchant notification status",
                );
              },
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");

            await notification;
          });
        },
      );

      test.concurrent(
        "tbank declined status",
        { timeout: 90_000 },
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.init_card_handler());
            tbank.queue(payment.payout_card_handler("pending"));
            tbank.queue(payment.remove_card_handler());
            tbank.queue(payment.status_handler("declined"));

            let notification = merchant.queue_notification(
              async (notification) => {
                assert.strictEqual(
                  notification.status,
                  "declined",
                  "merchant notification status",
                );
              },
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");

            await notification;
          });
        },
      );

      test.concurrent("tbank card payout pending if 500", async ({ ctx }) => {
        await ctx.track_bg_rejections(async () => {
          let { merchant, tbank, payment } = await setupMerchant(ctx);
          tbank.queue(payment.check_customer_handler());
          tbank.queue(payment.add_customer_handler());
          tbank.queue(payment.add_card_handler());
          tbank.queue(payment.attach_card_handler());
          tbank.queue(payment.init_card_handler());
          tbank.queue(common.nginx500);
          let result = await merchant.create_payout({
            ...common.payoutRequest(CURRENCY),
            card,
            customer,
          });
          let business_payment = await ctx.get_payment(result.token);
          assert.strictEqual(business_payment.status, "pending");
          await ctx.healthcheck(result.token);
        });
      });

      test.concurrent(
        "tbank card status pending if status unkown error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.init_card_handler());
            tbank.queue(payment.payout_card_handler("pending"));
            tbank.queue(payment.remove_card_handler());
            let gateway_status = tbank.queue(
              payment.custom_error_handler(8008, "bad thing happened"),
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            await gateway_status;
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank card payout pending if unkown error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.init_card_handler());
            tbank.queue(
              payment.custom_error_handler(8008, "unknown error happened"),
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank card get_customer pending if unkown error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.init_card_handler());
            tbank.queue(
              payment.custom_error_handler(8008, "unknown error happened"),
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );
      test.concurrent(
        "tbank card payout pending if known error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.init_card_handler());
            tbank.queue(payment.invalid_params_handler());
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank card add_customer declined if known error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.shop_blocked_error_handler());
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "declined");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank card init pending if unkown error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(
              payment.custom_error_handler(8008, "unknown error happened"),
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank card init declines if shop is blocked",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.add_card_handler());
            tbank.queue(payment.attach_card_handler());
            tbank.queue(payment.shop_blocked_error_handler());
            //tbank.queue(payment.init_card_handler());

            let notification = merchant.queue_notification(
              async (notification) => {
                assert.strictEqual(
                  notification.status,
                  "declined",
                  "merchant notification status",
                );
              },
            );

            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              card,
              customer,
            });
            assert.strictEqual(result.payout?.status, "declined");
            await notification;
          });
        },
      );
    });

    describe.concurrent("tbank sbp", () => {
      const customer = {
        email: "test@email.com",
        phone: "+898989898",
        ip: "8.8.8.8",
      };

      test.concurrent(
        "tbank approved status",
        { timeout: 90_000 },
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.get_sbp_members_handler());
            tbank.queue(payment.init_sbp_handler());
            tbank.queue(payment.payout_sbp_handler("pending"));
            tbank.queue(payment.status_handler("approved"));

            let notification = merchant.queue_notification(
              async (notification) => {
                assert.strictEqual(
                  notification.status,
                  "approved",
                  "merchant notification status",
                );
              },
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              extra_return_param: "NK Bank",
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");

            await notification;
          });
        },
      );

      test.concurrent(
        "tbank declined status",
        { timeout: 90_000 },
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.get_sbp_members_handler());
            tbank.queue(payment.init_sbp_handler());
            tbank.queue(payment.payout_sbp_handler("pending"));
            tbank.queue(payment.status_handler("declined"));

            let notification = merchant.queue_notification(
              async (notification) => {
                assert.strictEqual(
                  notification.status,
                  "declined",
                  "merchant notification status",
                );
              },
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              extra_return_param: "NK Bank",
              customer,
            });
            assert.strictEqual(result.payout?.status, "pending");

            await notification;
          });
        },
      );

      test.concurrent(
        "tbank sbp init declines if invalid params",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.get_sbp_members_handler());
            tbank.queue(payment.invalid_params_handler());

            let notification = merchant.queue_notification(
              async (notification) => {
                assert.strictEqual(
                  notification.status,
                  "declined",
                  "merchant notification status",
                );
              },
            );

            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              customer,
              extra_return_param: "NK Bank",
            });
            assert.strictEqual(result.payout?.status, "declined");
            await notification;
          });
        },
      );

      test.concurrent(
        "tbank sbp init pending if unkown error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.get_sbp_members_handler());
            tbank.queue(
              payment.custom_error_handler(8008, "unknown error happened"),
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              customer,
              extra_return_param: "NK Bank",
            });
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank sbp payout pending if unkown error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.get_sbp_members_handler());
            tbank.queue(payment.init_sbp_handler());
            tbank.queue(
              payment.custom_error_handler(8008, "unknown error happened"),
            );
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              customer,
              extra_return_param: "NK Bank",
            });
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );

      test.concurrent(
        "tbank sbp payout pending if known error",
        async ({ ctx }) => {
          await ctx.track_bg_rejections(async () => {
            let { merchant, tbank, payment } = await setupMerchant(ctx);
            tbank.queue(payment.check_customer_handler());
            tbank.queue(payment.add_customer_handler());
            tbank.queue(payment.get_sbp_members_handler());
            tbank.queue(payment.init_sbp_handler());
            tbank.queue(payment.invalid_params_handler());
            let result = await merchant.create_payout({
              ...common.payoutRequest(CURRENCY),
              customer,
              extra_return_param: "NK Bank",
            });
            let business_payment = await ctx.get_payment(result.token);
            assert.strictEqual(business_payment.status, "pending");
            await ctx.healthcheck(result.token);
          });
        },
      );
    });
  });

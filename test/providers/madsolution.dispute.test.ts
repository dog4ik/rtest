import { assert, describe } from "vitest";
import * as common from "@/common";
import * as assets from "@/assets";
import { MadsolutionPayment } from "@/provider_mocks/madsolution";
import { providers, type CommonSettingsParams } from "@/settings_builder";
import { PROJECT } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";
import type { Context } from "@/test_context/context";
import type { ExtendedMerchant } from "@/entities/merchant";
import { CALLBACK_DELAY } from "@/suite_interfaces";

const CURRENCY = "RUB";

async function setupTransaction(
  ctx: Context,
  success: boolean,
  extra_settings?: CommonSettingsParams,
) {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(
    providers(CURRENCY, {
      ...MadsolutionPayment.settings(ctx.uuid),
      ...extra_settings,
    }),
  );
  let payment = new MadsolutionPayment();
  let madsolution = ctx.mock_server(MadsolutionPayment.mock_params(ctx.uuid));

  madsolution.queue(payment.create_handler("PENDING")).then(async () => {
    await delay(CALLBACK_DELAY);
    await payment.send_callback(success ? "CONFIRMED" : "CANCELED");
  });

  let merchant_notification = merchant.queue_notification((notification) => {
    assert.strictEqual(notification.type, "pay");
    assert.strictEqual(notification.status, success ? "approved" : "declined");
  });

  let init_response = await merchant.create_payment({
    ...common.paymentRequest(CURRENCY),
    extra_return_param: "SBP",
  });
  await init_response
    .followFirstProcessingUrl()
    .then((p) => p.as_8pay_requisite());

  await merchant_notification;
  return { payment, madsolution, merchant, init_response };
}

async function setupFailedTransaction(ctx: Context) {
  return await setupTransaction(ctx, false);
}

async function setupSuccessfulTransaction(ctx: Context) {
  return await setupTransaction(ctx, true);
}

function queueDisputeNotifiactions(
  merchant: ExtendedMerchant,
  success: boolean,
) {
  return [
    merchant.queue_notification((notification) => {
      assert.strictEqual(notification.type, "dispute");
      assert.strictEqual(notification.status, "pending");
    }),
    merchant.queue_notification((notification) => {
      assert.strictEqual(notification.type, "dispute");
      assert.strictEqual(
        notification.status,
        success ? "approved" : "declined",
      );
    }),
  ];
}

describe.runIf(PROJECT === "8pay").concurrent("madsolution disputes", () => {
  test.concurrent(
    "madsolution dispute status finalization to approved",
    { timeout: 90_000 },
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);
        madsolution.queue(payment.create_dispute_handler());
        madsolution.queue(payment.dispute_status_handler("APPROVED"));

        let notifications = queueDisputeNotifiactions(merchant, true);

        await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });

        await Promise.all(notifications);
        await merchant
          .wallets()
          .then((v) => v.find((v) => v.currency === CURRENCY))
          .then((v) => assert.strictEqual(v?.available, common.amount / 100));
      }),
  );

  test.concurrent(
    "madsolution dispute status finalization to declined",
    { timeout: 90_000 },
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);
        madsolution.queue(payment.create_dispute_handler());
        madsolution.queue(payment.dispute_status_handler("REJECTED"));

        let notifications = queueDisputeNotifiactions(merchant, false);

        await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });

        await Promise.all(notifications);
      }),
  );

  test.concurrent(
    "madsolution dispute callback finalization to declined",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);

        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("REJECTED");
          });

        let notifications = queueDisputeNotifiactions(merchant, false);

        let res = await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });
        assert.strictEqual(
          res.status,
          "declined",
          "original transaction status",
        );

        await dispute_creation;

        await Promise.all(notifications);
        await merchant
          .wallets()
          .then((v) => v.find((v) => v.currency === CURRENCY))
          .then((v) => assert.strictEqual(v?.available, 0));
      }),
  );

  test.concurrent(
    "madsolution dispute callback finalization to approved",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);

        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("APPROVED");
          });

        let notifications = queueDisputeNotifiactions(merchant, true);

        let res = await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });
        assert.strictEqual(
          res.status,
          "declined",
          "original transaction status",
        );

        await dispute_creation;

        await Promise.all(notifications);
        await merchant
          .wallets()
          .then((v) => v.find((v) => v.currency === CURRENCY))
          .then((v) => assert.strictEqual(v?.available, common.amount / 100));
      }),
  );

  test.concurrent(
    "madsolution dispute changed amount finalization to approved",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);

        let new_amount = 654321;
        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("APPROVED");
          });

        let notifications = queueDisputeNotifiactions(merchant, true);

        let res = await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          amount: new_amount,
          description: "test dispute description",
        });
        assert.strictEqual(
          res.status,
          "declined",
          "original transaction status",
        );

        await dispute_creation;

        await Promise.all(notifications);
        let wallet = await merchant
          .wallets()
          .then((v) => v.find((v) => v.currency === CURRENCY));
        assert.strictEqual(wallet?.available, new_amount / 100);
      }),
  );

  test.concurrent(
    "madsolution dispute should not be created on successful transaction",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, merchant } = await setupSuccessfulTransaction(ctx);

        let err = await merchant.create_dispute_err({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });

        err.assert_error([
          {
            code: "invalid_payment_status",
            kind: "processing_error",
          },
        ]);
      }),
  );

  test.concurrent(
    "madsolution concurrent duplicate disputes should not be created",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);

        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("APPROVED", 654321);
          });
        let notifications = queueDisputeNotifiactions(merchant, true);

        let res = await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });
        assert.strictEqual(
          res.status,
          "declined",
          "original transaction status",
        );

        let secondRes = await merchant.create_dispute_err({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });
        secondRes.assert_error([
          { code: "payment_already_has_pending_dispute", kind: "" },
        ]);

        await dispute_creation;

        await Promise.all(notifications);
      }),
  );

  test.concurrent(
    "madsolution new dispute after approved should not be created",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);

        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("APPROVED", 654321);
          });
        let notifications = queueDisputeNotifiactions(merchant, true);

        let res = await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });
        assert.strictEqual(
          res.status,
          "declined",
          "original transaction status",
        );
        await dispute_creation;
        await Promise.all(notifications);

        let secondRes = await merchant.create_dispute_err({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });

        secondRes.assert_error([
          { code: "payment_already_has_accepted_dispute", kind: "" },
        ]);
      }),
  );

  test.concurrent("madsolution dispute commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { init_response, madsolution, merchant, payment } =
        await setupFailedTransaction(ctx);

      let commission_percent = 10;

      await merchant.set_commission({
        operation: "DisputeRequest",
        source: "madsolution",
        status: "1",
        self_rate: commission_percent.toString(),
      });

      let dispute_creation = madsolution
        .queue(payment.create_dispute_handler())
        .then(async () => {
          await delay(CALLBACK_DELAY);
          console.log("Sending dispute callback");
          await payment.send_dispute_callback("APPROVED");
        });

      let notifications = queueDisputeNotifiactions(merchant, true);

      let res = await merchant.create_dispute({
        token: init_response.token,
        file_path: assets.PngImgPath,
        description: "test dispute description",
      });
      assert.strictEqual(res.status, "declined", "original transaction status");

      await dispute_creation;
      await Promise.all(notifications);
      let wallet = await merchant
        .wallets()
        .then((v) => v.find((v) => v.currency === CURRENCY));

      assert.strictEqual(wallet?.available, (common.amount * 0.9) / 100);
    }),
  );

  test.concurrent(
    "madsolution status should not change after successful dispute",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { merchant, madsolution, payment, init_response } =
          await setupTransaction(ctx, false, {
            enable_change_final_status: true,
            enable_update_amount: true,
          });

        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("APPROVED");
          });

        let notifications = queueDisputeNotifiactions(merchant, true);

        await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });

        await dispute_creation;
        await Promise.all(notifications);

        let approved_notification = merchant.queue_notification((cb) => {
          assert.fail(
            `Merchant should not get any more notifications, got ${cb.type}`,
          );
        });
        await payment.send_callback("CONFIRMED");

        // Wait to ensure notification is not sent
        await Promise.race([delay(5_000), approved_notification]);
        let wallet = await merchant
          .wallets()
          .then((v) => v.find((v) => v.currency === CURRENCY));

        assert.strictEqual(wallet?.available, common.amount / 100);
      }),
  );

  test.concurrent(
    "madsolution status should not change if have pending dispute",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { merchant, madsolution, payment, init_response } =
          await setupTransaction(ctx, false, {
            enable_change_final_status: true,
            enable_update_amount: true,
          });

        let dispute_creation = madsolution.queue(
          payment.create_dispute_handler(),
        );

        merchant.queue_notification((notifiaction) => {
          assert.strictEqual(notifiaction.type, "dispute");
          assert.strictEqual(notifiaction.status, "pending");
        });
        await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });
        let dispute_approve = merchant.queue_notification((notification) => {
          assert.strictEqual(
            notification.type,
            "dispute",
            "merhant should get dispute notification, not updated transaction status",
          );
          assert.strictEqual(notification.status, "approved");
        });
        await payment.send_callback("CONFIRMED");

        await dispute_creation;
        await payment.send_dispute_callback("APPROVED");
        await dispute_approve;

        let wallet = await merchant
          .wallets()
          .then((v) => v.find((v) => v.currency === CURRENCY));

        assert.strictEqual(wallet?.available, common.amount / 100);
      }),
  );

  test.concurrent(
    "madsolution dispute double callback / merchant notification",
    ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { init_response, madsolution, merchant, payment } =
          await setupFailedTransaction(ctx);

        let dispute_creation = madsolution
          .queue(payment.create_dispute_handler())
          .then(async () => {
            await delay(CALLBACK_DELAY);
            console.log("Sending dispute callback");
            await payment.send_dispute_callback("REJECTED");
            await delay(CALLBACK_DELAY);
            await payment.send_dispute_callback("APPROVED");
          });

        let notifications = queueDisputeNotifiactions(merchant, false);
        await merchant.create_dispute({
          token: init_response.token,
          file_path: assets.PngImgPath,
          description: "test dispute description",
        });

        await dispute_creation;

        await Promise.all(notifications);
        let dispute_approve = merchant.queue_notification((cb) => {
          assert.fail(
            `Merchant should not get second dispute update notification, got ${cb.type}`,
          );
        });
        await Promise.race([delay(5_000), dispute_approve]);
      }),
  );

  test.skip("prompt dispute", { timeout: 120_000 }, ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { madsolution, merchant, payment } =
        await setupFailedTransaction(ctx);

      let dispute_creation = madsolution.queue(
        payment.create_dispute_handler(),
      );
      let create = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.type, "dispute");
        assert.strictEqual(notification.status, "pending");
      });
      let approve = merchant.queue_notification((notification) => {
        assert.strictEqual(notification.type, "dispute");
        assert.strictEqual(notification.status, "approved");
      });
      await create.then(async () => {
        await delay(7_000);
        await payment.send_dispute_callback("APPROVED");
      });

      await dispute_creation;

      await approve;
    }),
  );
});

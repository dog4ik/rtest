import { assert } from "vitest";
import * as common from "@/common";
import * as assets from "@/assets";
import { MadsolutionPayment } from "@/provider_mocks/madsolution";
import { providers, type CommonSettingsParams } from "@/settings_builder";
import { test } from "@/test_context";
import { delay } from "@std/async";
import type { Context } from "@/test_context/context";
import type { ExtendedMerchant } from "@/entities/merchant";

const CURRENCY = "RUB";
const CALLBACK_DELAY = 5_000;

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

test.concurrent(
  "madsolution dispute status finalization to approved",
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
    }),
);

test.concurrent(
  "madsolution dispute status finalization to declined",
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
      assert.strictEqual(res.status, "declined", "original transaction status");

      await dispute_creation;

      await Promise.all(notifications);
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
      assert.strictEqual(res.status, "declined", "original transaction status");

      await dispute_creation;

      await Promise.all(notifications);
    }),
);

test.concurrent(
  "madsolution dispute should not be created on successful transaction",
  ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      let { init_response, madsolution, merchant, payment } =
        await setupSuccessfulTransaction(ctx);

      let dispute_creation = madsolution
        .queue(payment.create_dispute_handler())
        .then(async () => {
          await delay(CALLBACK_DELAY);
          console.log("Sending dispute callback");
          await payment.send_dispute_callback("APPROVED", 654321);
        });

      await merchant.create_dispute_err({
        token: init_response.token,
        file_path: assets.PngImgPath,
        description: "test dispute description",
      });
      // todo: check error message

      await dispute_creation;
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
      assert.strictEqual(res.status, "declined", "original transaction status");

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
  "madsolution duplicate disputes should not be created",
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
      assert.strictEqual(res.status, "declined", "original transaction status");

      let secondRes = await merchant.create_dispute_err({
        token: init_response.token,
        file_path: assets.PngImgPath,
        description: "test dispute description",
      });

      secondRes.assert_error([
        { code: "payment_already_has_accepted_dispute", kind: "" },
      ]);

      await dispute_creation;

      await Promise.all(notifications);
    }),
);

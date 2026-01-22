import { assert } from "vitest";
import * as common from "@/common";
import * as assets from "@/assets";
import { MadsolutionPayment } from "@/provider_mocks/madsolution";
import { providers } from "@/settings_builder";
import { test } from "@/test_context";
import { delay } from "@std/async";
import type { Context } from "@/test_context/context";

const CURRENCY = "RUB";
const CALLBACK_DELAY = 5_000;

async function setupFailedTransaction(ctx: Context) {
  let merchant = await ctx.create_random_merchant();
  await merchant.set_settings(
    providers(CURRENCY, MadsolutionPayment.settings(ctx.uuid)),
  );
  let payment = new MadsolutionPayment();
  let madsolution = ctx.mock_server(MadsolutionPayment.mock_params(ctx.uuid));

  madsolution.queue(payment.create_handler("PENDING")).then(async () => {
    await delay(CALLBACK_DELAY);
    await payment.send_callback("CANCELED");
  });

  let init_response = await merchant.create_payment({
    ...common.paymentRequest(CURRENCY),
    extra_return_param: "SBP",
  });
  await init_response
    .followFirstProcessingUrl()
    .then((p) => p.as_8pay_requisite());

  await merchant.queue_notification((notification) => {
    assert.strictEqual(notification.type, "pay");
    assert.strictEqual(notification.status, "declined");
  });
  return { payment, madsolution, merchant, init_response };
}

test.concurrent("madsolution dispute status finalization to approved", ({ ctx }) =>
  ctx.track_bg_rejections(async () => {
    let { init_response, madsolution, merchant, payment } =
      await setupFailedTransaction(ctx);
    madsolution.queue(payment.create_dispute_handler());
    madsolution.queue(payment.dispute_status_handler("APPROVED"));

    await merchant.create_dispute({
      token: init_response.token,
      file_path: assets.PngImgPath,
      description: "test dispute description",
    });

    let notifiactions = [
      merchant.queue_notification(
        (notification) => {
          assert.strictEqual(notification.type, "dispute");
          assert.strictEqual(notification.status, "pending");
        },
        { skip_healthcheck: true },
      ),
      merchant.queue_notification(
        (notification) => {
          assert.strictEqual(notification.type, "dispute");
          assert.strictEqual(notification.status, "approved");
        },
        { skip_healthcheck: true },
      ),
    ];

    await Promise.all(notifiactions);
  }),
);

test.concurrent("madsolution dispute status finalization to declined", ({ ctx }) =>
  ctx.track_bg_rejections(async () => {
    let { init_response, madsolution, merchant, payment } =
      await setupFailedTransaction(ctx);
    madsolution.queue(payment.create_dispute_handler());
    madsolution.queue(payment.dispute_status_handler("REJECTED"));

    await merchant.create_dispute({
      token: init_response.token,
      file_path: assets.PngImgPath,
      description: "test dispute description",
    });

    let notifiactions = [
      merchant.queue_notification(
        (notification) => {
          assert.strictEqual(notification.type, "dispute");
          assert.strictEqual(notification.status, "pending");
        },
        { skip_healthcheck: true },
      ),
      merchant.queue_notification(
        (notification) => {
          assert.strictEqual(notification.type, "dispute");
          assert.strictEqual(notification.status, "declined");
        },
        { skip_healthcheck: true },
      ),
    ];

    await Promise.all(notifiactions);
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

      let res = await merchant.create_dispute({
        token: init_response.token,
        file_path: assets.PngImgPath,
        description: "test dispute description",
      });
      assert.strictEqual(res.status, "declined", "original transaction status");

      await dispute_creation;

      let notifiactions = [
        merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "dispute");
            assert.strictEqual(notification.status, "pending");
          },
          { skip_healthcheck: true },
        ),
        merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "dispute");
            assert.strictEqual(notification.status, "declined");
          },
          { skip_healthcheck: true },
        ),
      ];

      await Promise.all(notifiactions);
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

      let res = await merchant.create_dispute({
        token: init_response.token,
        file_path: assets.PngImgPath,
        description: "test dispute description",
      });
      assert.strictEqual(res.status, "declined", "original transaction status");

      await dispute_creation;

      let notifiactions = [
        merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "dispute");
            assert.strictEqual(notification.status, "pending");
          },
          { skip_healthcheck: true },
        ),
        merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.type, "dispute");
            assert.strictEqual(notification.status, "approved");
          },
          { skip_healthcheck: true },
        ),
      ];

      await Promise.all(notifiactions);
    }),
);

import * as common from "@/common";
import { traderSetttings, type Bank, type Requisite } from "@/driver/trader";
import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { assert, describe } from "vitest";

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent("trader tests", { timeout: 120_000 }, () => {
    test.concurrent("sms parser with 2 devices", ({ ctx, merchant }) =>
      ctx.track_bg_rejections(async () => {
        let trader = await ctx.create_random_trader();
        await trader.cashin("main", "USDT", (common.amount * 2) / 100);
        await trader.enable_trader_method("sbp_enabled");
        await merchant.set_settings(traderSetttings([trader.id]));
        async function aux() {
          let device_id = await trader.driver.create_device();
          await trader.driver.activate_device(device_id);

          async function setupProfile(bank: Bank) {
            let profile = await trader.driver.create_profile({
              bank,
              device_id,
            });
            assert(profile.id);

            let req = await trader.driver.add_requisite({
              requisite_value: common.phoneNumber,
              requisite_type: "sbp",
              profile_id: profile.id,
              title: "demostuff",
            });
            assert(req.id);
            await trader.driver.activate_requisite(req.id);
            return profile;
          }

          await setupProfile("tbank");

          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                bank_name: "tbank",
                requisite_type: "sbp",
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          return { token: res.token, device_id };
        }

        await aux();
        let first = await aux();
        let approved_notification = merchant.queue_notification(
          (notification) => {
            assert.strictEqual(notification.status, "approved");
            assert.strictEqual(notification.token, first.token);
          },
        );
        let sms_res = await trader.driver.send_sms({
          uuid: first.device_id,
          from: "T-Bank",
          text: `Пополнение на ${common.amount / 100} ₽`,
          sim: "com.idamob.tinkoff.android",
        });

        console.log(sms_res);

        await approved_notification;
      }),
    );
  });

type SmsTestParams = {
  from: string;
  text: (amount: number) => string;
  sim: string;
  bank: Bank;
  requisite_type: Requisite;
};

function smsParserTest({
  from,
  text,
  sim,
  bank,
  requisite_type,
}: SmsTestParams) {
  test
    .runIf(CONFIG.in_project(["reactivepay"]))
    .concurrent(
      `sms parser ${bank}`,
      { timeout: 60_000 },
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          let trader = await ctx.create_random_trader();
          let { device_id } = await trader.setup({
            sbp: true,
            card: true,
            bank,
          });
          await trader.cashin("main", "USDT", common.amount / 100);
          await merchant.set_settings(traderSetttings([trader.id]));
          let res = await merchant
            .create_payment({
              ...common.paymentRequest("RUB"),
              bank_account: {
                bank_name: bank,
                requisite_type,
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          let approved_notification = merchant.queue_notification(
            (notification) => {
              assert.strictEqual(notification.status, "approved");
              assert.strictEqual(notification.token, res.token);
            },
          );

          let sms_res = await trader.driver.send_sms({
            uuid: device_id,
            from,
            text: text(common.amount),
            sim,
          });

          console.log(sms_res);

          await approved_notification;
        }),
    );
}

smsParserTest({
  requisite_type: "sbp",
  bank: "tbank",
  from: "T-Bank",
  sim: "com.idamob.tinkoff.android",
  text: (amount) =>
    `Пополнение на ${(amount / 100).toString().replace(".", ",")} ₽`,
});

smsParserTest({
  requisite_type: "sbp",
  bank: "tbank",
  from: "T-Bank",
  sim: "com.idamob.tinkoff.android",
  text: (amount) =>
    `Пополнение на ${(amount / 100).toString().replace(".", ",")} ₽ СБП`,
});

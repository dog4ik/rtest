import * as common from "@/common";
import { traderSetttings, type Bank, type Requisite } from "@/driver/trader";
import { CONFIG, PROJECT } from "@/config";
import { test } from "@/test_context";
import { assert, describe } from "vitest";
import type { Context } from "@/test_context/context";
import type { CreateSmsParser } from "@/driver/core";

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("trader sms tests", { timeout: 120_000 }, () => {
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
  from: string | ((amount: number) => string);
  text: string | ((amount: number) => string);
  sim: string;
  bank?: Bank;
  requisite_type: Requisite;
};

function test_existng_parser({
  from,
  text,
  sim,
  bank,
  requisite_type,
}: SmsTestParams) {
  test
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
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
            from: typeof from === "function" ? from(common.amount) : from,
            text: typeof text === "function" ? text(common.amount) : text,
            sim,
          });

          console.log(sms_res);

          await approved_notification;
        }),
    );
}

test_existng_parser({
  requisite_type: "sbp",
  bank: "tbank",
  from: "T-Bank",
  sim: "com.idamob.tinkoff.android",
  text: (amount) =>
    `Пополнение на ${(amount / 100).toString().replace(".", ",")} ₽`,
});

test_existng_parser({
  requisite_type: "sbp",
  bank: "tbank",
  from: "T-Bank",
  sim: "com.idamob.tinkoff.android",
  text: (amount) =>
    `Пополнение на ${(amount / 100).toString().replace(".", ",")} ₽ СБП`,
});

async function setup_trader_with_bank(ctx: Context) {
  let bank = await ctx.create_random_bank();
  let merchant = await ctx.create_random_merchant();
  let trader = await ctx.create_random_trader({ usdt: true });
  await trader.cashin("main", "USDT", common.amount);
  merchant.set_settings(traderSetttings([trader.id]));
  let setup = await trader.setup({
    bank: bank.system_name,
    card: true,
    sbp: true,
  });
  return { bank, trader, setup, merchant };
}

type BankSmsTestParams = {
  parsers: Omit<CreateSmsParser, "bank_id">[];
  sms: SmsTestParams;
};

function test_new_bank_sms<T extends BankSmsTestParams>({ sms, parsers }: T) {
  test
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
    .concurrent(`${sms.text} | ${sms.from} sms test`, ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let { bank, trader, merchant, setup } =
          await setup_trader_with_bank(ctx);
        for (let parser of parsers) {
          await ctx.shared_state().core_harness.add_sms_parser({
            ...parser,
            bank_id: bank.system_name,
          });
        }
        let approve = merchant.queue_notification((cb) => {
          assert.strictEqual(cb.status, "approved", "merchant approved status");
        });
        await merchant
          .create_payment({
            ...common.paymentRequest("RUB"),
            bank_account: {
              bank_name: bank,
              requisite_type: sms.requisite_type,
            },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());
        let sms_res = await trader.driver.send_sms({
          uuid: setup.device_id,
          from:
            typeof sms.from === "function" ? sms.from(common.amount) : sms.from,
          text:
            typeof sms.text === "function" ? sms.text(common.amount) : sms.text,
          sim: sms.sim,
        });
        console.log({ sms_res });
        await approve;
      }),
    );
}

function format_amount(amount: number) {
  return (amount / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

test_new_bank_sms({
  sms: {
    requisite_type: "card",
    bank: "otp",
    from: (amount) => `+${format_amount(amount)} ₴`,
    sim: "ua.otpbank.mobile",
    text: `Переказ на картку Shmarkatiuk Serhii → Стартова ••1858 Баланс: 2 812.00 ₴`,
  },
  parsers: [
    {
      sms_type: "card",
      from_data: `\+?([\\d\\s]+\\.\\d{2})\\s*₴`,
      pattern: `\\+?([\\d\\s]+\\.\\d{2})\\s*₴`,
      sim: "ua.otpbank.mobile",
      currency: "RUB",
    },
  ],
});

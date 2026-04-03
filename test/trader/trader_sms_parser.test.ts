import * as common from "@/common";
import crypto from "node:crypto";
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
  sim?: string;
  bank?: Bank;
  requisite_type: Requisite;
};

function test_existng_parser({
  from,
  text,
  sim: parserSim,
  bank,
  requisite_type,
}: SmsTestParams) {
  let sim =
    parserSim ??
    [...Array(3)].map(() => crypto.randomBytes(4).toString("hex")).join(".");
  test
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
    .concurrent(
      `sms parser ${bank}`,
      { timeout: 90_000 },
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
  await merchant.set_settings(traderSetttings([trader.id]));
  let setup = await trader.setup({
    bank: bank.system_name,
    card: true,
    sbp: true,
  });
  return { bank, trader, setup, merchant };
}

type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type BankSmsTestParams = {
  parsers: MakeOptional<Omit<CreateSmsParser, "bank_id">, "sim">[];
  sms: SmsTestParams;
  request_payer_name?: { first_name?: string; last_name?: string };
  request_currency?: string;
};

function test_new_bank_sms<T extends BankSmsTestParams>({
  sms,
  parsers,
  request_payer_name,
  request_currency,
}: T) {
  test
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
    .concurrent(
      `${sms.text} | ${sms.from} sms test`,
      { timeout: 90_000 },
      ({ ctx }) =>
        ctx.track_bg_rejections(async () => {
          let internalSim = [...Array(3)]
            .map(() => crypto.randomBytes(4).toString("hex"))
            .join(".");
          let { bank, trader, merchant, setup } =
            await setup_trader_with_bank(ctx);
          for (let parser of parsers) {
            await ctx.shared_state().core_harness.add_sms_parser({
              ...parser,
              bank_id: bank.id.toString(),
              sim: parser.sim ?? internalSim,
            });
          }
          let approve = merchant.queue_notification((cb) => {
            assert.strictEqual(
              cb.status,
              "approved",
              "merchant approved status",
            );
          });
          let req = common.paymentRequest(request_currency ?? "RUB");
          await merchant
            .create_payment({
              ...req,
              bank_account: {
                bank_name: bank.system_name,
                requisite_type: sms.requisite_type,
              },
              customer: {
                ...req.customer,
                first_name: request_payer_name?.first_name,
                last_name: request_payer_name?.last_name,
              },
            })
            .then((r) => r.followFirstProcessingUrl())
            .then((r) => r.as_trader_requisites());

          let sms_res = await trader.driver.send_sms({
            uuid: setup.device_id,
            from:
              typeof sms.from === "function"
                ? sms.from(common.amount)
                : sms.from,
            text:
              typeof sms.text === "function"
                ? sms.text(common.amount)
                : sms.text,
            sim: sms.sim ?? internalSim,
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
    from: (amount) => `+${format_amount(amount)} ₴`,
    text: `Переказ на картку Shmarkatiuk Serhii → Стартова ••1858 Баланс: 2 812.00 ₴`,
  },
  parsers: [
    {
      sms_type: "card",
      from_data: `\\+?([\\d\\s]+\\.\\d{2})\\s*₴`,
      pattern: `\\+?([\\d\\s]+\\.\\d{2})\\s*₴`,
      currency: "RUB",
    },
  ],
});

// Sberbank card: amount parsed from SMS text body; from is a static short code "900"
test_new_bank_sms({
  sms: {
    requisite_type: "card",
    from: "900",
    text: (amount) =>
      `Зачисление ${format_amount(amount)} р Карта *1234 Баланс: 5 000.00 р`,
  },
  parsers: [
    {
      sms_type: "card",
      from_data: `900`,
      pattern: `Зачисление ([\\d ]+\\.\\d{2}) р`,
      currency: "RUB",
    },
  ],
});

// Alfa-Bank SBP: amount parsed from the dynamic from field; text is static
test_new_bank_sms({
  sms: {
    requisite_type: "sbp",
    from: (amount) => `+${format_amount(amount)} ₽`,
    text: `СБП. Пополнение по номеру телефона. Баланс: 5 000.00 ₽`,
  },
  parsers: [
    {
      sms_type: "sbp",
      from_data: `\\+?([\\d ]+\\.\\d{2})\\s*₽`,
      pattern: `\\+?([\\d ]+\\.\\d{2})\\s*₽`,
      currency: "RUB",
    },
  ],
});

// VTB card: amount with comma decimal parsed from SMS text; from is static "VTB"
test_new_bank_sms({
  sms: {
    requisite_type: "card",
    from: "VTB",
    text: (amount) =>
      `VTB. Зачисление ${format_amount(amount).replace(".", ",")} RUB. Счёт *5678`,
  },
  parsers: [
    {
      sms_type: "card",
      from_data: `VTB`,
      pattern: `Зачисление ([\\d\\s]+[.,]\\d{2}) RUB`,
      currency: "RUB",
    },
  ],
});

// Raiffeisen SBP: amount parsed from dynamic from field; text is static, key_word filter applied
test_new_bank_sms({
  sms: {
    requisite_type: "sbp",
    from: (amount) => `Raiffeisen +${format_amount(amount)} ₽`,
    text: `Пополнение по СБП. Баланс: 3 000.00 ₽`,
  },
  parsers: [
    {
      sms_type: "sbp",
      from_data: `Raiffeisen \\+([\\d\\s]+\\.\\d{2}) ₽`,
      pattern: `([\\d\\s]+\\.\\d{2}) ₽`,
      currency: "RUB",
    },
  ],
});

// Gazprombank card: amount parsed from SMS text body with ₽ sign; from is static "GAZPROM"
test_new_bank_sms({
  sms: {
    requisite_type: "card",
    from: "GAZPROM",
    text: (amount) => `ГПБ: зачислено ${format_amount(amount)} ₽ на счёт *9012`,
  },
  parsers: [
    {
      sms_type: "card",
      from_data: `GAZPROM`,
      pattern: `зачислено ([\\d\\s]+\\.\\d{2}) ₽`,
      currency: "RUB",
    },
  ],
});

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("payer_pattern tests", () => {
    // test for amount format X.XXX,XX
    test_new_bank_sms({
      sms: {
        requisite_type: "card",
        from: "Gelen Para Transferi",
        text: (amount) =>
          `Sayın HANİ HAMDAN, 24.03.2026 tarihinde, saat 18:50'de CUMA EL KÜRDİ tarafından, 5001 ek nolu hesabınıza 1.234,56 TL havale aktarılmıştır.`,
        sim: "com.ziraat.ziraatmobil",
      },
      request_payer_name: {
        first_name: "CUMA EL",
        last_name: "KÜRDİ",
      },
      request_currency: "TRY",
      parsers: [
        {
          sms_type: "card",
          from_data: `Gelen Para Transferi`,
          pattern: `([\\d.,]+)\\s*TL`,
          payer_pattern: `(?<=\\d'de\\s)(.*?)(?=\\starafından)`,
          currency: "TRY",
          sim: "com.ziraat.ziraatmobil",
        },
      ],
    });

    // Test names with mixed components order.
    test_new_bank_sms({
      sms: {
        requisite_type: "card",
        from: "Gelen Para Transferi",
        text: (amount) =>
          `Sayın HANİ HAMDAN, 24.03.2026 tarihinde, saat 18:50'de CUMA EL KÜRDİ tarafından, 5001 ek nolu hesabınıza ${format_amount(amount).replaceAll(" ", "")} TL havale aktarılmıştır.`,
      },
      request_payer_name: {
        first_name: "EL CUMA",
        last_name: "KÜRDİ",
      },
      parsers: [
        {
          sms_type: "card",
          from_data: `Gelen Para Transferi`,
          pattern: `([\\d.,]+)\\s*TL`,
          payer_pattern: `(?<=\\d'de\\s)(.*?)(?=\\starafından)`,
          currency: "RUB",
        },
      ],
    });
  });

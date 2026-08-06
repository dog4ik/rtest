import crypto from "node:crypto";
import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { CreateSmsParser } from "@/driver/core";
import { type Requisite, traderSettings } from "@/driver/trader";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

type SmsParams = {
  from: string | ((amount: number) => string);
  text: string | ((amount: number) => string);
  parsed_amount?: number;
  parsed_payer?: string;
  parsed_card?: string;
  sim?: string;
};

async function setup_trader_with_bank(ctx: Context) {
  let bank = await ctx.create_random_bank();
  let merchant = await ctx.create_random_merchant();
  let trader = await ctx.create_random_trader({ usdt: true });
  await trader.cashin("main", "USDT", common.amount);
  await merchant.set_settings(traderSettings([trader.id]));
  let setup = await trader.setup({
    bank: bank.system_name,
    card: true,
    sbp: true,
    account: true,
  });
  return { bank, trader, setup, merchant };
}

type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type BankSmsTestParams = {
  requisite_type: Requisite;
  should_fail?: boolean;
  parsers: MakeOptional<Omit<CreateSmsParser, "bank_id">, "sim">[];
  sms_messages: SmsParams[];
  only?: boolean;
  request_payer_name?: { first_name?: string; last_name?: string };
  request_currency?: string;
};

function test_new_bank_sms<T extends BankSmsTestParams>(
  name: string,
  {
    sms_messages,
    should_fail,
    parsers,
    request_payer_name,
    request_currency,
    requisite_type,
    only,
  }: T,
) {
  test
    .runIf(CONFIG.in_project(["reactivepay", "a2"]))
    .concurrent(`${name} sms test`, { timeout: 90_000, only }, ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        let internalSim = [...Array(3)]
          .map(() => crypto.randomBytes(4).toString("hex"))
          .join(".");
        let { bank, trader, merchant, setup } =
          await setup_trader_with_bank(ctx);
        for (let parser of parsers) {
          await ctx.create_sms_parser({
            ...parser,
            bank_id: bank.id.toString(),
            sim: parser.sim ?? internalSim,
          });
        }
        let notification = merchant.queue_notification((cb) => {
          if (should_fail) {
            assert.fail("Merchant should not get any notifications");
          } else {
            assert.strictEqual(
              cb.status,
              "approved",
              "merchant approved status",
            );
          }
        });
        let req = common.paymentRequest(request_currency ?? "RUB");
        await merchant
          .create_payment({
            ...req,
            bank_account: {
              bank_name: bank.system_name,
              requisite_type,
            },
            customer: {
              ...req.customer,
              first_name: request_payer_name?.first_name,
              last_name: request_payer_name?.last_name,
            },
          })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_trader_requisites());

        for (let sms of sms_messages) {
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

          if (sms.parsed_amount || sms.parsed_card || sms.parsed_payer) {
            let parsed = sms_res.as_parsed();
            if (sms.parsed_card !== undefined) {
              assert.strictEqual(
                parsed.card,
                sms.parsed_card,
                "parsed sms card should match",
              );
            }
            if (sms.parsed_amount !== undefined) {
              assert.strictEqual(
                parsed.transaction_amount,
                sms.parsed_amount,
                "parsed sms amount should match",
              );
            }
            if (sms.parsed_payer !== undefined) {
              assert.strictEqual(
                parsed.payer,
                sms.parsed_payer,
                "parsed sms payer should match",
              );
            }
          }
        }
        if (should_fail) {
          await Promise.race([delay(60_000), notification]);
        } else {
          await notification;
        }
      }),
    );
}

// 1 234.56
function format_amount(amount: number) {
  return (amount / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

describe
  .runIf(CONFIG.in_project(["a2"]))
  .concurrent("sms parser basics", () => {
    test_new_bank_sms("Предзаказ на карту...", {
      requisite_type: "card",
      sms_messages: [
        {
          from: (amount) => `+${format_amount(amount)} ₴`,
          parsed_amount: common.amount / 100,
          text: `Переказ на картку Shmarkatiuk Serhii → Стартова ••1858 Баланс: 2 812.00 ₴`,
        },
      ],
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
    test_new_bank_sms("Sberbank card", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "900",
          parsed_amount: common.amount / 100,
          text: (amount) =>
            `Зачисление ${format_amount(amount)} р Карта *1234 Баланс: 5 000.00 р`,
        },
      ],
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
    test_new_bank_sms("Alfa-Bank SBP", {
      requisite_type: "sbp",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: (amount) => `+${format_amount(amount)} ₽`,
          text: `СБП. Пополнение по номеру телефона. Баланс: 5 000.00 ₽`,
        },
      ],
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
    test_new_bank_sms("VTB card", {
      requisite_type: "card",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: "VTB",
          text: (amount) =>
            `VTB. Зачисление ${format_amount(amount).replace(".", ",")} RUB. Счёт *5678`,
        },
      ],
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
    test_new_bank_sms("Raiffeisen SBP", {
      requisite_type: "sbp",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: (amount) => `Raiffeisen +${format_amount(amount)} ₽`,
          text: `Пополнение по СБП. Баланс: 3 000.00 ₽`,
        },
      ],
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
    test_new_bank_sms("Gazprombank card", {
      requisite_type: "card",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: "GAZPROM",
          text: (amount) =>
            `ГПБ: зачислено ${format_amount(amount)} ₽ на счёт *9012`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `GAZPROM`,
          pattern: `зачислено ([\\d\\s]+\\.\\d{2}) ₽`,
          currency: "RUB",
        },
      ],
    });

    test_new_bank_sms("multiple messages with different amounts", {
      requisite_type: "card",
      sms_messages: [
        {
          parsed_amount: 1234.55,
          from: "GAZPROM",
          text: `ГПБ: зачислено 1 234.55 ₽ на счёт *9012`,
        },
        {
          parsed_amount: common.amount / 100,
          from: "GAZPROM",
          text: (amount) =>
            `ГПБ: зачислено ${format_amount(amount)} ₽ на счёт *9012`,
        },
        {
          parsed_amount: 1234.55,
          from: "GAZPROM",
          text: `ГПБ: зачислено 1 234.55 ₽ на счёт *9012`,
        },

        {
          parsed_amount: 1134.55,
          from: "GAZPROM",
          text: `ГПБ: зачислено 1 134.55 ₽ на счёт *9012`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `GAZPROM`,
          pattern: `зачислено ([\\d\\s]+\\.\\d{2}) ₽`,
          currency: "RUB",
        },
      ],
    });

    test_new_bank_sms("multiple messages with same amounts", {
      requisite_type: "card",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: "GAZPROM",
          text: (amount) =>
            `ГПБ: зачислено ${format_amount(amount)} ₽ на счёт *9012`,
        },
        {
          parsed_amount: common.amount / 100,
          from: "GAZPROM",
          text: (amount) =>
            `ГПБ: зачислено ${format_amount(amount)} ₽ на счёт *9012`,
        },
        {
          parsed_amount: common.amount / 100,
          from: "GAZPROM",
          text: (amount) =>
            `ГПБ: зачислено ${format_amount(amount)} ₽ на счёт *9012`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `GAZPROM`,
          pattern: `зачислено ([\\d\\s]+\\.\\d{2}) ₽`,
          currency: "RUB",
        },
      ],
    });
  });

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .todo("payer_pattern tests", () => {
    // test for amount format X.XXX,XX
    test_new_bank_sms("amount format X.XXX,XX", {
      requisite_type: "card",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: "Gelen Para Transferi",
          text: () =>
            `Sayın HANİ HAMDAN, 24.03.2026 tarihinde, saat 18:50'de CUMA EL KÜRDİ tarafından, 5001 ek nolu hesabınıza 1.234,56 TL havale aktarılmıştır.`,
          sim: "com.ziraat.ziraatmobil",
        },
      ],
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
    test_new_bank_sms("names with mixed components order", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "Gelen Para Transferi",
          parsed_amount: common.amount / 100,
          text: (amount) =>
            `Sayın HANİ HAMDAN, 24.03.2026 tarihinde, saat 18:50'de CUMA EL KÜRDİ tarafından, 5001 ek nolu hesabınıza ${format_amount(amount).replaceAll(" ", "")} TL havale aktarılmıştır.`,
        },
      ],
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

describe
  .runIf(CONFIG.in_project(["a2"]))
  .concurrent("card_mask parsers", () => {
    // FreeBank RUB - amount in body, card: XXXXXX*****4242
    test_new_bank_sms("FreeBank card XXXX****4242", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "FreeBank",
          parsed_amount: common.amount / 100,
          parsed_card: "4242",
          text: (amount) =>
            `FreeBank Операція на +${format_amount(amount)}₴ Комісія: 0.00₴ HOLDER NAME KYIV 28.04.26 10:00 Картка 421113*****4242 Баланс: 6 313.82₴`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: "FreeBank",
          pattern: `Операція на \\+?([\\d\\s]+\\.\\d{2})₴`,
          currency: "RUB",
          card_mask: `Картка [\\d]+\\*+(\\d{4})`,
        },
      ],
      request_currency: "RUB",
    });

    // Amount encoded in the from-field, card mask in body (••••4242)
    test_new_bank_sms("amount in from, card mask in body", {
      requisite_type: "card",
      sms_messages: [
        {
          from: (amount) => `+${format_amount(amount)} ₴`,
          parsed_amount: common.amount / 100,
          parsed_card: "4242",
          text: `Переказ на картку Holder Name → Стартова ••••4242 Баланс: 2 000.00 ₴`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `\\+?([\\d\\s]+\\.\\d{2})\\s*₴`,
          pattern: `\\+?([\\d\\s]+\\.\\d{2})\\s*₴`,
          currency: "RUB",
          card_mask: `[•\\*]+(\\d{4})`,
        },
      ],
      request_currency: "RUB",
    });

    test_new_bank_sms("parser with card takes priority", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "TestBank",
          parsed_amount: common.amount / 100,
          parsed_card: "4242",
          text: (amount) => `Cashin ${format_amount(amount)} руб Карта *4242`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: "TestBank",
          pattern: `(\\d{4})`,
          currency: "RUB",
        },
        {
          sms_type: "card",
          from_data: "TestBank",
          pattern: `Cashin ([\\d\\s]+\\.\\d{2}) руб`,
          currency: "RUB",
          card_mask: `Карта \\*(\\d{4})`,
        },
        {
          sms_type: "card",
          from_data: "TestBank",
          pattern: `(\\d{4})`,
          currency: "RUB",
        },
      ],
    });

    test_new_bank_sms("card_mask does not match, correct fallback should win", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "TestBank2",
          parsed_amount: common.amount / 100,
          text: (amount) => `Cashin ${format_amount(amount)}`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: "TestBank2",
          pattern: `([\\d\\s]+\\.\\d{2})`,
          currency: "RUB",
        },
        {
          sms_type: "card",
          from_data: "TestBank2",
          pattern: `(\\d{4})`,
          currency: "RUB",
          card_mask: `Карта \\*(\\d{4})`,
        },
        {
          sms_type: "card",
          from_data: "TestBank2",
          pattern: `(\\d{4})`,
          currency: "RUB",
        },
      ],
    });

    test_new_bank_sms("parser fails because card_mask failed to match", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "TestBank3",
          text: (amount) => `Cashin ${format_amount(amount)} руб Карта 4242`,
        },
      ],
      should_fail: true,
      parsers: [
        {
          sms_type: "card",
          from_data: "TestBank3",
          pattern: `Cashin ([\\d\\s]+\\.\\d{2})`,
          currency: "RUB",
          card_mask: `Карта \\*(\\d{4})`,
        },
      ],
    });

    test_new_bank_sms("mixed card masks", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "TestBank3",
          parsed_card: "1111",
          parsed_amount: common.amount / 100,
          text: (amount) => `Cashin ${format_amount(amount)} руб Карта *1111`,
        },
        {
          from: "TestBank3",
          parsed_card: "4242",
          parsed_amount: common.amount / 100,
          text: (amount) => `Cashin ${format_amount(amount)} руб Карта *4242`,
        },
        {
          from: "TestBank3",
          parsed_card: "2222",
          parsed_amount: common.amount / 100,
          text: (amount) => `Cashin ${format_amount(amount)} руб Карта *2222`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: "TestBank3",
          pattern: `Cashin ([\\d\\s]+\\.\\d{2})`,
          currency: "RUB",
          card_mask: `Карта \\*(\\d{4})`,
        },
      ],
    });

    test_new_bank_sms("parsed card does not match requisite", {
      requisite_type: "card",
      should_fail: true,
      sms_messages: [
        {
          from: "TestBank3",
          parsed_card: "4222",
          parsed_amount: common.amount / 100,
          text: (amount) => `Cashin ${format_amount(amount)} руб Карта *4222`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: "TestBank3",
          pattern: `Cashin ([\\d\\s]+\\.\\d{2})`,
          currency: "RUB",
          card_mask: `Карта \\*(\\d{4})`,
        },
      ],
    });

    test_new_bank_sms("real case", {
      requisite_type: "card",
      sms_messages: [
        {
          from: "+1 234.56 ₴",
          parsed_card: "4242",
          parsed_amount: common.amount / 100,
          text: `Переказ на картку Testov Test → Стартова ••••4242 Баланс: +1 234.56 ₴`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: "\\+?([\\d\\s]+.\\d{2})\\s*₴",
          pattern: `\\+?([\\d\\s]+.\\d{2})\\s*₴`,
          currency: "RUB",
          card_mask: `[•*]+(\\d{4})`,
        },
      ],
    });
  });

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .todo("INR sms parser (surname mess)", () => {
    // The known limitation where only first letter of second name is used. Thus different second name that starts on the same letter finalizes transaction
    test_new_bank_sms(
      "different last name starts with the same character (tests implementation limitation, ideally test should fail)",
      {
        requisite_type: "card",
        request_currency: "INR",
        request_payer_name: {
          first_name: "Sakura",
          last_name: "Daebil",
        },
        sms_messages: [
          {
            from: "Received ₹1234.56",
            parsed_amount: common.amount / 100,
            parsed_payer: "Sakura Daemon",
            // Last name is different but starts with D
            text: `From Sakura Daemon`,
          },
        ],
        parsers: [
          {
            sms_type: "card",
            from_data: `Received`,
            pattern: `Received\\s+₹([\\d,.]+)`,
            payer_pattern: `From\\s+(.+)`,
            currency: "INR",
          },
        ],
      },
    );

    test_new_bank_sms("happy path", {
      requisite_type: "card",
      request_currency: "INR",
      request_payer_name: {
        first_name: "Sakura",
        last_name: "Daemon",
      },
      sms_messages: [
        {
          from: "Received ₹1234.56",
          parsed_amount: common.amount / 100,
          parsed_payer: "Sakura D",
          text: `From Sakura D`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `Received`,
          pattern: `Received\\s+₹([\\d,.]+)`,
          payer_pattern: `From\\s+(.+)`,
          currency: "INR",
        },
      ],
    });

    test_new_bank_sms("mixed last name letters", {
      requisite_type: "card",
      request_currency: "INR",
      request_payer_name: {
        first_name: "Sakura",
        last_name: "Daemon",
      },
      sms_messages: [
        {
          from: "Received ₹1234.56",
          parsed_amount: common.amount / 100,
          parsed_payer: "Sakura A C D S D F",
          text: `From Sakura A C D S D F`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `Received`,
          pattern: `Received\\s+₹([\\d,.]+)`,
          payer_pattern: `From\\s+(.+)`,
          currency: "INR",
        },
      ],
    });

    test_new_bank_sms("multiple second names name letters", {
      requisite_type: "card",
      request_currency: "INR",
      request_payer_name: {
        first_name: "Sakura",
        last_name: "Daemon Targarian",
      },
      sms_messages: [
        {
          from: "Received ₹1234.56",
          parsed_amount: common.amount / 100,
          parsed_payer: "Sakura T",
          text: `From Sakura T`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `Received`,
          pattern: `Received\\s+₹([\\d,.]+)`,
          payer_pattern: `From\\s+(.+)`,
          currency: "INR",
        },
      ],
    });

    test_new_bank_sms("different first letter should fail", {
      requisite_type: "card",
      request_currency: "INR",
      should_fail: true,
      request_payer_name: {
        first_name: "Sakura",
        last_name: "Daemon",
      },
      sms_messages: [
        {
          from: "Received ₹1234.56",
          parsed_amount: common.amount / 100,
          parsed_payer: "Sakura A B C",
          text: `From Sakura A B C`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_data: `Received`,
          pattern: `Received\\s+₹([\\d,.]+)`,
          payer_pattern: `From\\s+(.+)`,
          currency: "INR",
        },
      ],
    });
  });

describe
  .runIf(CONFIG.in_project(["reactivepay"]))
  .concurrent("New implementation tests", () => {
    test_new_bank_sms("happy path", {
      requisite_type: "card",
      sms_messages: [
        {
          parsed_amount: common.amount / 100,
          from: "VTB",
          text: (amount) =>
            `VTB. Зачисление ${format_amount(amount).replace(".", ",")} RUB. Счёт *5678`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_pattern: `VTB`,
          from_data: `VTB`,
          pattern: `Зачисление (?<amount>[\\d\\s]+[.,]\\d{2}) RUB`,
          text_pattern: `Зачисление (?<amount>[\\d\\s]+[.,]\\d{2}) RUB`,
          currency: "RUB",
        },
      ],
    });

    test_new_bank_sms("happy path amount fail", {
      requisite_type: "card",
      should_fail: true,
      sms_messages: [
        {
          parsed_amount: (common.amount - 1) / 100,
          from: "VTB",
          text: (amount) =>
            `VTB. Зачисление ${format_amount(amount - 1).replace(".", ",")} RUB. Счёт *5678`,
        },
      ],
      parsers: [
        {
          sms_type: "card",
          from_pattern: `VTB`,
          from_data: `VTB`,
          pattern: `Зачисление (?<amount>[\\d\\s]+[.,]\\d{2}) RUB`,
          text_pattern: `Зачисление (?<amount>[\\d\\s]+[.,]\\d{2}) RUB`,
          currency: "RUB",
        },
      ],
    });
  });

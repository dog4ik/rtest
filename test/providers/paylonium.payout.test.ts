import { delay } from "@std/async";
import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { HttpContext } from "@/mock_server/api";
import { PayloniumPayout, payoutSuite } from "@/provider_mocks/paylonium";
import { defaultSettings } from "@/settings_builder";
import {
  dataFlowTest,
  payoutPendingSuite,
  statusFinalizationSuite,
} from "@/suite_interfaces";
import { test } from "@/test_context";

const CURRENCY = "RUB";

function payloniumSuite() {
  return payoutSuite(CURRENCY);
}

function nginx429(c: HttpContext): Response {
  c.status(429);
  return c.html(
    `<html><head><title>429 Too Many Requests</title></head>` +
      `<body><center><h1>429 Too Many Requests</h1></center>` +
      `<hr><center>nginx/1.24.0 (Ubuntu)</center></body></html>`,
  );
}

describe
  .runIf(CONFIG.in_project("reactivepay"))
  .concurrent("paylonium payout", () => {
    statusFinalizationSuite(payloniumSuite);
    payoutPendingSuite(payloniumSuite());

    test.concurrent("paylonium_payout pending if 429", async ({ ctx }) => {
      await ctx.track_bg_rejections(async () => {
        const suite = payloniumSuite();
        const merchant = await ctx.create_random_merchant();
        await merchant.set_settings(suite.settings(ctx.uuid));
        const provider = ctx.mock_server(suite.mock_options(ctx.uuid));

        provider.queue(nginx429);
        provider.queue(nginx429);
        provider.queue(nginx429);

        const notification = merchant.queue_notification(() => {
          assert.fail("merchant should not get notification");
        });

        const request = suite.request();
        await merchant.cashin(request.currency, request.amount / 100);
        const response = await merchant.create_payout(request as any);
        const { token } = response;

        await ctx.healthcheck(token);
        const feed = await ctx.get_feed(token);
        assert.strictEqual(feed.status, 0, "feed should be pending");
        await Promise.race([notification, delay(5_000)]);
      });
    });

    dataFlowTest("card pan", {
      ...payloniumSuite(),
      after_create_check() {
        const { last_payment } = this.gw;
        assert(last_payment, "gateway should have received payment request");
        assert.strictEqual(
          last_payment.service,
          24,
          "service should be 24 for card",
        );
        assert.strictEqual(
          last_payment.account,
          common.visaCard,
          "account should be card pan",
        );
      },
    });

    const SBERBANK_CODE = 100000000111;
    const BANK_CODES: Record<string, number> = { Сбербанк: SBERBANK_CODE };

    dataFlowTest("phone reaches gateway", {
      ...payloniumSuite(),
      settings(secret) {
        let settings = defaultSettings(CURRENCY, {
          ...PayloniumPayout.settings(secret),
          service: 26,
          bank_list: BANK_CODES,
        });
        settings.gateways.skip_card_payout_validation = true;
        return settings;
      },
      request() {
        return {
          ...common.payoutRequest(CURRENCY),
          extra_return_param: "Сбербанк",
          customer: {
            email: "test@email.com",
            ip: common.ip,
            phone: common.phoneNumber,
            first_name: common.firstName,
            last_name: common.lastName,
          },
        };
      },
      after_create_check() {
        const { last_payment } = this.gw;
        assert(last_payment, "gateway should have received payment request");
        assert.strictEqual(
          last_payment.service,
          26,
          "service should be 26 for SBP",
        );
        assert.strictEqual(
          last_payment.account,
          common.phoneNumber,
          "account should be phone number",
        );
        assert.strictEqual(
          last_payment.attrs.payee_bank_code,
          String(SBERBANK_CODE),
          "payee_bank_code should match bank mapping",
        );
      },
    });
  });

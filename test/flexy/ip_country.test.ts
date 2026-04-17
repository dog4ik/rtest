import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { describe, assert } from "vitest";
import * as common from "@/common";
import * as default_provider from "@/provider_mocks/default";

const CURRENCY = "RUB";

// 1.0.0.0/24 is assigned to Australia (AU)
const AU_IP = "1.0.0.40";
const US_IP = "8.8.8.8";
// 127.0.0.1 is a loopback address, not in any GeoIP database
const UNKNOWN_IP = "127.0.0.1";

describe
  .runIf(CONFIG.in_project(["reactivepay", "paysure"]))
  .concurrent("ip country rules", () => {
    test.concurrent(
      "not_in_ip_country blocks IP from banned country",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          await merchant.set_settings(default_provider.fullSettings(CURRENCY));

          await ctx.add_flexy_guard_rule(
            {
              header: { mid: merchant.id.toString() },
              body: {
                ip: {
                  not_in_ip_country: ["AU", "CN", "US"],
                },
              },
              routing: {},
              action: null,
              dispatching: null,
            },
            "not_in_ip_country AU,CN,US rule",
          );

          let req = {
            ...default_provider.request(CURRENCY, common.amount, "pay", true),
            customer: {
              email: "test@test.com",
              ip: AU_IP,
            },
          };

          let err = await merchant.create_payment_err(req);
          assert.include(err.errors as string, `${AU_IP}:AU`);
        }),
    );

    test.concurrent(
      "not_in_ip_country allows IP not from banned country",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          await merchant.set_settings(default_provider.fullSettings(CURRENCY));

          await ctx.add_flexy_guard_rule(
            {
              header: { mid: merchant.id.toString() },
              body: {
                ip: {
                  not_in_ip_country: ["AU", "CN"],
                },
              },
              routing: {},
              action: null,
              dispatching: null,
            },
            "not_in_ip_country AU,CN rule",
          );

          let req = {
            ...default_provider.request(CURRENCY, common.amount, "pay", true),
            customer: {
              email: "test@test.com",
              ip: US_IP,
            },
          };

          let res = await merchant.create_payment(req);
          assert.strictEqual(res.payment.status, "approved");
        }),
    );

    test.concurrent(
      "ip_in_country allows IP from whitelisted country",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          await merchant.set_settings(default_provider.fullSettings(CURRENCY));

          await ctx.add_flexy_guard_rule(
            {
              header: { mid: merchant.id.toString() },
              body: {
                ip: {
                  in_ip_country: ["AU", "CN"],
                },
              },
              routing: {},
              action: null,
              dispatching: null,
            },
            "in_ip_country AU,CN rule",
          );

          let req = {
            ...default_provider.request(CURRENCY, common.amount, "pay", true),
            customer: {
              email: "test@test.com",
              ip: AU_IP,
            },
          };

          let res = await merchant.create_payment(req);
          assert.strictEqual(res.payment.status, "approved");
        }),
    );

    test.concurrent(
      "ip_in_country blocks IP not from whitelisted country",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          await merchant.set_settings(default_provider.fullSettings(CURRENCY));

          await ctx.add_flexy_guard_rule(
            {
              header: { mid: merchant.id.toString() },
              body: {
                ip: {
                  in_ip_country: ["AU", "CN"],
                },
              },
              routing: {},
              action: null,
              dispatching: null,
            },
            "in_ip_country AU,CN rule",
          );

          let req = {
            ...default_provider.request(CURRENCY, common.amount, "pay", true),
            customer: {
              email: "test@test.com",
              ip: US_IP,
            },
          };

          let err = await merchant.create_payment_err(req);
          assert.include(err.errors as string, `${US_IP}:`);
        }),
    );

    test.concurrent(
      "not_in_ip_country allows unknown IP",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          await merchant.set_settings(default_provider.fullSettings(CURRENCY));

          await ctx.add_flexy_guard_rule(
            {
              header: { mid: merchant.id.toString() },
              body: {
                ip: {
                  not_in_ip_country: ["AU", "CN"],
                },
              },
              routing: {},
              action: null,
              dispatching: null,
            },
            "not_in_ip_country AU,CN rule",
          );

          let req = {
            ...default_provider.request(CURRENCY, common.amount, "pay", true),
            customer: {
              email: "test@test.com",
              ip: UNKNOWN_IP,
            },
          };

          let res = await merchant.create_payment(req);
          assert.strictEqual(res.payment.status, "approved");
        }),
    );

    test.concurrent(
      "ip_in_country blocks unknown IP",
      ({ ctx, merchant }) =>
        ctx.track_bg_rejections(async () => {
          await merchant.set_settings(default_provider.fullSettings(CURRENCY));

          await ctx.add_flexy_guard_rule(
            {
              header: { mid: merchant.id.toString() },
              body: {
                ip: {
                  in_ip_country: ["AU", "CN"],
                },
              },
              routing: {},
              action: null,
              dispatching: null,
            },
            "in_ip_country AU,CN rule",
          );

          let req = {
            ...default_provider.request(CURRENCY, common.amount, "pay", true),
            customer: {
              email: "test@test.com",
              ip: UNKNOWN_IP,
            },
          };

          let err = await merchant.create_payment_err(req);
          assert.include(err.errors as string, `${UNKNOWN_IP}:`);
        }),
    );
  });

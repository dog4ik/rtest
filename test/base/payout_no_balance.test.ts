import { assert, describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { Project } from "@/project";
import * as brusnika from "@/provider_mocks/brusnika";
import * as default_provider from "@/provider_mocks/default";
import { payoutSuite } from "@/provider_mocks/gateway_connect";
import { SettingsBuilder } from "@/settings_builder";
import { defaultSuite, providersSuite } from "@/suite_interfaces";
import { test } from "@/test_context";
import type { Context } from "@/test_context/context";

const GC_PROJECTS: Project[] = ["reactivepay", "8pay", "spinpay"];

const CURRENCY = "RUB";

const SETTINGS_KINDS = ["providers", "default"] as const;

type SettingsKind = (typeof SETTINGS_KINDS)[number];

function makeEnv(opts: {
  settings: Record<string, any>;
  request: Record<string, any>;
  guard: () => void;
  via_processing_url: boolean;
}) {
  return {
    settings: opts.settings,
    guardGatewayUnreached: opts.guard,
    async expectPayoutError(merchant: ExtendedMerchant) {
      if (opts.via_processing_url) {
        let res = await merchant.create_payout(opts.request);
        let error = await res
          .followFirstProcessingUrl()
          .then((r) => r.as_error());
        return { error, token: res.token };
      }
      if (CONFIG.in_project(["spinpay", "reactivepay"])) {
        let payout_res = await merchant.create_payout(opts.request);
        return { payout_res, token: payout_res.token };
      } else {
        return {
          error: await merchant.create_payout_err(opts.request),
          token: undefined,
        };
      }
    },
  };
}

function setupPayoutProvider(
  ctx: Context,
  opts: { amount: number; settings_kind: SettingsKind; convert_to?: string },
) {
  let base = payoutSuite(CURRENCY);
  let via_processing_url = opts.settings_kind === "providers";

  let gatewayGuard = (provider: ReturnType<Context["mock_server"]>) => () => {
    provider.queue(async () => {
      assert.fail("gateway must not be reached when payout has no balance");
    });
  };

  if (opts.settings_kind === "providers") {
    let suite = providersSuite(CURRENCY, {
      ...base,
      request: () => ({ ...base.request(), amount: opts.amount }),
    });
    let settings = suite.settings(ctx.uuid) as Record<string, any>;
    if (opts.convert_to) {
      settings.convert_to = opts.convert_to;
      // settings["USDT"] = settings[CURRENCY];
      // delete settings[CURRENCY];
    }
    let provider = ctx.mock_server(suite.mock_options(ctx.uuid));
    return makeEnv({
      settings,
      request: suite.request(),
      guard: gatewayGuard(provider),
      via_processing_url,
    });
  }

  // default / h2h settings
  if (CONFIG.in_project(GC_PROJECTS)) {
    let suite = defaultSuite(CURRENCY, {
      ...base,
      // h2h needs a card on the request
      request: () => ({
        ...base.request(),
        amount: opts.amount,
        card: { pan: common.visaCard },
      }),
    });
    let settings = suite.settings(ctx.uuid) as Record<string, any>;
    if (opts.convert_to) {
      settings.convert_to = opts.convert_to;
      // settings["USDT"] = settings[CURRENCY];
      // delete settings[CURRENCY];
    }
    let provider = ctx.mock_server(suite.mock_options(ctx.uuid));
    return makeEnv({
      settings,
      request: suite.request(),
      guard: gatewayGuard(provider),
      via_processing_url,
    });
  }

  // Fallback: built-in default provider (h2h only, no mock server).
  let settings = default_provider.fullSettings(CURRENCY) as Record<string, any>;
  if (opts.convert_to) settings.convert_to = opts.convert_to;
  return makeEnv({
    settings,
    request: default_provider.request(CURRENCY, opts.amount, "payout", true),
    guard: () => {},
    via_processing_url,
  });
}

function skipSettings(kind: SettingsKind): boolean {
  return kind === "providers" && !CONFIG.in_project(GC_PROJECTS);
}

describe.concurrent("payout no balance", () => {
  for (let settings_kind of SETTINGS_KINDS) {
    for (let convert_to of [undefined, "USDT"] as const) {
      let suffix = `${settings_kind} settings${convert_to ? `, convert_to ${convert_to}` : ""}`;
      test
        .skipIf(skipSettings(settings_kind))
        .concurrent(`no balance (${suffix})`, ({ ctx }) =>
          ctx.track_bg_rejections(async () => {
            let env = setupPayoutProvider(ctx, {
              amount: common.amount,
              settings_kind,
              convert_to,
            });
            let merchant = await ctx.create_random_merchant();
            await merchant.set_settings(env.settings);
            await merchant.set_commission();
            env.guardGatewayUnreached();

            let { token } = await env.expectPayoutError(merchant);
            if (CONFIG.in_project(["spinpay"]) && token) {
              await ctx.healthcheck(token);
            }
          }),
        );
    }
  }

  test.concurrent("no balance for commission", ({ ctx }) =>
    ctx.track_bg_rejections(async () => {
      const AMOUNT = 10_000; // payout amount, minor units
      // h2h ("default") settings so this runs on every project.
      let env = setupPayoutProvider(ctx, {
        amount: AMOUNT,
        settings_kind: "default",
      });
      let merchant = await ctx.create_random_merchant();
      await merchant.set_commission({
        self_rate: "10",
        operation: "PayoutRequest",
      });
      // Balance == payout amount exactly: nothing left to cover the 10% commission.
      await merchant.cashin(CURRENCY, AMOUNT / 100);
      await merchant.set_settings(env.settings);
      env.guardGatewayUnreached();

      let { token } = await env.expectPayoutError(merchant);
      if (token && CONFIG.in_project(["spinpay"])) {
        await ctx.healthcheck(token);
      }
    }));

  test
    .runIf(CONFIG.in_project(["8pay"]))
    // Test goal is to violate available balance assumption where system assumes
    // what commission will be picked without giving merchant an opportunity to select right provider.
    .todo("no balance for commission (p2p)", ({ ctx }) =>
      ctx.track_bg_rejections(async () => {
        const AMOUNT = 10_000;
        let brusnika_suite = brusnika.payoutSuite("RUB");
        let gc_suite = payoutSuite("RUB");
        let gc_mock = ctx.mock_server(gc_suite.mock_options(ctx.uuid));
        let brusnika_mock = ctx.mock_server(
          brusnika_suite.mock_options(ctx.uuid),
        );

        gc_mock.queue(() => {
          assert.fail("GC should not be rearched");
        });

        brusnika_mock.queue(() => {
          assert.fail("brusnika should not be rearched");
        });

        let settings = new SettingsBuilder()
          .addP2P("RUB", "manypay", "manypay")
          .addP2P("RUB", "brusnika", "brusnika")
          .withGateway(gc_suite.settings(ctx.uuid), "manypay")
          .withGateway(brusnika_suite.settings(ctx.uuid), "brusnika")
          .build();
        let merchant = await ctx.create_random_merchant();
        await merchant.set_settings(settings);
        await merchant.set_commission({
          self_rate: "10",
          source: "manypay",
          operation: "PayoutRequest",
        });
        // Balance == payout amount exactly: nothing left to cover the 10% commission.
        await merchant.cashin(CURRENCY, AMOUNT / 100);

        await merchant
          .create_payout({ ...gc_suite.request(), amount: AMOUNT })
          .then((r) => r.followFirstProcessingUrl())
          .then((r) => r.as_error());
      }),
    );
});

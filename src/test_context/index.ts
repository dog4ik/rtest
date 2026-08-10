import type * as playwright from "playwright";
import { test as base } from "vitest";
import * as config from "@/config";
import type { ExtendedMerchant } from "@/entities/merchant";
import type { MockProviderParams } from "@/mock_server/api";
import type { ProviderInstance } from "@/mock_server/instance";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { IronpayPayment } from "@/provider_mocks/ironpay";
import { JusanPayment } from "@/provider_mocks/jusan";
import { MadsolutionPayment } from "@/provider_mocks/madsolution";
import type { RateInstance } from "@/provider_mocks/rate";
import { initState } from "@/state";
import { Context } from "./context";

const state = initState(config.CONFIG);

type TestContext = {
  ctx: Context;
};

type BrowserContext = {
  browser: playwright.BrowserContext;
  chrome: playwright.Browser;
};

type MerchantContext = {
  merchant: ExtendedMerchant;
};

type RateContext = {
  rate_driver: RateInstance;
};

function w(
  mock_params: (secret: string) => MockProviderParams,
): (ctx: TestContext, use: (v: any) => Promise<unknown>) => Promise<void> {
  return async ({ ctx }, use) => {
    await use(ctx.mock_server(mock_params(ctx.uuid)));
  };
}

const ProvidersMockParams = {
  brusnika: w(BrusnikaPayment.mock_params),
  ironpay: w(IronpayPayment.mock_params),
  madsolution: w(MadsolutionPayment.mock_params),
  jusan_pay: w(JusanPayment.mock_params),
};

type ProvidersContext = Record<
  keyof typeof ProvidersMockParams,
  ProviderInstance
>;

declare module "vitest" {
  interface TaskMeta {
    [key: string]: string;
  }
}

export const test = base
  .extend<TestContext>({
    ctx: async ({ task, annotate }, use) => {
      let context = new Context(await state, annotate, task);
      try {
        await use(context).then(() => context.testBackgroundResolve(undefined));
        context.story.writeToMeta(task.meta);
      } catch (e) {
        context.story.writeToMeta(task.meta);
        throw e;
      }

      // We can't use Promise.all([use(), context.testBackgroundPromise]) to catch background failures, vitest will not allow it.
      // TODO: try to switch to playwright test runner
      await context.testBackgroundPromise;
    },
  })
  .extend<BrowserContext>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest parses the destructuring pattern to resolve fixture dependencies, `{}` declares none
    browser: async ({}, use) => {
      let browser = (await state).browser;
      let context = await browser.newContext();
      await use(context);
      await context.close();
    },
    // biome-ignore lint/correctness/noEmptyPattern: vitest parses the destructuring pattern to resolve fixture dependencies, `{}` declares none
    chrome: async ({}, use) => {
      await use((await state).browser);
    },
  })
  .extend<MerchantContext>({
    merchant: async ({ ctx }, use) => {
      let merchant = await ctx.create_random_merchant();
      await use(merchant);
    },
  })
  .extend<RateContext>({
    rate_driver: async ({ ctx }, use) => {
      await use(ctx.rate_driver());
    },
  })
  .extend<ProvidersContext>(ProvidersMockParams);

import * as playwright from "playwright";
import * as config from "@/config";
import { initState } from "@/state";
import { test as base, type TestAPI } from "vitest";
import { Context } from "./context";
import type { ExtendedMerchant } from "@/entities/merchant";
import type {
  MockProviderParams,
  ProviderServerInstance,
} from "@/mock_server/api";
import { BrusnikaPayment } from "@/provider_mocks/brusnika";
import { IronpayPayment } from "@/provider_mocks/ironpay";
import type { ProviderInstance } from "@/mock_server/instance";

export const CONFIG = config.open("configuration.toml");
const state = initState(CONFIG);

type TestContext = {
  ctx: Context;
};

type BrowserContext = {
  browser: playwright.BrowserContext;
};

type MerchantContext = {
  merchant: ExtendedMerchant;
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
    browser: async ({}, use) => {
      let browser = (await state).browser;
      let context = await browser.newContext();
      await use(context);
      await context.close();
    },
  })
  .extend<MerchantContext>({
    merchant: async ({ ctx }, use) => {
      let merchant = await ctx.create_random_merchant();
      await use(merchant);
    },
  })
  .extend<ProvidersContext>(ProvidersMockParams);

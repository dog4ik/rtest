import * as playwright from "playwright";
import * as config from "@/config";
import { initState } from "@/state";
import { test as base } from "vitest";
import { Context } from "./context";

export const CONFIG = config.open("configuration.toml");
const state = initState(CONFIG);

export type TestContext = {
  ctx: Context;
};

export type BrowserContext = {
  browser: playwright.BrowserContext;
};

declare module "vitest" {
  interface TaskMeta {
    [key: string]: string;
  }
}

export const test = base
  .extend<TestContext>({
    ctx: async ({ task }, use) => {
      let context = new Context(await state);
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
  });

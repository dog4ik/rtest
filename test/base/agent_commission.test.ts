import { assert } from "vitest";
import { test } from "@/test_context";
import { describe } from "vitest";
import * as common from "@/common";
import { CONFIG } from "@/config";

describe
  .runIf(CONFIG.in_project(["reactivepay", "a2"]))
  .concurrent("agent commission tests", () => {
    test.concurrent("create agent", async ({ ctx }) => {
      let trader = await ctx.create_random_trader({
        usdt: false,
        currency: "RUB",
      });
      let agent = await ctx.create_random_agent({ traders_ids: [trader.id] });
    });
  });

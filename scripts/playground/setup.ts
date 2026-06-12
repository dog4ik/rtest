import { CONFIG } from "@/config";
import { initState, type SharedState } from "@/state";
import { Context } from "@/test_context/context";
import { traderSetttings } from "@/driver/trader";
import type { ExtendedTrader } from "@/entities/trader";
import type { ExtendedMerchant } from "@/entities/merchant";
import { log } from "./log";

const TRADER_COUNT = 5;
const MERCHANT_FLOAT_USDT = 1_000_000;
const TRADER_FLOAT_USDT = 1_000_000;

export type PlaygroundEnv = {
  ctx: Context;
  state: SharedState;
  traders: ExtendedTrader[];
  merchants: ExtendedMerchant[];
};

export async function setupPlayground(): Promise<PlaygroundEnv> {
  let state = await initState(CONFIG);
  // Context is normally provided by vitest; outside the runner we stub the two
  // test-only fields. `annotate` is pure logging and `task` is only stored.
  let ctx = new Context(
    state,
    (async (msg: string) => {
      log("annotate", msg);
      return undefined as any;
    }) as any,
    { meta: {} } as any,
  );

  log("setup", `creating ${TRADER_COUNT} traders`);
  let traders: ExtendedTrader[] = [];
  for (let i = 0; i < TRADER_COUNT; i++) {
    let trader = await ctx.create_random_trader({
      usdt: true,
      payout_hold_period: 0,
    });
    await trader.setup({ card: true, sbp: true, bank: "sberbank" });
    await trader.cashin("main", "USDT", TRADER_FLOAT_USDT);
    log("setup", `trader ${i} ready id=${trader.id}`);
    traders.push(trader);
  }

  // Routing: 3 traders shared by both merchants, 1 exclusive to each.
  //   shared = traders[0,1,2];  merchant A also gets t3;  merchant B also gets t4.
  let shared = traders.slice(0, 3);
  let traderGroups = [
    [...shared, traders[3]],
    [...shared, traders[4]],
  ];

  log("setup", "creating 2 merchants");
  let merchants: ExtendedMerchant[] = [];
  for (let i = 0; i < traderGroups.length; i++) {
    let merchant = await ctx.create_random_merchant();
    await merchant.set_settings(
      traderSetttings(
        traderGroups[i].map((t) => t.id),
        { pay_expired_minutes: 1 },
      ),
    );
    await merchant.set_commission({
      operation: "PayinRequest",
      self_rate: "10",
      provider_rate: "5",
      agent_rate: "2",
    });
    await merchant.set_commission({
      operation: "PayoutRequest",
      self_rate: "10",
      provider_rate: "5",
      agent_rate: "2",
    });
    await merchant.set_commission({
      operation: "DisputeRequest",
      self_rate: "10",
      provider_rate: "5",
      agent_rate: "2",
    });
    await merchant.cashin("USDT", MERCHANT_FLOAT_USDT);
    log(
      "setup",
      `merchant ${i} ready id=${merchant.id} traders=${traderGroups[i].map((t) => t.id).join(",")}`,
    );
    merchants.push(merchant);
  }
  await ctx.create_random_agent({
    traders_ids: traders.map(({ id }) => id),
  });

  log("setup", "done");
  return { ctx, state, traders, merchants };
}

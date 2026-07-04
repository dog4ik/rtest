import { CONFIG } from "@/config";
import { initState, type SharedState } from "@/state";
import { Context } from "@/test_context/context";
import { traderSetttings } from "@/driver/trader";
import * as common from "@/common";
import { extendTrader, type ExtendedTrader } from "@/entities/trader";
import { extendMerchant, type ExtendedMerchant } from "@/entities/merchant";
import { log } from "./log";

const ACCOUNT_SEED = 0;
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

  log("setup", `creating up to ${TRADER_COUNT} traders`);
  let traders: ExtendedTrader[] = [];
  for (let i = 0; i < TRADER_COUNT; i++) {
    let email = `${ACCOUNT_SEED}_playground-trader-${i}@mail.com`;
    let existing = await state.core_db.traderByEmailOptional(email);
    let trader: ExtendedTrader;
    if (existing) {
      // Account already provisioned on a previous run: reuse it as-is.
      trader = extendTrader(ctx, existing);
      await trader.driver.login(email, common.password);
      log("setup", `trader ${i} exists id=${trader.id}, reusing`);
    } else {
      trader = await ctx.create_random_trader({
        usdt: true,
        payout_hold_period: 0,
        email,
      });
      await trader.setup({ card: true, sbp: true, bank: "sberbank" });
      await trader.cashin("main", "USDT", TRADER_FLOAT_USDT);
      log("setup", `trader ${i} ready id=${trader.id}`);
    }
    traders.push(trader);
  }

  // Routing: 3 traders shared by both merchants, 1 exclusive to each.
  //   shared = traders[0,1,2];  merchant A also gets t3;  merchant B also gets t4.
  let shared = traders.slice(0, 3);
  let traderGroups = [
    [...shared, traders[3]],
    [...shared, traders[4]],
  ];

  log("setup", "creating up to 2 merchants");
  let merchants: ExtendedMerchant[] = [];
  for (let i = 0; i < traderGroups.length; i++) {
    let email = `${ACCOUNT_SEED}_playground-merchant-${i}@mail.com`;
    let existing = await state.core_db.merchantByEmailOptional(email);
    let merchant: ExtendedMerchant;
    if (existing) {
      // Already provisioned previously: reuse it and skip settings/commission/float.
      merchant = extendMerchant(ctx, existing);
      log("setup", `merchant ${i} exists id=${merchant.id}, reusing`);
    } else {
      merchant = await ctx.create_random_merchant({ email });
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
    }
    merchants.push(merchant);
  }

  let agentEmail = `${ACCOUNT_SEED}_playground-agent@mail.com`;
  let existingAgent = await state.core_db.agentByEmailOptional(agentEmail);
  if (existingAgent) {
    log("setup", `agent exists id=${existingAgent.id}, reusing`);
  } else {
    let agent = await ctx.create_random_agent({
      email: agentEmail,
      traders_ids: traders.map(({ id }) => id),
    });
    log("setup", `agent ready id=${agent.id}`);
  }

  log("setup", "done");
  return { ctx, state, traders, merchants };
}

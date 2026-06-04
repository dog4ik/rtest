import { assert } from "vitest";
import * as common from "@/common";
import { businessOfCoreStatus } from "@/db/business";
import { CoreDb, type CoreStatus, type Feed } from "@/db/core";
import type { Entry } from "@/db/core/entry";
import type { SharedState } from "@/state";
import { EntryValidator, BalanceValidation } from "./entries";
import { delay } from "@std/async";

export class Match<T> {
  constructor(
    public expected: T,
    public got: T,
  ) { }

  toString(): string {
    if (this.expected !== this.got) {
      return `Mismatch: expected ${this.expected}, got ${this.got}`;
    } else {
      return `Match: ${this.got}`;
    }
  }

  eq(): boolean {
    return this.expected === this.got;
  }
}

class HealthcheckResult {
  constructor(
    public status: Match<CoreStatus>,
    public amount: Match<number>,
    public wallet_state: WalletState,
    public disputes?: WalletState[],
  ) { }

  static is_valid_wallet_state(state: WalletState) {
    return (
      state.mid.valid() &&
      state.system.valid() &&
      (state.agent == undefined || state.agent.valid()) &&
      (state.trader == undefined ||
        (state.trader.main.valid() && state.trader.income.valid()))
    );
  }

  assert() {
    if (
      !this.status.eq() ||
      !this.amount.eq() ||
      !HealthcheckResult.is_valid_wallet_state(this.wallet_state) ||
      (this.disputes &&
        this.disputes.some((d) => !HealthcheckResult.is_valid_wallet_state(d)))
    ) {
      assert.fail(this.toString());
    }
  }

  toString(): string {
    let lines: string[] = [];

    lines.push("Core vs Business");
    lines.push("");

    lines.push(`Расхождение статусов: ${this.status.toString()}`);
    lines.push(`Расхождение суммы: ${this.amount.toString()}`);
    lines.push("");

    lines.push("Entries");
    lines.push("");

    lines.push("Merchant balance entries:");
    lines.push(this.wallet_state.mid.toString());
    lines.push("");

    lines.push("System balance entries:");
    lines.push(this.wallet_state.system.toString());
    lines.push("");

    if (this.wallet_state.trader === undefined) {
      lines.push(`Failed to validate trader entries: missing trader_id`);
    } else {
      lines.push("Trader balance main entries:");
      lines.push(this.wallet_state.trader.main.toString());
      lines.push("Trader balance income entries:");
      lines.push(this.wallet_state.trader.income.toString());

      if ((this.disputes?.length ?? 0) > 1) {
        lines.push(`Dispute entries:\n`);
      }
      for (let dispute of this.disputes ?? []) {
        lines.push(`Dispute mid entries:`);
        lines.push(dispute.mid.toString());

        lines.push(`Dispute trader main entries:`);
        lines.push(dispute.trader!.main.toString());

        lines.push(`Dispute trader income entries:`);
        lines.push(dispute.trader!.income.toString());
      }
    }

    if (this.wallet_state.agent === undefined) {
      lines.push(`Failed to validate agent entries: missing agent_id`);
    } else {
      lines.push("Agent balance main entries:");
      lines.push(this.wallet_state.agent.toString());
    }

    return lines.join("\n");
  }
}

export type HealthcheckOpts = {
  skip_interaction_log_card_check?: boolean;
  expect?: Partial<Feed>;
};

function check_sensitive_data(s: string | null, msg: string) {
  if (s !== null) {
    assert.notInclude(s, common.visaCard, msg);
    assert.notInclude(s, common.mastercardCard, msg);
  }
}

function feed_profile(feed: Feed) {
  if (feed.type == "RefundRequest") {
    return feed.from_profile_id;
  }
}

export async function basic_healthcheck(
  { core_db, business_db }: Pick<SharedState, "core_db" | "business_db">,
  token: string,
  opts?: HealthcheckOpts,
) {
  await delay(2_000);
  let [business, interaction_logs, core, entries] = await Promise.all([
    business_db.paymentByToken(token),
    business_db.interactionLogs(token),
    core_db.feed(token),
    core_db.entries(token),
  ]);

  if (!opts?.skip_interaction_log_card_check) {
    for (let log of interaction_logs) {
      check_sensitive_data(log.request, "interaction_logs.request");
      check_sensitive_data(log.response, "interaction_logs.response");
    }
  }
  check_sensitive_data(JSON.stringify(business.details), "payments.details");
  check_sensitive_data(
    JSON.stringify(business.gateway_details),
    "payments.gateway_details",
  );
  check_sensitive_data(
    JSON.stringify(core.payment_object),
    "feeds.payment_object",
  );
  check_sensitive_data(
    JSON.stringify(core.payment_object_json),
    "feeds.payment_object_json",
  );

  assert.isNotNull(core.target_amount, "target amount should not be null");
  assert(core.target_amount > 0, "target amount should be > 0");
  if (core.target_currency_rate !== null) {
    assert.approximately(
      core.target_amount,
      core.amount / core.target_currency_rate,
      0.01,
      "target amount should be equal to amount / rate",
    );
  }

  if (opts?.expect) {
    for (let [key, val] of Object.entries(opts.expect)) {
      assert.strictEqual(
        core[key as keyof Feed],
        val,
        `expected ${key} equality`,
      );
    }
  }

  let status = new Match(core.status, businessOfCoreStatus(business.status));
  let amount = new Match(core.amount, business.amount / 100);
  let mid_id = business.business_account_profileID ?? feed_profile(core);
  assert(mid_id, "Failed to figure out mid id to perform healthcheck");
  let disputes_validations: WalletState[] = [];
  if (core.trader_id && core.type == "PayinRequest") {
    assert(
      core.api_payment_token,
      "trader payin should have api_payment_token",
    );
    let disputes = await core_db.disputes(core.api_payment_token);
    for (let dispute of disputes) {
      disputes_validations.push(
        await validate_wallets_state(core_db, dispute, mid_id),
      );
    }
  }

  let mid_wallet_validation = await validate_mid_wallets(
    core_db,
    mid_id,
    core,
    entries,
  );
  let trader_wallet_validation = await validate_trader_wallets(
    core_db,
    core,
    entries,
  );

  let agent_wallet_validation = await validate_agent_wallets(
    core_db,
    core,
    entries,
  );
  let system_wallet_validation = await validate_system_wallets(
    core_db,
    core,
    entries,
  );
  return new HealthcheckResult(
    status,
    amount,
    {
      mid: mid_wallet_validation,
      trader: trader_wallet_validation,
      agent: agent_wallet_validation,
      system: system_wallet_validation,
    },
    disputes_validations,
  );
}

type WalletState = {
  mid: BalanceValidation;
  trader?: {
    main: BalanceValidation;
    income: BalanceValidation;
  };
  agent?: BalanceValidation;
  system: BalanceValidation;
};

async function validate_wallets_state(
  core_db: CoreDb,
  feed: Feed,
  profile_id: number,
): Promise<WalletState> {
  let entries = await core_db.entries_by_feed_id(feed.id);

  let mid_wallet_validation = await validate_mid_wallets(
    core_db,
    profile_id,
    feed,
    entries,
  );
  let trader_wallet_validation = await validate_trader_wallets(
    core_db,
    feed,
    entries,
  );
  let system_wallet_validation = await validate_system_wallets(
    core_db,
    feed,
    entries,
  );
  return {
    mid: mid_wallet_validation,
    trader: trader_wallet_validation,
    system: system_wallet_validation,
  };
}

async function validate_mid_wallets(
  core_db: CoreDb,
  mid_id: number,
  feed: Feed,
  entries: Entry[],
) {
  let currency = feed.target_currency ?? feed.currency;

  let wallets = await core_db.profileWallets(mid_id, currency ?? undefined);
  let wallet = wallets.find((w) => w.currency === currency);
  let validator = new EntryValidator(wallet?.id ?? 0);
  for (let entry of entries) {
    validator.feed_entry_mimic_ruby(entry);
  }

  return validator.validate_mid_state(
    feed.target_amount ?? feed.amount,
    feed.commission_amount ?? 0,
    feed.type,
    feed.status,
  );
}

async function validate_agent_wallets(
  core_db: CoreDb,
  feed: Feed,
  entries: Entry[],
) {
  if (!feed.agent_id) {
    return undefined;
  }
  let currency = feed.target_currency ?? feed.currency;

  let wallets = await core_db.profileWallets(
    feed.agent_id,
    currency ?? undefined,
  );
  let wallet = wallets.find((w) => w.currency === currency);
  assert(
    wallet?.id,
    `Agent wallet for target currency: ${currency} is not found`,
  );
  let validator = new EntryValidator(wallet.id);
  for (let entry of entries) {
    validator.feed_entry_mimic_ruby(entry);
  }

  return validator.validate_agent_state(
    feed.agent_commission_amount ?? 0,
    feed.status,
  );
}

async function validate_system_wallets(
  core_db: CoreDb,
  feed: Feed,
  entries: Entry[],
) {
  let currency = feed.target_currency ?? feed.currency;
  assert(currency, "feed should have currency to validate system wallet");

  let wallet = await core_db.systemWallet(currency);
  let validator = new EntryValidator(wallet.id);
  for (let entry of entries) {
    validator.feed_entry_mimic_ruby(entry);
  }

  return validator.validate_system_state(
    feed.commission_amount ?? 0,
    feed.commission_provider_amount ?? 0,
    feed.agent_commission_amount ?? 0,
    feed.type,
    feed.status,
    feed.source === "trader",
    feed.amount_in_hold ?? undefined,
  );
}

async function validate_trader_wallets(
  client: CoreDb,
  feed: Feed,
  entries: Entry[],
) {
  let trader_id = feed.trader_id;
  if (!trader_id) {
    return undefined;
  }
  let wallets = await client.profileWallets(trader_id);
  assert.lengthOf(wallets, 3, "trader should have 3 wallets");

  let main_wallet = wallets.reduce((min, item) =>
    item.id < min.id ? item : min,
  );
  let profit_wallet = wallets.reduce((max, item) =>
    item.id > max.id ? item : max,
  );

  if (!main_wallet || !profit_wallet) {
    throw Error("failed to find wallet trader wallets");
  }

  let main_validator = new EntryValidator(main_wallet.id);
  let profit_validator = new EntryValidator(profit_wallet.id);
  for (let entry of entries) {
    main_validator.feed_entry_mimic_ruby(entry);
    profit_validator.feed_entry_mimic_ruby(entry);
  }
  let main = main_validator.validate_trader_main_state(
    feed.target_amount || feed.amount,
    feed.type,
    feed.status,
    feed.amount_in_hold ?? undefined,
  );

  let income = profit_validator.validate_trader_profit_state(
    feed.commission_provider_amount ?? 0,
    feed.type,
    feed.status,
    feed.amount_in_hold ?? undefined,
  );
  return { main, income };
}

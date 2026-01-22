import * as vitest from "vitest";
import { businessOfCoreStatus, type BusinessPayment } from "@/db/business";
import { CoreDb, type CoreStatus, type Feed } from "@/db/core";
import type { Entry } from "@/db/core/entry";
import type { SharedState } from "@/state";
import { EntryValidator, ValidationSummary } from "./entries";

export class Match<T> {
  constructor(
    public expected: T,
    public got: T,
  ) {}

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
    public midWalletValidation: ValidationSummary,
    public traderWalletValidation: ValidationSummary | undefined,
  ) {}

  assert() {
    if (
      !this.status.eq() ||
      !this.amount.eq() ||
      !this.midWalletValidation.valid() ||
      (this.traderWalletValidation !== undefined &&
        !this.midWalletValidation.valid())
    ) {
      vitest.assert.fail(this.toString());
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

    if (this.midWalletValidation instanceof Error) {
      lines.push(
        `Failed to validate mid entries: ${this.midWalletValidation.message}`,
      );
    } else {
      lines.push("Merchant balance entries:");
      lines.push(this.midWalletValidation.toString());
      lines.push("");
    }

    if (this.traderWalletValidation === undefined) {
      lines.push(`Failed to validate trader entries: missing trader_id`);
    } else {
      lines.push("Trader balance entries:");
      lines.push(this.traderWalletValidation.toString());
    }

    return lines.join("\n");
  }
}

export async function basic_healthcheck(
  { core_db, business_db }: Pick<SharedState, "core_db" | "business_db">,
  token: string,
) {
  let [business, core, entries] = await Promise.all([
    business_db.paymentByToken(token),
    core_db.feed(token),
    core_db.entries(token),
  ]);
  let status = new Match(core.status, businessOfCoreStatus(business.status));
  let amount = new Match(core.amount, business.amount / 100);

  let mid_wallet_validation = await validate_mid_wallets(
    core_db,
    business,
    core,
    entries,
  );
  let trader_wallet_validation = await validate_trader_wallets(
    core_db,
    business,
    core,
    entries,
  );
  return new HealthcheckResult(
    status,
    amount,
    mid_wallet_validation,
    trader_wallet_validation,
  );
}

async function validate_mid_wallets(
  core_db: CoreDb,
  payment: BusinessPayment,
  feed: Feed,
  entries: Entry[],
) {
  let mid_id = payment.business_account_profileID;
  if (!mid_id) {
    throw Error("Missing business_account_profileID");
  }
  let operation_type = payment.operation_type;
  if (!operation_type) {
    throw Error("Missing operation type");
  }
  let wallets = await core_db.profileWallets(mid_id);
  let wallet = wallets.find(
    (w) =>
      w.currency == (feed.target_currency || feed.currency || payment.currency),
  );
  if (!wallet) {
    throw Error("find wallet with currency");
  }
  let validator = new EntryValidator(wallet.id);
  for (let entry of entries) {
    validator.feedEntryMimicRuby(entry);
  }

  return validator.validateMidState(
    feed.target_amount || feed.amount,
    feed.commission_amount || 0,
    operation_type,
    feed.status,
  );
}

async function validate_trader_wallets(
  client: CoreDb,
  payment: BusinessPayment,
  feed: Feed,
  entries: Entry[],
) {
  let trader_id = feed.trader_id;
  if (!trader_id) {
    return undefined;
  }
  let operation_type = payment.operation_type;
  if (!operation_type) {
    throw Error("Missing operation_type");
  }
  let wallets = await client.profileWallets(trader_id);

  let wallet = wallets.reduce((min, item) => (item.id < min.id ? item : min));
  if (!wallet) {
    throw Error("failed to find wallet with minimum id");
  }

  let validator = new EntryValidator(wallet.id);
  for (let entry of entries) {
    validator.feedEntryMimicRuby(entry);
  }
  return validator.validateTraderState(
    feed.target_amount || feed.amount,
    0.0,
    operation_type,
    feed.status,
  );
}

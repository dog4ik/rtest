import { type CoreStatus, CoreStatusMap, type FeedType } from "@/db/core";
import { type Entry, EntryCodes } from "@/db/core/entry";
import { Match } from ".";

/**
 * Target wallet id, basically wallet id for the entity we calculate amount changes.
 */
export class EntryValidator {
  private readonly wallet_id: number;

  // trackers
  private current_available: number;
  private current_hold: number;

  constructor(walletId: number) {
    this.wallet_id = walletId;
    this.current_available = 0;
    this.current_hold = 0;
  }

  /**
   * Mimic ruby implementation of entries.
   */
  feed_entry_mimic_ruby(entry: Entry): void {
    switch (entry.operation_code) {
      case EntryCodes.CASHIN:
      case EntryCodes.TRADER_CASHIN:
        if (entry.credit_wallet_id === this.wallet_id) {
          this.current_available += entry.amount;
        }
        break;

      case EntryCodes.HOLD:
      case EntryCodes.TRADER_HOLD:
      case EntryCodes.HOLD_COMMISSION:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_available -= entry.amount;
          this.current_hold += entry.amount;
        }
        break;

      case EntryCodes.CANCELLATION:
      case EntryCodes.TRADER_CANCELLATION:
      case EntryCodes.CANCELLATION_COMMISSION_FROM_HOLD:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_available += entry.amount;
          this.current_hold -= entry.amount;
        }
        break;

      case EntryCodes.COMMISSION:
      case EntryCodes.TRADER_COMMISSION:
      case EntryCodes.TRADER_COMMISSION_RETURN:
      case EntryCodes.AGENT_COMMISSION:
      case EntryCodes.AGENT_COMMISSION_RETURN:
        if (this.wallet_id === entry.debit_wallet_id) {
          this.current_available -= entry.amount;
        }
        if (this.wallet_id === entry.credit_wallet_id) {
          this.current_available += entry.amount;
        }
        break;

      case EntryCodes.CUSTOMER_COMMISSION:
        if (entry.credit_wallet_id === this.wallet_id) {
          this.current_available += entry.amount;
        }
        break;

      case EntryCodes.PAYMENT:
      case EntryCodes.TRADER_PAYMENT:
        if (this.wallet_id === entry.debit_wallet_id) {
          this.current_hold -= entry.amount;
        }
        if (this.wallet_id === entry.credit_wallet_id) {
          this.current_available += entry.amount;
        }
        break;

      case EntryCodes.CANCELLATION_PAYMENT:
        if (this.wallet_id === entry.debit_wallet_id) {
          this.current_hold += entry.amount;
        }
        if (this.wallet_id === entry.credit_wallet_id) {
          this.current_available -= entry.amount;
        }
        break;

      case EntryCodes.CASHOUT:
      case EntryCodes.TRADER_CASHOUT:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_hold -= entry.amount;
        }
        break;
      case EntryCodes.TRADER_TRANSFER_HOLD:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_hold -= entry.amount;
        }
        if (entry.credit_wallet_id === this.wallet_id) {
          this.current_hold += entry.amount;
        }
        break;

      // Ruby: rollover_between_wallets!(:held, :available)
      case EntryCodes.TRADER_TRANSFER_CANCELLATION:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_hold -= entry.amount;
        }
        if (entry.credit_wallet_id === this.wallet_id) {
          this.current_available += entry.amount;
        }
        break;

      case EntryCodes.REFUND:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_hold -= entry.amount;
        }
        break;

      default:
        console.warn(
          `Unhandled entry kind ${entry.operation_code} ${entry.debit_wallet_id} -> ${entry.credit_wallet_id}`,
        );
    }

    console.log(
      {
        created_at: entry.created_at,
        amount: entry.amount,
        state_amount: this.current_available,
        state_hold: this.current_hold,
      },
      `${entry.operation_code} ${entry.debit_wallet_id} -> ${entry.credit_wallet_id}`,
    );
  }

  getCurrentAmount(): number {
    return this.current_available;
  }

  getCurrentHold(): number {
    return this.current_hold;
  }

  expected_mid_state(
    target_amount: number,
    commission_amount: number,
    type: FeedType,
    status: CoreStatus,
  ): BalanceValidation {
    console.log({ wallet_id: this.wallet_id }, "Validating merchant entries");

    if (type === "PayinRequest") {
      let available_match =
        status === CoreStatusMap.approved || status === CoreStatusMap.refunded
          ? new Match(target_amount - commission_amount, this.current_available)
          : new Match(0, this.current_available);

      let hold_match = new Match(0, this.current_hold);

      return new BalanceValidation(available_match, hold_match);
    } else if (type === "PayoutRequest") {
      let available_match =
        status === CoreStatusMap.init || status === CoreStatusMap.approved
          ? new Match(
              -target_amount - commission_amount,
              this.current_available,
            )
          : new Match(0, this.current_available);

      let hold_match =
        status === CoreStatusMap.init
          ? new Match(target_amount + commission_amount, this.current_hold)
          : new Match(0, this.current_hold);

      return new BalanceValidation(available_match, hold_match);
    } else if (type === "DisputeRequest") {
      let available_match: Match<number>;
      let hold_match: Match<number>;
      if (status === CoreStatusMap.approved) {
        available_match = new Match(
          target_amount - commission_amount,
          this.current_available,
        );
        hold_match = new Match(0, this.current_hold);
      } else if (status === CoreStatusMap.declined) {
        available_match = new Match(0, this.current_available);
        hold_match = new Match(0, this.current_hold);
      } else if (status === CoreStatusMap.init) {
        available_match = new Match(0, this.current_available);
        // dispute can't be created on approved payin transaction, thus created dispute does not need to hold funds.
        hold_match = new Match(0, this.current_hold);
      } else {
        throw Error(`Unexpected dispute status: ${status}`);
      }

      return new BalanceValidation(available_match, hold_match);
    } else if (type === "RefundRequest") {
      let available_match: Match<number>;
      let hold_match: Match<number>;
      if (status === CoreStatusMap.approved) {
        available_match = new Match(
          -target_amount - commission_amount,
          this.current_available,
        );
        hold_match = new Match(0, this.current_hold);
      } else if (status === CoreStatusMap.declined) {
        available_match = new Match(0, this.current_available);
        hold_match = new Match(0, this.current_hold);
      } else if (status === CoreStatusMap.init) {
        available_match = new Match(
          -target_amount - commission_amount,
          this.current_available,
        );
        hold_match = new Match(
          target_amount + commission_amount,
          this.current_hold,
        );
      } else {
        throw Error(`Unexpected refund status: ${status}`);
      }
      return new BalanceValidation(available_match, hold_match);
    } else {
      throw new Error(`Validation of ${type} is not yet implemented`);
    }
  }

  expected_system_state(
    commission_amount: number,
    commission_provider_amount: number,
    agent_commission_amount: number,
    type: FeedType,
    status: CoreStatus,
    is_trader_payment: boolean,
    amount_in_hold?: number,
  ): BalanceValidation {
    console.log({ wallet_id: this.wallet_id }, "Validating system entries");
    // The system wallet is a clearing account: the merchant pays it the full
    // commission_amount, and it forwards the provider share to the trader
    // income wallet and the agent share to the agent wallet. What it keeps is
    // the residual. It never carries any held: a payout holds the commission
    // on the merchant wallet, and a payin's cashin/hold/payment pass-through
    // nets to zero on the system wallet.
    if (commission_amount === 0) {
      return BalanceValidation.default();
    }

    let held_match = new Match(0, this.current_hold);

    // Commission only reaches the system once the request is approved. A payin
    // refund is reflected on a separate RefundRequest feed, so the payin feed
    // still shows the collected commission (same as approved).
    let earns_commission =
      status === CoreStatusMap.approved ||
      (type === "PayinRequest" && status === CoreStatusMap.refunded);

    if (!earns_commission) {
      return new BalanceValidation(
        new Match(0, this.current_available),
        held_match,
      );
    }

    // Provider commission flows out of the system to the trader income wallet
    // only for a trader-sourced transaction (the TRADER_COMMISSION entry is
    // gated on `source == 'trader'`). commission_provider_amount is populated on
    // the feed even without a trader, but no entry moves it, so it stays on the
    // system wallet. It is also not forwarded for a payout still inside its
    // trader hold period (deferred to PayoutTransferWorker) or for a refund
    // (confirm pays no trader commission at all).
    let provider_deferred =
      type === "PayoutRequest" && (amount_in_hold ?? 0) > 0;
    let provider_out =
      !is_trader_payment || type === "RefundRequest" || provider_deferred
        ? 0
        : commission_provider_amount;

    let residual = commission_amount - provider_out - agent_commission_amount;

    return new BalanceValidation(
      new Match(residual, this.current_available),
      held_match,
    );
  }

  expected_agent_state(
    commission_amount: number,
    status: CoreStatus,
  ): BalanceValidation {
    console.log({ wallet_id: this.wallet_id }, "Validating agent entries");
    if (status === CoreStatusMap.approved) {
      let available = new Match(commission_amount, this.current_available);
      let held = new Match(0, this.current_hold);
      return new BalanceValidation(available, held);
    } else {
      let available = new Match(0, this.current_available);
      let held = new Match(0, this.current_hold);
      return new BalanceValidation(available, held);
    }
  }
}

/**
 * Expected state of all three trader wallets for a feed.
 *
 * When the core claws funds back from the trader (payout decline, dispute) a
 * wallet with insufficient balance only gives up what it has and the shortfall
 * is drawn from the deposit wallet (which may go negative). The split is
 * arbitrary, so per-wallet deltas are validated as ranges and the exact amount
 * is enforced on the sum across the wallets.
 */
export function expected_trader_state(
  main: EntryValidator,
  income: EntryValidator,
  deposit: EntryValidator,
  target_amount: number,
  comission_amount: number,
  type: FeedType,
  status: CoreStatus,
  amount_in_hold: number | undefined,
): TraderBalanceValidation {
  let main_available = main.getCurrentAmount();
  let main_hold = main.getCurrentHold();
  let income_available = income.getCurrentAmount();
  let income_hold = income.getCurrentHold();
  let deposit_available = deposit.getCurrentAmount();
  let deposit_hold = deposit.getCurrentHold();

  let sum_available = main_available + income_available + deposit_available;
  let sum_hold = main_hold + income_hold + deposit_hold;

  let exact = (
    main_amounts: [number, number],
    income_amounts: [number, number],
  ) => {
    let [main_expected_available, main_expected_hold] = main_amounts;
    let [income_expected_available, income_expected_hold] = income_amounts;
    return new TraderBalanceValidation(
      new BalanceValidation(
        new Match(main_expected_available, main_available),
        new Match(main_expected_hold, main_hold),
      ),
      new BalanceValidation(
        new Match(income_expected_available, income_available),
        new Match(income_expected_hold, income_hold),
      ),
      new BalanceValidation(
        new Match(0, deposit_available),
        new Match(0, deposit_hold),
      ),
      new Match(
        main_expected_available + income_expected_available,
        sum_available,
      ),
      new Match(main_expected_hold + income_expected_hold, sum_hold),
    );
  };

  if (type === "PayinRequest") {
    let main_expected_available =
      status === CoreStatusMap.approved || status === CoreStatusMap.init
        ? -target_amount
        : 0;
    let main_expected_hold = status === CoreStatusMap.init ? target_amount : 0;
    let income_expected_available =
      status === CoreStatusMap.approved ? comission_amount : 0;
    return exact(
      [main_expected_available, main_expected_hold],
      [income_expected_available, 0],
    );
  } else if (type === "PayoutRequest") {
    if (
      amount_in_hold !== undefined &&
      amount_in_hold > 0 &&
      status === CoreStatusMap.approved
    ) {
      // Profit wallet commission is not being held, for simplity.
      return exact([0, target_amount], [0, 0]);
    } else if (status === CoreStatusMap.approved) {
      return exact([target_amount, 0], [comission_amount, 0]);
    } else if (status === CoreStatusMap.declined) {
      // The decline reverses the approval credits (payout amount from main,
      // provider commission from income), but each reversal may be drawn
      // partially or fully from the deposit wallet instead.
      return new TraderBalanceValidation(
        new BalanceValidation(
          new RangeMatch(0, target_amount, main_available),
          new Match(0, main_hold),
        ),
        new BalanceValidation(
          new RangeMatch(0, comission_amount, income_available),
          new Match(0, income_hold),
        ),
        new BalanceValidation(
          new RangeMatch(
            -(target_amount + comission_amount),
            0,
            deposit_available,
          ),
          new Match(0, deposit_hold),
        ),
        new Match(0, sum_available),
        new Match(0, sum_hold),
      );
    } else {
      return exact([0, 0], [0, 0]);
    }
  } else if (type === "DisputeRequest") {
    if (status === CoreStatusMap.approved) {
      // The dispute amount is subtracted from the main wallet, with any
      // shortfall drawn from the deposit wallet.
      return new TraderBalanceValidation(
        new BalanceValidation(
          new RangeMatch(-target_amount, 0, main_available),
          new Match(0, main_hold),
        ),
        new BalanceValidation(
          new Match(comission_amount, income_available),
          new Match(0, income_hold),
        ),
        new BalanceValidation(
          new RangeMatch(-target_amount, 0, deposit_available),
          new Match(0, deposit_hold),
        ),
        new Match(-target_amount + comission_amount, sum_available),
        new Match(0, sum_hold),
      );
    } else if (status === CoreStatusMap.declined) {
      return exact([0, 0], [0, 0]);
    } else if (status === CoreStatusMap.init) {
      // The dispute hold itself splits between main and deposit wallets.
      return new TraderBalanceValidation(
        new BalanceValidation(
          new RangeMatch(-target_amount, 0, main_available),
          new RangeMatch(0, target_amount, main_hold),
        ),
        new BalanceValidation(
          new Match(0, income_available),
          new Match(0, income_hold),
        ),
        new BalanceValidation(
          new RangeMatch(-target_amount, 0, deposit_available),
          new RangeMatch(0, target_amount, deposit_hold),
        ),
        new Match(-target_amount, sum_available),
        new Match(target_amount, sum_hold),
      );
    } else {
      throw Error(`Unexpected dispute status: ${status}`);
    }
  } else {
    throw new Error(`Validation of ${type} is not yet implemented`);
  }
}

export class TraderBalanceValidation {
  constructor(
    public readonly main: BalanceValidation,
    public readonly income: BalanceValidation,
    public readonly deposit: BalanceValidation,
    public readonly sum_available: Match<number>,
    public readonly sum_held: Match<number>,
  ) {}

  valid() {
    return (
      this.main.valid() &&
      this.income.valid() &&
      this.deposit.valid() &&
      this.sum_available.eq() &&
      this.sum_held.eq()
    );
  }

  toString() {
    return (
      `Trader balance main entries:\n${this.main.toString()}\n` +
      `Trader balance income entries:\n${this.income.toString()}\n` +
      `Trader balance deposit entries:\n${this.deposit.toString()}\n` +
      `Trader balance sum across wallets:\n` +
      `Изменение баланса: ${this.sum_available.toString()}\n` +
      `Изменение холда: ${this.sum_held.toString()}`
    );
  }
}

/**
 * Common shape of `Match` and `RangeMatch`.
 */
export type NumberMatch = {
  eq(): boolean;
  toString(): string;
};

export class RangeMatch {
  constructor(
    public min: number,
    public max: number,
    public got: number,
  ) {}

  toString(): string {
    if (!this.eq()) {
      return `Mismatch: expected [${this.min}..${this.max}], got ${this.got}`;
    } else {
      return `Match: ${this.got} in [${this.min}..${this.max}]`;
    }
  }

  eq(): boolean {
    // Same float64 tolerance as Match.eq
    return this.got >= this.min - 1e-9 && this.got <= this.max + 1e-9;
  }
}

export class BalanceValidation {
  constructor(
    public readonly available_match: NumberMatch,
    public readonly hold_match: NumberMatch,
  ) {}

  toString() {
    return (
      `Изменение баланса: ${this.available_match.toString()}\n` +
      `Изменение холда: ${this.hold_match.toString()}`
    );
  }

  valid() {
    return this.available_match.eq() && this.hold_match.eq();
  }

  static default() {
    return new BalanceValidation(new Match(0, 0), new Match(0, 0));
  }
}

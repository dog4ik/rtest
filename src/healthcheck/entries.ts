import { EntryCodes, type Entry } from "@/db/core/entry";
import { Match } from ".";
import { CoreStatusMap, type CoreStatus, type FeedType } from "@/db/core";
import { hash } from "crypto";

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

  validate_mid_state(
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

  validate_system_state(
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

  validate_agent_state(
    commission_amount: number,
    status: CoreStatus,
  ): BalanceValidation {
    console.log({ wallet_id: this.wallet_id }, "Validating agent entries");
    if (status == CoreStatusMap.approved) {
      let available = new Match(commission_amount, this.current_available);
      let held = new Match(0, this.current_hold);
      return new BalanceValidation(available, held);
    } else {
      let available = new Match(0, this.current_available);
      let held = new Match(0, this.current_hold);
      return new BalanceValidation(available, held);
    }
  }

  validate_trader_main_state(
    target_amount: number,
    type: FeedType,
    status: CoreStatus,
    amount_in_hold: number | undefined,
  ): BalanceValidation {
    console.log(
      { wallet_id: this.wallet_id },
      "Validating trader main entries",
    );

    if (type === "PayinRequest") {
      let available_match =
        status === CoreStatusMap.approved || status === CoreStatusMap.init
          ? new Match(-target_amount, this.current_available)
          : new Match(0, this.current_available);

      let hold_match =
        status === CoreStatusMap.init
          ? new Match(target_amount, this.current_hold)
          : new Match(0, this.current_hold);

      return new BalanceValidation(available_match, hold_match);
    } else if (type === "PayoutRequest") {
      let available_match: Match<number>;
      let hold_match: Match<number>;

      if (
        amount_in_hold !== undefined &&
        amount_in_hold > 0 &&
        status === CoreStatusMap.approved
      ) {
        available_match = new Match(0, this.current_available);
        hold_match = new Match(target_amount, this.current_hold);
      } else {
        available_match =
          status === CoreStatusMap.approved
            ? new Match(target_amount, this.current_available)
            : new Match(0, this.current_available);
        hold_match = new Match(0, this.current_hold);
      }

      return new BalanceValidation(available_match, hold_match);
    } else if (type === "DisputeRequest") {
      let available_match: Match<number>;
      let hold_match: Match<number>;
      if (status === CoreStatusMap.approved) {
        available_match = new Match(-target_amount, this.current_available);
        hold_match = new Match(0, this.current_hold);
      } else if (status === CoreStatusMap.declined) {
        available_match = new Match(0, this.current_available);
        hold_match = new Match(0, this.current_hold);
      } else if (status === CoreStatusMap.init) {
        available_match = new Match(-target_amount, this.current_available);
        hold_match = new Match(target_amount, this.current_hold);
      } else {
        throw Error(`Unexpected dispute status: ${status}`);
      }

      return new BalanceValidation(available_match, hold_match);
    } else {
      throw new Error(`Validation of ${type} is not yet implemented`);
    }
  }

  validate_trader_profit_state(
    comission_amount: number,
    type: FeedType,
    status: CoreStatus,
    amount_in_hold: number | undefined,
  ): BalanceValidation {
    console.log(
      { wallet_id: this.wallet_id },
      "Validating trader profit entries",
    );

    if (type === "PayinRequest") {
      let available_match =
        status === CoreStatusMap.approved
          ? new Match(comission_amount, this.current_available)
          : new Match(0, this.current_available);

      let hold_match = new Match(0, this.current_hold);

      return new BalanceValidation(available_match, hold_match);
    } else if (type === "PayoutRequest") {
      let available_match: Match<number>;
      let hold_match: Match<number>;
      if (
        amount_in_hold !== undefined &&
        amount_in_hold > 0 &&
        status === CoreStatusMap.approved
      ) {
        available_match = new Match(0, this.current_available);
        // Profit wallet commission is not being held, for simplity.
        hold_match = new Match(0, this.current_hold);
      } else {
        available_match =
          status === CoreStatusMap.approved
            ? new Match(comission_amount, this.current_available)
            : new Match(0, this.current_available);

        hold_match = new Match(0, this.current_hold);
      }
      return new BalanceValidation(available_match, hold_match);
    } else if (type === "DisputeRequest") {
      let available_match =
        status === CoreStatusMap.approved
          ? new Match(comission_amount, this.current_available)
          : new Match(0, this.current_available);

      let hold_match = new Match(0, this.current_hold);
      return new BalanceValidation(available_match, hold_match);
    } else {
      throw new Error(`Validation of ${type} is not yet implemented`);
    }
  }
}

export class BalanceValidation {
  constructor(
    public readonly available_match: Match<number>,
    public readonly hold_match: Match<number>,
  ) { }

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

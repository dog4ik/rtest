import { EntryCodes, type Entry } from "@/db/core/entry";
import { Match } from ".";
import type { OperationType } from "@/db/business";
import { CoreStatusMap, type CoreStatus } from "@/db/core";

/**
 * Target wallet id, basically wallet id for the entity we calculate amount changes.
 */
export class EntryValidator {
  private readonly wallet_id: number;

  // trackers
  private current_amount: number;
  private current_hold: number;

  constructor(walletId: number) {
    this.wallet_id = walletId;
    this.current_amount = 0;
    this.current_hold = 0;
  }

  /**
   * Mimic ruby implementation of entries.
   */
  feedEntryMimicRuby(entry: Entry): void {
    switch (entry.operation_code) {
      case EntryCodes.CASHIN:
      case EntryCodes.TRADER_CASHIN:
        if (entry.credit_wallet_id === this.wallet_id) {
          this.current_amount += entry.amount;
        }
        break;

      case EntryCodes.HOLD:
      case EntryCodes.TRADER_HOLD:
      case EntryCodes.HOLD_COMMISSION:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_amount -= entry.amount;
          this.current_hold += entry.amount;
        }
        break;

      case EntryCodes.CANCELLATION:
      case EntryCodes.TRADER_CANCELLATION:
      case EntryCodes.CANCELLATION_COMMISSION_FROM_HOLD:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_amount += entry.amount;
          this.current_hold -= entry.amount;
        }
        break;

      case EntryCodes.COMMISSION:
      case EntryCodes.TRADER_COMMISSION:
      case EntryCodes.AGENT_COMMISSION:
      case EntryCodes.AGENT_COMMISSION_RETURN:
        // TODO: all these calculation should be performed on rational numbers
        if (this.wallet_id === entry.debit_wallet_id) {
          this.current_amount -= entry.amount;
        }
        if (this.wallet_id === entry.credit_wallet_id) {
          this.current_amount += entry.amount;
        }
        break;

      case EntryCodes.CUSTOMER_COMMISSION:
        if (entry.credit_wallet_id === this.wallet_id) {
          this.current_amount += entry.amount;
        }
        break;

      case EntryCodes.PAYMENT:
      case EntryCodes.TRADER_PAYMENT:
        // TODO: all these calculation should be rational
        if (this.wallet_id === entry.debit_wallet_id) {
          this.current_hold -= entry.amount;
        }
        if (this.wallet_id === entry.credit_wallet_id) {
          this.current_amount += entry.amount;
        }
        break;

      case EntryCodes.CANCELLATION_PAYMENT:
        // TODO: all these calculation should be rational
        if (this.wallet_id === entry.debit_wallet_id) {
          this.current_hold += entry.amount;
        }
        if (this.wallet_id === entry.credit_wallet_id) {
          this.current_amount -= entry.amount;
        }
        break;

      case EntryCodes.CASHOUT:
      case EntryCodes.TRADER_CASHOUT:
        if (entry.debit_wallet_id === this.wallet_id) {
          this.current_hold -= entry.amount;
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
        state_amount: this.current_amount,
        state_hold: this.current_hold,
      },
      `${entry.operation_code} ${entry.debit_wallet_id} -> ${entry.credit_wallet_id}`,
    );
  }

  getCurrentAmount(): number {
    return this.current_amount;
  }

  getCurrentHold(): number {
    return this.current_hold;
  }

  validateMidState(
    target_amount: number,
    commission_amount: number,
    operation_type: OperationType,
    status: CoreStatus,
  ): ValidationSummary {
    console.log({ wallet_id: this.wallet_id }, "Validating merchant entries");

    if (operation_type === "pay") {
      let available_match =
        status === CoreStatusMap.approved
          ? new Match(target_amount - commission_amount, this.current_amount)
          : new Match(0, this.current_amount);

      let hold_match = new Match(0, this.current_hold);

      return new ValidationSummary(available_match, hold_match);
    } else if (operation_type === "payout") {
      let available_match =
        status === CoreStatusMap.init || status === CoreStatusMap.approved
          ? new Match(-target_amount - commission_amount, this.current_amount)
          : new Match(0, this.current_amount);

      let hold_match =
        status === CoreStatusMap.init
          ? new Match(target_amount + commission_amount, this.current_hold)
          : new Match(0, this.current_hold);

      return new ValidationSummary(available_match, hold_match);
    } else {
      throw new Error(`Validation of ${operation_type} is not yet implemented`);
    }
  }

  validateTraderState(
    target_amount: number,
    trader_commission: number,
    operation_type: OperationType,
    status: CoreStatus,
  ): ValidationSummary {
    console.log({ wallet_id: this.wallet_id }, "Validating trader entries");

    if (operation_type === "pay") {
      let available_match =
        status === CoreStatusMap.approved
          ? new Match(-target_amount, this.current_amount)
          : new Match(0, this.current_amount);

      let hold_match =
        status === CoreStatusMap.init
          ? new Match(target_amount, this.current_hold)
          : new Match(0, this.current_hold);

      return new ValidationSummary(available_match, hold_match);
    } else if (operation_type === "payout") {
      let available_match =
        status === CoreStatusMap.approved
          ? new Match(-(target_amount - trader_commission), this.current_amount)
          : new Match(0, this.current_amount);

      let hold_match = new Match(0, this.current_hold);

      return new ValidationSummary(available_match, hold_match);
    } else {
      throw new Error(`Validation of ${operation_type} is not yet implemented`);
    }
  }
}

export class ValidationSummary {
  constructor(
    public readonly available_match: Match<number>,
    public readonly hold_match: Match<number>,
  ) {}

  toString() {
    return (
      `Изменение баланса: ${this.available_match.toString()}\n` +
      `Изменение холда: ${this.hold_match.toString()}`
    );
  }

  valid(): boolean {
    return this.available_match.eq() && this.hold_match.eq();
  }
}

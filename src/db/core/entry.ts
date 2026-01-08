import { z } from "zod";

export const EntryCodes = {
  PAYMENT: 1,
  HOLD: 2,
  CASHIN: 3,
  COMMISSION: 4,
  CASHOUT: 5,
  REFUND: 6,
  CANCELLATION: 7,
  CUSTOMER_COMMISSION: 8,
  CANCELLATION_PAYMENT: 9,
  CANCELLATION_COMMISSION: 10,
  TRADER_PAYMENT: 11,
  TRADER_HOLD: 12,
  TRADER_CASHIN: 13,
  TRADER_COMMISSION: 14,
  TRADER_CASHOUT: 15,
  TRADER_CANCELLATION: 17,
  AGENT_COMMISSION: 18,
  AGENT_COMMISSION_RETURN: 19,
  HOLD_COMMISSION: 20,
  CANCELLATION_COMMISSION_FROM_HOLD: 21,
};

export const EntrySchema = z.object({
  amount: z.number(),
  operation_code: z.number(),
  debit_wallet_id: z.number(),
  credit_wallet_id: z.number(),
  created_at: z.date(),
});
export type Entry = z.infer<typeof EntrySchema>;

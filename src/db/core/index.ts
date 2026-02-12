import { z } from "zod";
import { Db, sqlProjection } from "..";
import type { Pool } from "pg";
import type { Project } from "@/project";
import { EntrySchema } from "./entry";

export const CoreStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(4),
]);

export const CoreStatusMap = {
  init: 0,
  approved: 1,
  declined: 2,
} as const;

export type CoreStatus = z.infer<typeof CoreStatusSchema>;

export const TraderSchema = z.object({
  id: z.number(),
  default_currency: z.string(),
  traffic_blocked: z.string().nullable(),
  company_name: z.string(),
});
export type Trader = z.infer<typeof TraderSchema>;
export const TraderQuery = sqlProjection("profiles", TraderSchema);

export const BankAccountSchema = z.object({
  id: z.number(),
  profile_id: z.number(),
  currency: z.string().nullable(),
  kind: z.string().nullable(),
});
export type BankAccount = z.infer<typeof BankAccountSchema>;
export const BankAccountQuery = sqlProjection(
  "bank_accounts",
  BankAccountSchema,
);

export const MerchantSchema = z.object({
  id: z.number(),
  merchant_private_key: z.string(),
  company_name: z.string(),
  locale: z.string().optional().nullable(),
  merchant_callback: z.string().optional().nullable(),
});
export type Merchant = z.infer<typeof MerchantSchema>;
export const MerchantQuery = sqlProjection("profiles", MerchantSchema);

export const WalletSchema = z.object({
  id: z.int(),
  currency: z.string().nullable(),
  available: z.number(),
  held: z.number(),
});
export type Wallet = z.infer<typeof WalletSchema>;
export const WalletQuery = sqlProjection("wallets", WalletSchema);

export const FeedTypeSchema = z.enum([
  "CashinRequest",
  "PayinRequest",
  "CashoutRequest",
  "PayoutRequest",
  "DisputeRequest",
  "RefundRequest",
]);
export type FeedType = z.infer<typeof FeedTypeSchema>;

const FeedFields = {
  id: z.int(),
  api_payment_token: z.string().nullable(),
  reference_token: z.string().nullable(),
  amount: z.float64(),
  target_amount: z.float64().nullable(),
  currency: z.string().nullable(),
  target_currency: z.string().nullable(),
  status: CoreStatusSchema,
  type: FeedTypeSchema,
  to_profile_id: z.int(),
  from_profile_id: z.int(),
  trader_id: z.coerce.number().nullable(),
  agent_id: z.int().nullable(),
  source: z.string().nullable(),
  payment_object: z.object().nullable(),
  payment_object_json: z.object().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
  commission_amount: z.float64().nullable(),
  commission_provider_amount: z.float64().nullable(),
};

export const FeedSchema = z.object(FeedFields);
export type Feed = z.infer<typeof FeedSchema>;
export const FeedQuery = sqlProjection("feeds", FeedSchema);

export class CoreDb extends Db {
  constructor(
    pool: Pool,
    private project: Project,
  ) {
    super(pool);
  }

  async merchantByEmail(email: string) {
    let query = `select ${MerchantQuery.select(this.project)} from profiles where profiles.email = '${email}'`;
    return await this.fetch_one(MerchantSchema, query);
  }

  async traderByEmail(email: string) {
    let query = `select ${TraderQuery.select(this.project)} from profiles where profiles.email = '${email}'`;
    return await this.fetch_one(TraderSchema, query);
  }

  async profileWallets(mid: number) {
    let query = `select ${WalletQuery.select(this.project)} from wallets where wallets.profile_id = '${mid}'`;
    return await this.fetch_all(WalletQuery.schema, query);
  }

  async profileWallet(mid: number, currency: string) {
    let query = `select ${WalletQuery.select(this.project)} from wallets where wallets.profile_id = '${mid}' and currency = '${currency}'`;
    return await this.fetch_one(WalletQuery.schema, query);
  }

  async feed(token: string) {
    let query = `select ${FeedQuery.select(this.project)} from feeds where feeds.api_payment_token = '${token}'`;
    return await this.fetch_one(FeedQuery.schema, query);
  }

  async disputes(token: string) {
    let query = `select ${FeedQuery.select(this.project)}, disputes.id as "dispute_id", disputes.amount as "dispute_amount" from feeds
join disputes on disputes.feed_id = feeds.id
where feeds.reference_token = '${token}'`;
    return await this.fetch_all(
      z.object({
        ...FeedFields,
        dispute_id: z.int(),
        dispute_amount: z.number(),
      }),
      query,
    );
  }

  async bank_accounts(profile_id: number) {
    let query = `select ${BankAccountQuery.select(this.project)} from bank_accounts where bank_accounts.profile_id = '${profile_id}'`;
    return await this.fetch_all(BankAccountQuery.schema, query);
  }

  async entries(token: string) {
    let entrySelect =
      "SELECT entries.amount, entries.operation_code, entries.debit_wallet_id, entries.credit_wallet_id, entries.created_at FROM feeds \
JOIN wallet_requests ON wallet_requests.feed_id = feeds.id \
JOIN entries ON entries.wallet_request_id = wallet_requests.id";

    let query = `${entrySelect} where feeds.api_payment_token = '${token}' order by entries.created_at desc`;
    return await this.fetch_all(EntrySchema, query);
  }

  async last_session_code() {
    let query =
      "select confirm_code from sessions where confirm_code != '' order by created_at desc limit 1";
    return await this.fetch_one(
      z.object({ confirm_code: z.coerce.number() }),
      query,
    );
  }
}

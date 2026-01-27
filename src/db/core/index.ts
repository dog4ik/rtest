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

export const FeedSchema = z.object({
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
  trader_id: z.int().nullable(),
  agent_id: z.int().nullable(),
  source: z.string().nullable(),
  payment_object: z.object().nullable(),
  payment_object_json: z.object().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
  commission_amount: z.float64().nullable(),
  commission_provider_amount: z.float64().nullable(),
});
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

  async entries(token: string) {
    let entrySelect =
      "SELECT entries.amount, entries.operation_code, entries.debit_wallet_id, entries.credit_wallet_id, entries.created_at FROM feeds \
JOIN wallet_requests ON wallet_requests.feed_id = feeds.id \
JOIN entries ON entries.wallet_request_id = wallet_requests.id";

    let query = `${entrySelect} where feeds.api_payment_token = '${token}' order by entries.created_at desc`;
    return await this.fetch_all(EntrySchema, query);
  }
}

import { z } from "zod";
import { Db, sqlProjection } from ".";
import type { Pool } from "pg";
import type { Project } from "@/project";

export const CoreStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);

export const CoreStatusMap = {
  pending: 0,
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
  currency: z.string().optional(),
  available: z.number(),
  held: z.number(),
});
export type Wallet = z.infer<typeof WalletSchema>;
export const WalletQuery = sqlProjection("wallets", WalletSchema);

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

  async merchantWallets(mid: number) {
    let query = `select ${WalletQuery.select(this.project)} from wallets where wallets.profile_id = '${mid}'`;
    return await this.fetch_all(WalletQuery.schema, query);
  }

  async merchantWallet(mid: number, currency: string) {
    let query = `select ${WalletQuery.select(this.project)} from wallets where wallets.profile_id = '${mid}' and currency = '${currency}'`;
    return await this.fetch_one(WalletQuery.schema, query);
  }
}

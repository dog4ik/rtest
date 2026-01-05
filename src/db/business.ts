import { z } from "zod";
import type { Pool } from "pg";
import { Db, sqlProjection } from ".";
import type { Project } from "@/project";

export const OperationTypeSchema = z.enum(["pay", "payout", "refund"]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

export const BusinessStatusSchema = z
  .enum([
    "init",
    "processing",
    "pending",
    "approved",
    "declined",
    "refunded",
    "expired",
  ])
  .default("init");

export type BusinessStatus = z.infer<typeof BusinessPaymentSchema>;

export const BusinessPaymentSchema = z.object({
  token: z.string(),
  amount: z.number(),
  status: BusinessStatusSchema,
  business_account_profileID: z.string().optional(), // renamed from business_account_profileID
  gateway_token: z.string().optional(),
  order_number: z.string().optional(),
  product: z.string().optional(),
  operation_type: OperationTypeSchema.optional(),
  declination_reason: z.string().optional(),
  gatewayable_type: z.string().optional(),
  gateway_alias: z.string().optional(),
  gateway_amount: z.number().optional(),
  gateway_currency: z.string().optional(),
  currency: z.string(),
  // created_at: z.string().datetime(),
  // updated_at: z.string().datetime(),
  extra_return_param: z.string().optional(),
});

type BusinessPaymentData = z.infer<typeof BusinessPaymentSchema>;

function extendedBusinessPayment(payment: BusinessPaymentData) {
  return {
    ...payment,
    async feed() {
      console.log(this.business_account_profileID);
    },
  };
}

const BusinessPaymentProjection = sqlProjection(
  "payments",
  BusinessPaymentSchema,
);

export class BusinessDb extends Db {
  constructor(
    pool: Pool,
    private project: Project,
  ) {
    super(pool);
  }

  async paymentByToken(token: string) {
    let query = `select ${BusinessPaymentProjection.select(this.project)} from payments where token = ${token}`;
    return await this.fetch_one(BusinessPaymentSchema, query);
  }
}

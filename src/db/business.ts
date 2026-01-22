import { z } from "zod";
import type { Pool } from "pg";
import { Db, sqlProjection } from ".";
import type { Project } from "@/project";
import { CoreStatusMap, type CoreStatus } from "./core";

export const OperationTypeSchema = z.enum(["pay", "payout", "refund", "dispute"]);
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

export function businessOfCoreStatus(status: BusinessStatus): CoreStatus {
  if ((["pending", "init"] as BusinessStatus[]).includes(status)) {
    return CoreStatusMap.init;
  } else if (status == "approved") {
    return CoreStatusMap.approved;
  } else if ((["declined", "expired"] as BusinessStatus[]).includes(status)) {
    return CoreStatusMap.declined;
  } else {
    throw Error(`Unhandled business status: ${status}`);
  }
}

export type BusinessStatus = z.infer<typeof BusinessStatusSchema>;
export type PrimeBusinessStatus = "approved" | "declined" | "pending";

export const BusinessPaymentSchema = z.object({
  token: z.string(),
  amount: z.coerce.number(),
  status: BusinessStatusSchema,
  business_account_profileID: z.coerce.number().nullable(),
  gateway_token: z.string().nullable(),
  order_number: z.string().nullable(),
  product: z.string().nullable(),
  operation_type: OperationTypeSchema.nullable(),
  declination_reason: z.string().nullable(),
  gatewayable_type: z.string().nullable(),
  gateway_alias: z.string().nullable(),
  gateway_amount: z.coerce.number().nullable(),
  gateway_currency: z.string().nullable(),
  currency: z.string(),
  // created_at: z.string().datetime(),
  // updated_at: z.string().datetime(),
  extra_return_param: z.string().nullable(),
});
const BusinessPaymentProjection = sqlProjection(
  "payments",
  BusinessPaymentSchema,
);

export const BusinessMerchantSettingsSchema = z.object({
  created_at: z.date(),
  updated_at: z.date(),
});
const BusinessMerchantSettings = sqlProjection(
  "merchant_settings",
  BusinessMerchantSettingsSchema,
);

export type BusinessPayment = z.infer<typeof BusinessPaymentSchema>;

function extendedBusinessPayment(payment: BusinessPayment) {
  return {
    ...payment,
    async feed() {
      console.log(this.business_account_profileID);
    },
  };
}

export class BusinessDb extends Db {
  constructor(
    pool: Pool,
    private project: Project,
  ) {
    super(pool);
  }

  async paymentByToken(token: string) {
    let query = `select ${BusinessPaymentProjection.select(this.project)} from payments where token = '${token}'`;
    return await this.fetch_one(BusinessPaymentSchema, query);
  }

  async paymentByGwToken(token: string) {
    let query = `select ${BusinessPaymentProjection.select(this.project)} from payments where gateway_token = '${token}'`;
    return await this.fetch_one(BusinessPaymentSchema, query);
  }

  async settings_last_updated_at(external_id: number) {
    let query = `
select merchant_providers.updated_at as "latest_update" from merchant_settings
join merchant_currencies on merchant_currencies.merchant_setting_id = merchant_settings.id
join merchant_providers on merchant_providers.merchant_currency_id = merchant_currencies.id
left join merchant_gateways on merchant_gateways.id = merchant_providers.current_gateway_id
where merchant_settings.external_id = ${external_id} order by merchant_providers.updated_at desc limit 1;
`;

    return await this.fetch_one(
      z.object({ latest_update: z.date() }),
      query,
    ).then((r) => r.latest_update);
  }
}

import { delay } from "@std/async";
import type { Pool } from "pg";
import { z } from "zod";
import { PROJECT } from "@/config";
import type { Project } from "@/project";
import { Db, sqlProjection } from ".";
import { type CoreStatus, CoreStatusMap } from "./core";

export const OperationTypeSchema = z.enum([
  "pay",
  "payout",
  "refund",
  "dispute",
]);
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
  } else if (status === "approved") {
    return CoreStatusMap.approved;
  } else if ((["declined", "expired"] as BusinessStatus[]).includes(status)) {
    return CoreStatusMap.declined;
  } else if (status === "refunded") {
    return CoreStatusMap.refunded;
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
  details: z.object().nullable(),
  gateway_details: z.object().nullable(),
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

export const BusinessInteractionLog = z.object({
  token: z.string().nullable(),
  kind: z.string().nullable(),
  request: z.string().nullable(),
  response: z.string().nullable(),
  duration: z.string().nullable(),
  // status is not guaranteed to be a number, disputes show status as a string
  status: z.coerce.string(),
  direction: z.enum(["in", "out"]),
});

const BusinessInteractionLogProjection = sqlProjection(
  "interaction_logs",
  BusinessInteractionLog,
);

/** Revision of a merchant that business has not synced yet. */
const SETTINGS_NOT_SYNCED = "0@never";
const SETTINGS_POLL_MS = 100;
/**
 * Business writes the settings tree row by row, so a revision is only final
 * once it stops moving for this long.
 */
const SETTINGS_SETTLE_MS = 300;
const SETTINGS_SYNC_TIMEOUT_MS = 15_000;
/** Blind wait for the projects whose settings tree we can not query. */
const SETTINGS_SYNC_SLEEP_MS = 6_000;

export const BusinessMerchantSettingsSchema = z.object({
  created_at: z.date(),
  updated_at: z.date(),
});

export type BusinessPayment = z.infer<typeof BusinessPaymentSchema>;

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

  async interactionLogs(token: string) {
    let query = `select ${BusinessInteractionLogProjection.select(this.project)} from interaction_logs where token = '${token}' order by created_at asc`;
    return await this.fetch_all(BusinessInteractionLog, query);
  }

  async paymentByGwToken(token: string) {
    let query = `select ${BusinessPaymentProjection.select(this.project)} from payments where gateway_token = '${token}'`;
    return await this.fetch_one(BusinessPaymentSchema, query);
  }

  async settings_revision(external_id: number): Promise<string> {
    let query = `
select count(*)::text || '@' || coalesce(to_char(max(merchant_providers.updated_at), 'YYYY-MM-DD HH24:MI:SS.US'), 'never') as revision
from merchant_settings
join merchant_currencies on merchant_currencies.merchant_setting_id = merchant_settings.id
join merchant_providers on merchant_providers.merchant_currency_id = merchant_currencies.id
where merchant_settings.external_id = '${external_id}';
`;

    return await this.fetch_one(z.object({ revision: z.string() }), query).then(
      (r) => r.revision,
    );
  }

  /**
   * Wait until business applies a settings change.
   */
  async wait_for_settings_update(
    external_id: number,
    previous_revision: string = SETTINGS_NOT_SYNCED,
  ) {
    if (
      PROJECT === "paygateway" ||
      PROJECT === "paysure" ||
      PROJECT === "fxmb"
    ) {
      await delay(SETTINGS_SYNC_SLEEP_MS);
      return;
    }
    let deadline = Date.now() + SETTINGS_SYNC_TIMEOUT_MS;
    let candidate: string | undefined;
    let settled_at = 0;
    while (Date.now() < deadline) {
      let revision = await this.settings_revision(external_id);
      if (revision !== previous_revision && revision !== SETTINGS_NOT_SYNCED) {
        if (revision !== candidate) {
          candidate = revision;
          settled_at = Date.now() + SETTINGS_SETTLE_MS;
        } else if (Date.now() >= settled_at) {
          return;
        }
      }
      await delay(SETTINGS_POLL_MS);
    }
    console.warn(
      `Failed to wait until settings for ${external_id} are updated, still at revision ${candidate ?? previous_revision}`,
    );
  }
}

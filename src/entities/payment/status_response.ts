import { assert } from "vitest";
import { z } from "zod";
import { BusinessStatusSchema, OperationTypeSchema } from "@/db/business";
import type { Context } from "@/test_context/context";
import { ErrorResponse } from "./error_response";

const IpSchema = z.union([z.ipv4(), z.ipv6()]);

const GatewayDetailsSchema = z.object({
  ip: z
    .object({
      result: z.string(),
      message: z.string(),
    })
    .nullish(),
  merchant: z.object({
    ip: IpSchema,
  }),
  referrer: z.string().nullish(),
  is_provider: z.boolean().nullish(),
  pending_url: z.url().nullable(),
  check_origin_domain: z.boolean(),
  saved_extra_return_param: z.string().nullish(),
});

const NotificationSettingsSchema = z.object({
  recipient: z.email().nullish(),
  allow_notification: z.boolean().nullish(),
});

const CommissionDataSchema = z.object({
  commission_value: z.number().nullish(),
  commission_fee: z.number().nullish(),
  commission_amount: z.number().nullish(),
});

export const TransactionStatusSchema = z.object({
  id: z.int(),
  status: BusinessStatusSchema,
  token: z.string().length(32),
  currency: z.currencyCode(),
  product: z.string(),
  callback_url: z.url(),
  redirect_success_url: z.url().nullable(),
  redirect_fail_url: z.url().nullable(),
  amount: z.number().min(1),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  extra_return_param: z.string(),
  operation_type: OperationTypeSchema,
  order_number: z.string().nullable(),
  declination_reason: z.string().nullable(),
  lead_id: z.int(),
  ip: IpSchema,
  bank_card_id: z.int().nullable(),
  kind: z.string(),
  refund_id: z.int().nullable(),
  scoring_remark: z.string().nullable(),
  charge_request_id: z.int().nullable(),
  cardpass_through: z.boolean().nullable(),
  country_code_by_BIN: z.string().nullable(),
  business_account_legal_name: z.string(),
  business_account_profileID: z.string(),
  card_masked_number: z.string().nullable(),
  gateway_details: GatewayDetailsSchema,
  gateway_currency: z.string(),
  gateway_amount: z.number(),
  gateway_id: z.int().nullable(),
  card_brand_name: z.string().nullable(),
  two_stage_mode: z.boolean(),
  available_for_refund: z.number().nullable(),
  rrn: z.string().nullable(),
  individual_expired: z.boolean(),
  p2p_type: z.string().nullable(),
  notification_settings: NotificationSettingsSchema,
  bank_data: z.record(z.string(), z.unknown()),
  customer_country: z.string().nullable(),
  trader_id: z.int().nullable(),
  merchant_url: z.url().nullable(),
  reference: z.string().nullable(),
  gateway_provider_id: z.int().nullish(),
  gateway_setting_id: z.int().nullish(),
  lead_email: z.email(),
  commission_data: CommissionDataSchema,
});

export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

const TransactionStatusResponseSchema = z.object({
  payment: TransactionStatusSchema,
  result: z.literal(0),
  status: z.literal(200),
  success: z.literal(true),
});

export class TransactionStatusResponse {
  constructor(
    ctx: Context,
    private res: Response,
    public json: any,
  ) {
    ctx.story.add_chapter("Merchant status response", json);
    console.log("Status response", json);
  }

  as_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success status response should have 200 status",
    );
    let parsed = TransactionStatusResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant payment status response: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  as_error() {
    return new ErrorResponse(this.res, this.json);
  }
}

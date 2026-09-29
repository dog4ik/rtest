import { assert } from "vitest";
import { z } from "zod";
import { CONFIG } from "@/config";

export const ErrorKinds = [
  "api_error",
  "authentication_error",
  "invalid_request_error",
  "processing_error",
  "settings_error",
  "gateway_error",
  "http_error",
  "invalid_payment_status",
  "api_fraud_error",
] as const;

export const ErrorCodes = [
  "invalid_request_error",
  "invalid_param",
  "invalid_json",
  "token_description_document_are_required",
  "customer_email_not_found",
  "record_not_found",
  "amount_less_than_minimum",
  "incorrect_amount",
  "amount_no_money",
  "incorrect_currency",
  "incorrect_order_number",
  "incorrect_address_info",
  "incorrect_bank_card_info",
  "payment_existed",
  "balance_less_than_amount",
  "cant_create_dispute",
  "no_money_available_on_refund",
  "commission_not_received",
  "payment_in_final_state",
  "payment_not_found",
  "merchant_not_found",
  "user_not_found",
  "requisite_not_found",
  "content_type_not_allowed",
  "order_number_already_exists",
  "absent_keys:currency",
  "absent_keys:pay/payout",
  "settings_are_absent",
  "settings_for_currency_are_absent",
  "absent_host2host_mode",
  "auth_header_not_found",
  "unknown_auth_header",
  "incorrect_private_key",
  "no_route_match",
  "fetch_processing_url_error",
  "internal_error",
  "gateway_response_error",
] as const;

const StrictErrorObjectSchema = z.object({
  code: z.enum(ErrorCodes),
  kind: z.enum(ErrorKinds),
  message: z.string().nonempty().optional(),
});

const LoosyErrorObjectSchema = z.object({
  code: z.string().nullish(),
  kind: z.string().nullish(),
  message: z.string().nonempty().optional(),
});

const ErrorObjectSchema = CONFIG.in_project(["8pay"])
  ? StrictErrorObjectSchema
  : LoosyErrorObjectSchema;

const StrictErrorResponseSchema = z.object({
  success: z.literal(false),
  result: z.literal(1),
  status: z.number().gte(400).lt(500),
  errors: z.array(ErrorObjectSchema),
});

const LoosyErrorResponseSchema = z.object({
  success: z.literal(false),
  result: z.literal(1),
  status: z.literal(403),
  errors: z.array(ErrorObjectSchema).or(z.array(z.string())).or(z.string()),
});

export const ErrorResponseSchema = CONFIG.in_project(["8pay"])
  ? StrictErrorResponseSchema
  : LoosyErrorResponseSchema;

function joinErrors(errors: z.infer<typeof ErrorObjectSchema>[]): string {
  return errors
    .map((e) => (e.code && e.kind ? `${e.code} - ${e.kind}` : e.code || e.kind))
    .join(" | ");
}

function convertCursedError(cursed: string) {
  return JSON.parse(cursed.replaceAll("=>", ":"));
}

function isCursed(err: string) {
  return err.startsWith("[{") && err.endsWith("}]");
}

export class ErrorResponse {
  constructor(
    private response: Response,
    private json: any,
  ) {}

  as_common_error() {
    if (CONFIG.in_project(["8pay"])) {
      assert.isAbove(this.response.status, 399);
      assert.isBelow(this.response.status, 500);
    } else {
      assert.strictEqual(
        this.response.status,
        403,
        "errors should have 403 status code",
      );
    }
    let response = ErrorResponseSchema.safeParse(this.json);

    assert(
      response.success,
      `parse h2h error response: ${response.error?.message}`,
    );
    return {
      ...response.data,
      assert_message(msg: string) {
        if (Array.isArray(this.errors)) {
          if (this.errors.every((v) => typeof v === "string")) {
            assert.strictEqual(this.errors.join(" | "), msg);
            return;
          }
          assert.strictEqual(this.errors[0].code, msg);
        } else {
          assert.strictEqual(this.errors, msg);
        }
      },

      assert_error(err: z.infer<typeof ErrorObjectSchema>[]) {
        if (Array.isArray(this.errors)) {
          assert.deepEqual(this.errors, err);
        } else if (isCursed(this.errors)) {
          assert.deepEqual(convertCursedError(this.errors), err);
        } else {
          assert.strictEqual(this.errors, joinErrors(err));
        }
      },

      assert_strict_error(kind: z.infer<typeof StrictErrorObjectSchema>[]) {
        assert.deepEqual(this.errors, kind, "unexpected error shape");
      },
    };
  }

  async as_raw_json() {
    return await this.response.json();
  }
}

import { assert } from "vitest";
import { z } from "zod";
import { CONFIG } from "@/config";

export const ErrorKinds = [
  // Indicate rare occasions such as an Processinprocess API server technicality.
  "api_error",
  // Authentication request failure.
  "authentication_error",
  // Invalid parameters which produce invalid requests.
  "invalid_request_error",
  // Processing the payment generated an error.
  "processing_error",
  // Creating a dispute for a payment generated an error.
  "dispute_processing_error",
  // Merchant or gateway settings are incorrect.
  "settings_error",
  // Gateway responded with an error.
  "gateway_error",
  // HTTP or HTTPS error.
  "http_error",
  // Anti-fraud rules or scoring rejected
  "api_fraud_error",
] as const;

export const ErrorCodes = [
  // Request body or a request field is incorrect.
  "wrong_field_in_request",
  // Requested object does not exist.
  "record_not_found",
  // Amount is not available for this operation.
  "amount_no_money",
  // A payment for this transaction has already been registered.
  "payment_existed",

  // Payout cannot be completed due to insufficient funds.
  "balance_less_than_amount",
  // Not enough funds available for the refund.
  "no_money_available_on_refund",
  // Commission for the operation could not be calculated.
  "commission_not_received",
  // Payment is already in a final state.
  "payment_in_final_state",
  // Payment could not be found.
  "payment_not_found",
  // User could not be found.
  "user_not_found",
  // Payment requisites could not be found.
  "requisite_not_found",
  // Content type of the uploaded file is not allowed.
  "content_type_not_allowed",
  // The order number has already been used.
  "order_number_already_exists",

  // The currency is not enabled in the merchant settings.
  "absent_keys:currency",
  // No active provider is configured for this currency and operation.
  "absent_keys:pay/payout",
  // Merchant settings are not configured.
  "settings_are_absent",
  // Settings for the selected currency are absent.
  "settings_for_currency_are_absent",
  // Card payments are not enabled for the merchant.
  "absent_host2host_mode",
  // Merchant traffic is blocked.
  "traffic_blocked",

  // An anti-fraud rule rejected the operation.
  "antifraud_rule_violation",
  // Risk scoring rejected the operation.
  "antifraud_scoring_declined",
  // The anti-fraud service returned an invalid response.
  "antifraud_invalid_response",
  // The anti-fraud check failed.
  "antifraud_check_failed",
  // Card or IP information could not be obtained.
  "antifraud_info_failed",
  // Anti-fraud statistics could not be sent.
  "antifraud_stat_failed",

  // dispute_processing_error 	The payment cannot be disputed in its current state.
  "invalid_payment_status",
  // dispute_processing_error 	A dispute for this payment is already pending.
  "payment_already_has_pending_dispute",
  // dispute_processing_error 	A dispute for this payment has already been accepted.
  "payment_already_has_accepted_dispute",
  // dispute_processing_error 	The provider could not create a dispute for this payment.
  "cant_create_dispute",
  // dispute_processing_error 	A dispute already exists for this payment.
  "payment_already_has_dispute",

  // authentication_error 	Authentication header is missing.
  "auth_header_not_found",
  // authentication_error 	Authentication header is invalid.
  "unknown_auth_header",
  // authentication_error 	The current private key cannot identify the user.
  "incorrect_private_key",
  // authentication_error 	Merchant could not be found for the given private key.
  "merchant_not_found",
  // api_error 	Requested API route does not exist.
  "no_route_match",
  // api_error 	Processing URL could not be fetched.
  "fetch_processing_url_error",
  // api_error 	Unexpected server error.
  "internal_error",
  // api_error 	Core API request failed.
  "core_api_error",
  // api_error 	Repeated request was skipped.
  "action_skipped_due_to_debounce",
  // api_error 	Card token is missing.
  "card_token_is_blank",
  // gateway_error 	The provider rejected the operation.
  "gateway_response_error",
] as const;

export type ErrorCode = (typeof ErrorCodes)[number];

const StrictErrorObjectSchema = z.object({
  code: z.enum(ErrorCodes),
  kind: z.enum(ErrorKinds),
  message: z.string().nonempty().optional(),
});

export type StrictError = z.infer<typeof StrictErrorObjectSchema>;

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

import { BusinessStatusSchema } from "@/db/business";
import { assert } from "vitest";
import { z } from "zod";
import { ErrorResponse } from "./error_response";
import { err_bad_status } from "@/fetch_utils";
import { ProcessingUrlResponse } from "./processing_url_response";
import type { Context } from "@/test_context/context";

const NestedPaymentSchema = z.object({
  amount: z.int(),
  commission: z.int().optional(),
  currency: z.string(),
  gateway_amount: z.int(),
  status: BusinessStatusSchema,
  two_stage_mode: z.boolean(),
});

const PaymentResponseSchema = z.object({
  payment: NestedPaymentSchema,
  processingUrl: z.array(z.record(z.string(), z.url())).or(z.url()),
  result: z.int(),
  selectorUrl: z.url().optional(),
  status: z.int(),
  success: z.boolean(),
  token: z.string().length(32),
});

export class PayinResponse {
  constructor(
    private ctx: Context,
    private res: Response,
    private json: any,
  ) {
    ctx.story.add_chapter("Merchant payin response", json)
    console.log("Payin response", json);
  }

  as_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success payin response should have 200 status",
    );
    let parsed = PaymentResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant payment response: ${parsed.error.message}`,
      );
    }
    let ctx = this.ctx;
    return {
      ...parsed.data,
      firstProcessingUrl() {
        if (!Array.isArray(this.processingUrl)) {
          return assert.fail("Processing url is not an array");
        } else if (this.processingUrl.length === 0) {
          return assert.fail("Processing url is empty");
        }
        let object = this.processingUrl[0];
        return Object.values(object)[0];
      },
      async followFirstProcessingUrl() {
        console.log("Fetching processing url");
        // TODO: add helper methods on fetch result
        return await fetch(this.firstProcessingUrl(), {
          method: "GET",
          redirect: "follow",
        })
          .then(err_bad_status)
          .then((r) => new ProcessingUrlResponse(ctx, r));
      },
    };
  }

  as_error() {
    return new ErrorResponse(this.res, this.json);
  }
}

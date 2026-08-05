import { assert } from "vitest";
import { z } from "zod";
import { BusinessStatusSchema } from "@/db/business";
import { err_bad_status } from "@/fetch_utils";
import type { Context } from "@/test_context/context";
import { ErrorResponse } from "./error_response";
import { ProcessingUrlResponse } from "./processing_url_response";

const NestedPayoutSchema = z.object({
  token: z.string().length(32),
  status: BusinessStatusSchema,
  decline_reason: z.string().optional(),
});

const PayoutResponseSchema = z.object({
  payout: NestedPayoutSchema.optional(),
  processingUrl: z.array(z.record(z.string(), z.url())).or(z.url()).optional(),
  result: z.int(),
  selectorUrl: z.url().optional(),
  redirectRequest: z.object({ url: z.string().optional() }).optional(),
  status: z.int(),
  success: z.boolean(),
  token: z.string().length(32),
});

const NestedP2PPayoutSchema = z.object({
  amount: z.number().min(1),
  currency: z.string(),
  gateway_amount: z.number().min(1),
  gateway_currency: z.string(),
  status: BusinessStatusSchema,
});

const P2PPayoutResponseSchema = z.object({
  payment: NestedP2PPayoutSchema.optional(),
  processingUrl: z.url(),
  result: z.int().optional(),
  status: z.int().optional(),
  success: z.boolean(),
  token: z.string().length(32),
});

export class PayoutResponse {
  constructor(
    private ctx: Context,
    private res: Response,
    private json: any,
  ) {
    ctx.story.add_chapter("Merchant payout response", json);
    console.log("Payout response", json);
  }

  as_p2p_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success payout response should have 200 status",
    );
    let parsed = P2PPayoutResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant p2p payout response: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  as_ok() {
    assert.strictEqual(
      this.res.status,
      200,
      "success payout response should have 200 status",
    );
    let parsed = PayoutResponseSchema.safeParse(this.json);
    if (!parsed.success) {
      assert.fail(
        `Failed to prase merchant payout response: ${parsed.error.message}`,
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

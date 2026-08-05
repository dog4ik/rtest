import { assert } from "vitest";
import { z } from "zod";
import { BusinessStatusSchema } from "@/db/business";
import { err_bad_status } from "@/fetch_utils";
import type { Context } from "@/test_context/context";
import { ErrorResponse } from "./error_response";
import { ProcessingUrlResponse } from "./processing_url_response";

const NestedPaymentSchema = z.object({
  amount: z.int().min(1),
  commission: z.int().optional(),
  currency: z.string(),
  gateway_amount: z.int(),
  status: BusinessStatusSchema,
  two_stage_mode: z.boolean().optional(),
});

const PaymentResponseSchema = z.object({
  payment: NestedPaymentSchema,
  processingUrl: z.array(z.record(z.string(), z.url())).or(z.url()),
  result: z.int(),
  selectorUrl: z.url().optional(),
  redirectRequest: z.object({ url: z.string().optional() }).optional(),
  status: z.int(),
  success: z.boolean(),
  token: z.string().length(32),
  gateway_token: z.string().optional(),
});

export class PayinResponse {
  constructor(
    private ctx: Context,
    private res: Response,
    public json: any,
  ) {
    ctx.story.add_chapter("Merchant payin response", json);
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
          return this.processingUrl;
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
      async followFirstProcessingCheckedRedirect(
        on_redirect?: (response: Response) => Promise<void>,
      ) {
        console.log("Fetching processing url");
        let url = this.firstProcessingUrl();
        if (!on_redirect) {
          return await fetch(url, { method: "GET", redirect: "follow" })
            .then(err_bad_status)
            .then((r) => new ProcessingUrlResponse(ctx, r));
        }
        let current_url: string = url;
        while (true) {
          let response = await fetch(current_url, {
            method: "GET",
            redirect: "manual",
          });
          if (response.status >= 300 && response.status < 400) {
            await on_redirect(response);
            let location = response.headers.get("location");
            if (!location) {
              assert.fail("redirect response is missing location header");
            }
            current_url = location;
          } else {
            return new ProcessingUrlResponse(ctx, err_bad_status(response));
          }
        }
      },
    };
  }

  as_error() {
    return new ErrorResponse(this.res, this.json);
  }
}

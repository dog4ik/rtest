import { z } from "zod";
import { assert } from "vitest";
import { channel } from "node:diagnostics_channel";

const ErrorObjectSchema = z.object({
  code: z.string().nullish(),
  kind: z.string().nullish(),
});
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  result: z.literal(1),
  status: z.literal(403),
  errors: z.array(ErrorObjectSchema).or(z.array(z.string())).or(z.string()),
});

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
    assert.strictEqual(
      this.response.status,
      403,
      "errors should have 403 status code",
    );
    let response = ErrorResponseSchema.safeParse(this.json);

    assert(
      response.success,
      `parse h2h error response: ${response.error?.message}`,
    );
    return {
      ...response.data,
      assert_message(msg: string) {
        if (Array.isArray(this.errors)) {
          if (this.errors.every((v) => typeof v == "string")) {
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
          assert.deepEqual(err, this.errors);
        } else if (isCursed(this.errors)) {
          assert.deepEqual(
            convertCursedError(this.errors),
            err,
          );
        } else {
          assert.strictEqual(joinErrors(err), this.errors);
        }
      },
    };
  }

  async as_raw_json() {
    return await this.response.json();
  }
}

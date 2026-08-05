import { assert } from "vitest";
import type { z } from "zod";

export function err_bad_status(response: Response) {
  if (response.status >= 500 && response.status < 600) {
    assert.fail(
      `Reactivepay returned bad status code: ${response.statusText} (${response.status})`,
    );
  }
  return response;
}

export function parse_json<T extends z.ZodType>(
  schema: T,
): (response: Response) => Promise<z.infer<T>> {
  return async (response) => {
    let json = await response.json();
    return schema.parse(json);
  };
}

export function delayed<T, R>(delay: number, fn: (args: T) => Promise<R>) {
  return async (args: T): Promise<R> => {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    return fn(args);
  };
}

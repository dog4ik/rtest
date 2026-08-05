import createClient from "openapi-fetch";
import type { components, paths } from "./api_schema.d.ts";

export type TraderSchemas = components["schemas"];

export function createTraderClient(baseUrl: string) {
  return createClient<paths>({
    baseUrl,
  });
}

export type TraderClient = ReturnType<typeof createTraderClient>;

type FetchResponse<T> =
  | {
      data?: never;
      error: {};
      response: Response;
    }
  | {
      data: T;
      error?: never;
      response: Response;
    };

export function throwResponseErrors<T>(
  response: FetchResponse<T>,
): NonNullable<T> {
  if (response.error === undefined) {
    // biome-ignore lint/style/noNonNullAssertion: if error is undefined, assume non nullable data
    return response.data!;
  }

  throw Error(
    `Response error(${response.response.url}): ${JSON.stringify(response.error)}`,
  );
}

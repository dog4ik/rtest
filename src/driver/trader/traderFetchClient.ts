import createClient from "openapi-fetch";
import type { paths } from "./api_schema.d.ts";

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
    return response.data!;
  }

  throw Error(
    `Response error(${response.response.url}): ${JSON.stringify(response.error)}`,
  );
}

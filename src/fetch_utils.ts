import { z } from "zod";

export function err_bad_status(response: Response) {
  if (response.status >= 500 && response.status < 600) {
    throw Error(`Bad status code: ${response.statusText} (${response.status})`);
  }
  return response;
}

export function parse_json<T extends z.ZodType>(
  schema: T,
): (response: Response) => Promise<z.infer<T>> {
  return async (response) => {
    let json = await response.json();
    console.log("Fetch response", json);
    return schema.parse(json);
  };
}

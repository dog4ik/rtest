import { serve, type ServerType } from "@hono/node-server";
import { Hono, type Context, type HonoRequest } from "hono";

export type HttpContext = Context;
export type HttpRequest = HonoRequest;

export type FilterFunction = (req: HttpRequest) => boolean | Promise<boolean>;

export type MockProviderParams = {
  alias: string;
  filter_fn: FilterFunction;
};

export type Handler = (req: HttpContext) => Response | Promise<Response>;
export type ProviderHandler = {
  filter: FilterFunction;
  handler: Handler;
};

export type ProviderServerInstance = {
  handlers: ProviderHandler[];
  server: ServerType;
};

export function spawn_provider_server(port: number): ProviderServerInstance {
  const api = new Hono();
  let handlers: ProviderHandler[] = [];

  api.all("*", async (c) => {
    for (let { handler, filter } of handlers) {
      if (await filter(c.req)) {
        return await handler(c);
      }
    }
    return c.json({
      message: "unregistered server handler",
      path: c.req.path,
      method: c.req.method,
    });
  });

  let server = serve({
    fetch: api.fetch,
    port,
  });
  return { handlers, server };
}

export type MerchantServerInstance = {
  server: ServerType;
  handlersMap: Map<number, Handler[]>;
};

export function spawn_merchant_server(): MerchantServerInstance {
  const api = new Hono();
  let handlersMap: Map<number, Handler[]> = new Map();

  api.all("/:merhant_id", async (c) => {
    let handler = handlersMap.get(+c.req.param("merhant_id"))?.shift();
    if (handler !== undefined) {
      return await handler(c);
    }
    return c.json({
      message: "unregistered merchant server handler",
      path: c.req.path,
      method: c.req.method,
    });
  });

  let server = serve({
    fetch: api.fetch,
    port: 6767,
  });
  return { server, handlersMap };
}

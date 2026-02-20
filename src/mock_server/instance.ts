import type { Story } from "@/story";
import type { Handler, HttpContext, HttpRequest } from "./api";
import { CurlBuilder } from "@/story/curl";

/**
 * Provider instance obtained by the running test
 */
export class ProviderInstance {
  private handlers_queue: Handler[];
  constructor(
    private defaultHandler: Handler,
    private testRejection: (reason: unknown) => void,
    private story: Story,
    private alias: string,
  ) {
    this.handlers_queue = [];
  }

  /**
   * Enqueue provider handler
   * @returns {Promise} Promise that is resoved when the handler was called.
   */
  queue(handler: Handler): Promise<unknown> {
    let { promise, resolve, reject } = Promise.withResolvers();
    this.handlers_queue.push(async (c) => {
      try {
        await this.try_write_gateway_request(c.req);
        let res = await handler(c);
        await this.try_write_gateway_response(res.clone());
        let socket = (c.env?.incoming as import("http").IncomingMessage)
          ?.socket;
        if (socket && !socket.destroyed) {
          socket.once("close", resolve);
        } else {
          resolve(undefined);
        }
        return res;
      } catch (error) {
        reject(error);
        this.testRejection(error);
        c.status(500);
        return c.json({ message: "Queued test handler error" });
      }
    });
    return promise;
  }

  private async try_write_gateway_request(req: HttpRequest) {
    try {
      if (req.header("content-type")?.startsWith("application/json")) {
        let curl = new CurlBuilder(`https://${this.alias}` + req.path, "POST")
          .set_headers(req.raw.headers)
          .header("content-type", "application/json")
          .json_data(await req.json())
          .build();
        this.story.add_chapter(`${this.alias} request`, curl);
      } else {
        this.story.add_chapter(
          `${this.alias} request`,
          JSON.stringify(await req.parseBody(), null, 2),
        );
      }
    } catch (e) {
      console.log("Failed to read gateway request as json", e);
    }
  }

  private async try_write_gateway_response(res: Response) {
    try {
      let headers = Array.from(res.headers).reduce(
        (acc, [name, value]) => acc + `${name}: ${value}\n`,
        "",
      );

      let content = `${this.alias} (${res.status} ${res.statusText})

Headers:
${headers}`;

      let body: string | undefined = undefined;

      if (res.headers.get("content-type") === "application/json") {
        body = JSON.stringify(await res.json(), null, 2);
      } else {
        try {
          body = await res.text();
        } catch (e) {
          console.log("failed to extract response text", e);
        }
      }

      if (body) {
        content += `
Body:
${body}`;
      }

      this.story.add_chapter("Gateway response", content);
    } catch (e) {
      console.log("failed to extract response body as json", e);
    }
  }

  /**
   * Do not use in tests
   */
  async _handler(c: HttpContext) {
    let queuedHandler = this.handlers_queue.shift();
    if (queuedHandler !== undefined) {
      return await queuedHandler(c);
    }

    return await this.defaultHandler(c);
  }
}

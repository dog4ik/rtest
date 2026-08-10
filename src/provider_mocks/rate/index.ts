import { assert } from "vitest";
import type { Handler, HttpContext } from "@/mock_server/api";
import { MAPPING_START_PORT } from "@/patch/production_file";
import type { Story } from "@/story";
import { CurlBuilder } from "@/story/curl";

export const RATE_MAPPING_KEY = "_rate";
export const RATE_MOCK_PORT = MAPPING_START_PORT - 3;

export const STATIC_RATE = 2;

const ALLOWED_SYMBOLS = ["USD", "EUR", "RUB", "USDT", "BTC", "KZT"];

const SERVICE_VERSION = "1.0.0";

/**
 * Successful rate response
 */
export function rate_response(c: HttpContext, rate: number) {
  return c.json({ result: "OK", message: "success", rate });
}

/**
 * Failure response.
 */
export function rate_error_response(c: HttpContext, message: string) {
  // The real service answers with 200 even on errors,
  return c.json({ result: "fail", message, errors: [message] }, 200);
}

type QueuedRate = {
  handler: Handler;
  /**
   * Story of the test that queued the handler
   **/
  story?: Story;
};

export class RateDriver {
  private handlers_queue: Map<string, QueuedRate[]>;

  constructor() {
    this.handlers_queue = new Map();
  }

  /**
   * Enqueue a handler for the mid specific rate endpoint.
   *
   * Prefer the {@link RateInstance} obtained from `ctx.rate_driver`, it binds
   * the story of the running test for you.
   *
   * @returns {Promise} Promise that is resolved when the handler was called.
   */
  queue_rate_handler(
    mid: number,
    handler: Handler,
    story?: Story,
  ): Promise<unknown> {
    let { promise, resolve, reject } = Promise.withResolvers();
    let wrapped: Handler = async (c) => {
      try {
        let res = await handler(c);
        resolve(undefined);
        return res;
      } catch (error) {
        reject(error);
        c.status(500);
        return c.json({ message: "Queued rate handler error" });
      }
    };

    let key = mid.toString();
    let handlers = this.handlers_queue.get(key);
    if (handlers === undefined) {
      this.handlers_queue.set(key, [{ handler: wrapped, story }]);
    } else {
      handlers.push({ handler: wrapped, story });
    }
    return promise;
  }

  /**
   * Return `rate` for the next mid specific request of `mid`.
   *
   * @returns {Promise} Promise that is resolved when the rate was requested.
   */
  queue_mid_rate(mid: number, rate: number, story?: Story): Promise<unknown> {
    return this.queue_rate_handler(mid, (c) => rate_response(c, rate), story);
  }

  private take_handler(mid: string): QueuedRate | undefined {
    return this.handlers_queue.get(mid)?.shift();
  }

  private write_request(story: Story, c: HttpContext) {
    let curl = new CurlBuilder(c.req.url, "GET")
      .set_headers(c.req.raw.headers)
      .build();
    story.add_chapter("Rate request", curl);
  }

  private async write_response(story: Story, res: Response) {
    try {
      story.add_chapter("Rate response", {
        status: res.status,
        body: await res.json(),
      });
    } catch (e) {
      console.log("Failed to read rate response as json", e);
    }
  }

  /**
   * Do not use in tests
   */
  async _handler(c: HttpContext) {
    // `APP_RATE_HOST_URL` already ends with `/rate`, so callers hit paths that
    // keep that prefix. The health check is the only route served from the root.
    let path = c.req.path;
    let segments = path.split("/").filter((s) => s.length > 0);
    console.log(`Rate request path=${path}`);

    if (segments.length === 0) {
      return c.json({
        success: true,
        status: 200,
        version: SERVICE_VERSION,
        started: new Date().toUTCString(),
      });
    }

    if (segments[0] === "rate") {
      segments = segments.slice(1);
    }

    // `Exchange::Order` builds `#{rate_host_url}/order`, which resolves to
    // `/rate/order` rather than `/order`. Both spellings are accepted.
    if (segments.length === 1 && segments[0] === "order") {
      return c.json({ result: "OK", message: "success", order: {} });
    }

    if (segments.length === 1 && segments[0] === "symbols") {
      return c.json({
        result: "OK",
        message: "success",
        symbols: ALLOWED_SYMBOLS,
      });
    }

    if (segments.length === 3) {
      let [base, symb, mid] = segments;
      let queued = this.take_handler(mid);
      if (queued !== undefined) {
        if (queued.story) this.write_request(queued.story, c);
        let res = await queued.handler(c);
        if (queued.story) await this.write_response(queued.story, res.clone());
        return res;
      }
      return rate_response(c, static_rate(base, symb));
    }

    if (segments.length === 2) {
      let [base, symb] = segments;
      return rate_response(c, static_rate(base, symb));
    }

    // The application must never send anything the real service does not serve.
    return assert.fail(
      `Unexpected rate service request: ${c.req.method} ${path}`,
    );
  }
}

/**
 * Per test view of the shared {@link RateDriver}, obtained from
 * `ctx.rate_driver`.
 *
 * A mid is owned by the test that created the merchant, so the request and
 * response of every handler queued here can be attributed to that test's story.
 */
export class RateInstance {
  constructor(
    private driver: RateDriver,
    private story: Story,
  ) {}

  /**
   * Enqueue a handler for the mid specific rate endpoint.
   * @returns {Promise} Promise that is resolved when the handler was called.
   */
  queue_rate_handler(mid: number, handler: Handler): Promise<unknown> {
    return this.driver.queue_rate_handler(mid, handler, this.story);
  }

  /**
   * Return `rate` for the next mid specific request of `mid`.
   * @returns {Promise} Promise that is resolved when the rate was requested.
   */
  queue_mid_rate(mid: number, rate: number): Promise<unknown> {
    return this.driver.queue_mid_rate(mid, rate, this.story);
  }
}

/**
 * `model.get_rate` short circuits to 1 when both currencies are the same.
 */
function static_rate(base: string, symb: string): number {
  return base.toUpperCase() === symb.toUpperCase() ? 1 : STATIC_RATE;
}

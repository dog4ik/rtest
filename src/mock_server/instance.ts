import type { Handler, HttpContext } from "./api";

/**
 * Provider instance obtained by the running test
 */
export class ProviderInstance {
  private handlers_queue: Handler[];
  constructor(
    private defaultHandler: Handler,
    private testRejection: (reason: unknown) => void,
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
        let res = await handler(c);
        resolve(undefined);
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

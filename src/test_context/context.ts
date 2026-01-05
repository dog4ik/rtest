import { extendMerchant } from "@/entities/merchant";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { ProviderInstance } from "@/mock_server/instance";
import type { Project } from "@/project";
import type { SharedState } from "@/state";

export class Context {
  uuid: string;
  project: Project;

  testBackgroundPromise: Promise<unknown>;
  testBackgroundReject: (reason: unknown) => void;
  testBackgroundResolve: (reason: unknown) => void;
  constructor(private state: SharedState) {
    this.uuid = crypto.randomUUID();
    this.project = state.project;
    let { promise, reject, resolve } = Promise.withResolvers();
    this.testBackgroundReject = reject;
    this.testBackgroundResolve = resolve;
    this.testBackgroundPromise = promise;
  }

  /**
   * Helper function to bind state as the first argument
   * TODO: Less type masturbation
   */
  private with_state<T, R>(fn: (state: SharedState, v: T) => R): (v: T) => R {
    return (v) => fn(this.state, v);
  }

  /**
   * Run test and fail during external rejection
   * Wrapping test in this function will help catch all assertions/errors regardless of their context.
   */
  async track_bg_rejections(test: () => Promise<unknown>): Promise<unknown> {
    return await Promise.race([this.testBackgroundPromise, test()]);
  }

  /**
   * Create new unique merchant. Same as creating new merchant via UI in core/manage.
   */
  async create_random_merchant() {
    let merchant = await this.state.core_harness.create_random_merchant();
    return await this.state.core_db
      .merchantByEmail(merchant.email)
      .then(this.with_state(extendMerchant));
  }

  /**
   * Creates a mock provider server.
   *
   * This method should be called once per provider within a single test.
   * Returned ProviderInstance should be used to process incoming requests.
   *
   * Think of it as creating a real-world provider instance.
   *
   * Note that defaultHandler will propagate errors only if the test is wrapped in `track_external_rejections`
   */
  mock_server(
    params: MockProviderParams,
    defaultHandler?: Handler,
  ): ProviderInstance {
    let instance = new ProviderInstance(async (c) => {
      if (defaultHandler !== undefined) {
        try {
          return await defaultHandler(c);
        } catch (error) {
          this.testBackgroundReject(error);
          c.status(500);
          return c.text("Default handler error");
        }
      } else {
        this.testBackgroundReject(
          `Unhandled request on test handler: ${params.alias}`,
        );
        c.status(500);
        return c.text("Unhandled request on test handler");
      }
    }, this.testBackgroundReject);
    this.state.mock_servers.registerProviderServer(params.alias, {
      filter: params.filter_fn,
      handler: instance._handler.bind(instance),
    });
    return instance;
  }
}

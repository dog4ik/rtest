import { extendMerchant } from "@/entities/merchant";
import { RoutingBuilder } from "@/flexy_guard_builder";
import { basic_healthcheck } from "@/healthcheck";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { ProviderInstance } from "@/mock_server/instance";
import type { Project } from "@/project";
import type { SharedState } from "@/state";
import { Story } from "@/story";
import * as vitest from "vitest";

export class Context {
  uuid: string;
  project: Project;
  story: Story;

  testBackgroundPromise: Promise<unknown>;
  testBackgroundReject: (reason: unknown) => void;
  testBackgroundResolve: (reason: unknown) => void;
  constructor(
    private state: SharedState,
    public annotate: vitest.TestContext["annotate"],
    public task: vitest.TestContext["task"],
  ) {
    this.story = new Story();
    this.uuid = crypto.randomUUID();
    this.project = state.project;
    let { promise, reject, resolve } = Promise.withResolvers();
    this.testBackgroundReject = reject;
    this.testBackgroundResolve = resolve;
    this.testBackgroundPromise = promise;
  }

  /**
   * Helper function to bind context as the first argument
   * TODO: Less type masturbation
   */
  private with_context<T, R>(fn: (state: Context, v: T) => R): (v: T) => R {
    return (v) => fn(this, v);
  }

  shared_state() {
    return this.state;
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
      .then(this.with_context(extendMerchant));
  }

  /**
   * Creates a mock provider server.
   *
   * This method should be called once per provider within a single test.
   * Returned ProviderInstance should be used to process incoming requests.
   *
   * Think of it as creating a real-world provider instance.
   *
   * Note that defaultHandler will propagate errors only if the test is wrapped in `track_bg_rejections`
   */
  mock_server(
    params: MockProviderParams,
    defaultHandler?: Handler,
  ): ProviderInstance {
    let instance = new ProviderInstance(
      async (c) => {
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
            `Unexpected request on test handler: ${params.alias}`,
          );
          c.status(500);
          return c.text("Unexpected request on test handler");
        }
      },
      this.testBackgroundReject,
      this.story,
      params.alias,
    );
    this.state.mock_servers.registerProviderServer(params.alias, {
      filter: params.filter_fn,
      handler: instance._handler.bind(instance),
    });
    return instance;
  }

  mock_server_url(alias: string) {
    return this.state.mock_servers.getMockServerUrl(alias);
  }

  local_mock_server_url(alias: string) {
    return this.state.mock_servers.getLocalServerUrl(alias);
  }

  async get_payment(token: string) {
    return await this.state.business_db.paymentByToken(token);
  }

  async get_feed(api_payment_token: string) {
    return await this.state.core_db.feed(api_payment_token);
  }

  async get_payment_by_gw_token(token: string) {
    return await this.state.business_db.paymentByGwToken(token);
  }

  async healthcheck(token: string) {
    return await basic_healthcheck(
      { business_db: this.state.business_db, core_db: this.state.core_db },
      token,
    );
  }

  routing_builder(mid: number, start: string): RoutingBuilder {
    return new RoutingBuilder(this, mid, start);
  }
}

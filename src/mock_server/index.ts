import {
  spawn_merchant_server,
  spawn_provider_server,
  type Handler,
  type MerchantServerInstance,
  type ProviderHandler,
  type ProviderServerInstance,
} from "./api";

/**
 * Spawned servers state tracker shared between tests.
 *
 * !!!NOT THREAD SAFE! ALL TEST MUST RUN ON A SINGLE THREAD!!!
 *
 * TODO: cleanup unused server instances
 */
export class MockServerState {
  private merchant_handler: MerchantServerInstance;
  private providers_handlers: Map<string, ProviderServerInstance>;
  constructor(private mapping: Map<string, number>) {
    this.merchant_handler = spawn_merchant_server();
    this.providers_handlers = new Map();
  }

  getMockServerUrl(alias: string) {
    let port = this.mapping.get(alias);
    return `http://host.docker.internal:${port}`;
  }

  /**
   * Each test should register only one single instance of provider.
   */
  registerProviderServer(alias: string, handler: ProviderHandler) {
    let existingHandler = this.providers_handlers.get(alias);
    if (existingHandler === undefined) {
      console.log("Adding handler to uninitiated server alias", {
        alias,
        port: this.mapping.get(alias),
      });

      let port = this.mapping.get(alias);
      if (port === undefined) {
        throw Error(`Failed to get port mapping for provider alias: ${alias}`);
      }
      let serverHandle = spawn_provider_server(port);
      serverHandle.handlers.push(handler);
      this.providers_handlers.set(alias, serverHandle);
    } else {
      console.log("Adding handler to existing server alias", alias);
      existingHandler.handlers.push(handler);
    }
  }

  registerMerchant(mid: number, handler: Handler) {
    this.merchant_handler.handlersMap.set(mid, handler);
  }
}

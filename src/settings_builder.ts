import { CONFIG } from "./test_context";

export type AnyRecord = Record<string, any>;

export interface ProvidersSettings {
  [currency: string]: any;
  gateways: AnyRecord;
}

export type CommonSettingsParams = {
  method?: string;
  use_setting_method_priority?: boolean;
  wrapped_to_json_response?: boolean;
  enable_change_final_status?: boolean;
  enable_update_amount?: boolean;
  masked_provider?: boolean;
  payment_method?: string;
} & Record<string, any>;

/**
 * Quick way to construct providers settings with single provider
 */
export function providers<T extends CommonSettingsParams>(
  currency: string,
  gateway: T,
): ProvidersSettings {
  if (
    CONFIG.project === "8pay" &&
    gateway.wrapped_to_json_response === undefined
  ) {
    gateway.wrapped_to_json_response = true;
  }
  return {
    [currency]: {
      gateways: {
        pay: {
          providers: [{ gateway_alias: "gateway" }],
        },
        payout: {
          providers: [{ gateway_alias: "gateway" }],
        },
      },
    },
    gateways: {
      gateway,
      allow_host2host: true,
    },
  };
}

/**
 * Default settings for a single provider
 */
export function defaultSettings(
  currency: string,
  gateway: AnyRecord,
): ProvidersSettings {
  return {
    [currency]: {
      gateways: {
        pay: {
          default: "gateway",
        },
        payout: {
          default: "gateway",
        },
      },
    },
    gateways: {
      gateway,
      allow_host2host: true,
    },
  };
}

type Method = "pay" | "payout";

export class SettingsBuilder {
  private aliasIdx = 0;

  public settings: AnyRecord = {
    gateways: {
      allow_host2host: true,
    },
  };

  /**
   * Add p2p provider to specified currency
   */
  addP2P(currency: string, gateway: string, alias?: string): this {
    const resolvedAlias = alias ?? `gateway_alias_${this.nextAlias()}`;
    const existingCurrency = this.settings[currency];

    if (!existingCurrency) {
      this.settings[currency] = {
        gateways: {
          pay: {
            providers: [{ [resolvedAlias]: gateway }],
          },
          payout: {
            providers: [{ [resolvedAlias]: gateway }],
          },
        },
      };
    } else {
      const updateMethod = (method: Method) => {
        // unset default
        if (existingCurrency.gateways[method]?.default) {
          delete existingCurrency.gateways[method].default;
        }

        // init providers block if it does not exist
        existingCurrency.gateways[method].providers =
          existingCurrency.gateways[method].providers ?? [];

        existingCurrency.gateways[method].providers.push({
          [resolvedAlias]: gateway,
        });
      };

      updateMethod("pay");
      updateMethod("payout");
    }

    return this;
  }

  /**
   * Set ecom settings for specified currency.
   * Note that object for currency will be completely overwritten
   */
  withEcom(currency: string, gateway: string): this {
    this.settings[currency] = {
      gateways: {
        pay: {
          default: gateway,
        },
        payout: {
          default: gateway,
        },
      },
    };
    return this;
  }

  /**
   * Add gateway to the gateways list
   */
  withGateway(gateway: AnyRecord, alias?: string): this {
    const resolvedAlias = alias ?? `gateway_${this.nextAlias()}`;
    if (CONFIG.project === "8pay" && gateway.wrapped_to_json_response === undefined) {
      gateway.wrapped_to_json_response = true;
    }
    this.settings.gateways[resolvedAlias] = gateway;
    return this;
  }

  /**
   * Add gateway-level param (e.g. allow_host2host)
   */
  withGatewayParam(key: string, value: any): this {
    this.settings.gateways[key] = value;
    return this;
  }

  /**
   * Add top-level param (e.g. convert_to)
   */
  withTopLevelParam(key: string, value: any): this {
    this.settings[key] = value;
    return this;
  }

  /**
   * Finish building settings
   */
  build(): AnyRecord {
    return this.settings;
  }

  /**
   * Next alias number
   */
  private nextAlias(): number {
    return this.aliasIdx++;
  }
}

export type GCSettingsType = {
  class: string;
  gateway_settings: {
    bypass_processing_url: boolean;
    callback: boolean;
    enable: boolean;
    full_link: string;
    gateway_key: string;
    methods: {
      payout: {
        enable_status_checker: boolean;
        final_waiting_seconds: number;
        params_fields: {
          callback_url: boolean;
          processing_url: boolean;
          params: string[];
          payment: string[];
          settings: string[];
        };
      };
      pay: {
        enable_status_checker: boolean;
        final_waiting_seconds: number;
        params_fields: {
          callback_3ds_url: boolean;
          callback_url: boolean;
          processing_url: boolean;
          params: string[];
          payment: string[];
          settings: string[];
        };
      };
      status: {
        params_fields: {
          params: string[];
          payment: string[];
          settings: string[];
        };
      };
    };
    processing_method: "http_requests";
    status_checker_time_rates: {
      "1-3": number;
      "4-6": number;
      "7-14": number;
      "15-": number;
    };
  };
  sign_key: string;
};

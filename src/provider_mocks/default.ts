import type { TestCaseBase } from "@/suite_interfaces";
import * as common from "@/common";

type OperationType = "pay" | "payout";

export const ApprovePayinCard = "4392963203551251";
export const DeclinePayinCard = "4730198364688516";
export const ApprovePayoutCard = "4627342642639018";
export const DeclinePayoutCard = "4968357931420422";

export function request(
  currency: string,
  amount: number,
  operation_type: OperationType,
  success: boolean,
) {
  let pan: string;

  if (operation_type === "pay") {
    pan = success ? ApprovePayinCard : DeclinePayinCard;
  } else {
    pan = success ? ApprovePayoutCard : DeclinePayoutCard;
  }

  return {
    currency,
    amount,
    card: {
      cvv: "111",
      expires: "03/2029",
      holder: "John Doe",
      pan,
    },
    customer: {
      email: "test@test.com",
      ip: "8.8.8.8",
    },
    order_number: "TODO: display test name and uuid here",
    product: "Description",
  };
}

export function fullSettings(currency: string) {
  return {
    [currency]: {
      gateways: {
        pay: {
          default: "default",
        },
        payout: {
          default: "default",
        },
      },
    },
    gateways: {
      allow_host2host: true,
    },
  };
}

export function payinSuite(currency = "RUB"): TestCaseBase {
  return {
    request() {
      return request(currency, common.amount, "pay", true);
    },
    mock_options() {
      throw Error("default gateway can't have a server instance");
    },
    settings() {
      return fullSettings(currency);
    },
    create_handler() {
      return () => {
        throw Error("default gateway does can't handle requests");
      };
    },
    gw: {},
    type: "payin",
  };
}

export function payoutSuite(currency = "RUB"): TestCaseBase {
  return {
    ...payinSuite(currency),
    request() {
      return request(currency, common.amount, "payout", true);
    },
    type: "payout",
  };
}

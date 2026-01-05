type OperationType = "pay" | "payout";

export function request(
  currency: string,
  amount: number,
  operation_type: OperationType,
  success: boolean,
) {
  let pan: string;

  if (operation_type === "pay") {
    pan = success ? "4392963203551251" : "4730198364688516";
  } else {
    pan = success ? "4627342642639018" : "4968357931420422";
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

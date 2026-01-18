import type { HttpContext } from "./mock_server/api";

export type PayoutRequest = {
  currency: string;
  amount: number;
  customer: {
    email: string;
    ip: string;
  };
  order_number: string;
  extra_return_param?: string;
  callbackUrl?: string;
  bank_account?: {
    requisite_type?: "card" | "sbp" | "link" | "account";
    bank_name?: string;
  };
  product?: string;
};

export type PaymentRequest = {
  currency: string;
  amount: number;
  customer: {
    email: string;
    ip?: string;
  };
  order_number?: string;
  extra_return_param?: string;
  callbackUrl?: string;
  bank_account?: {
    requisite_type?: "card" | "sbp" | "link" | "account";
    bank_name?: string;
  };
  product?: string;
};

export type RefundRequest = {
  token: string;
  amount?: number;
};

export type CardObject = {
  pan: string;
  cvv: string;
  holder: string;
  expires: string;
};

export type HandlerResponse = {
  status: number;
  body?: string;
  set_header(name: string, value: string): void;
};

export const visaCard = "4242424242424242";
export const mastercardCard = "5555555555554444";
export const phoneNumber = "79995553535";
export const redirectPayUrl = "https://google.com";
export const amount = 123456;
export const rrn = "601115349038";
export const fullName = "Satoru Gojo";

export function paymentRequest(currency: string): PaymentRequest {
  return {
    amount,
    currency,
    customer: {
      email: "test@email.com",
    },
    product: "test product",
  };
}

export function nginx500(c: HttpContext): Response {
  c.status(500);
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>500 Internal Server Error</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
    h1 { color: #cc0000; }
  </style>
</head>
<body>
  <h1>500 Internal Server Error</h1>
  <p>Oops! Something went wrong on our server. We are working to fix it.</p>
  <p>Please try again later.</p>
</body>
</html>`);
}

export function cardObject(): CardObject {
  return {
    cvv: "123",
    pan: visaCard,
    holder: "Test holder",
    expires: "02/2077",
  };
}

export function payoutRequest(currency: string): PayoutRequest {
  return {
    amount,
    currency,
    order_number: crypto.randomUUID(),
    customer: {
      email: "test@email.com",
      ip: "8.8.8.8",
    },
  };
}

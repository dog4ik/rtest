import { PROJECT } from "./config";
import type { Bank, Requisite } from "./driver/trader";
import type { HttpContext } from "./mock_server/api";

type BankAccount = {
  requisite_type?: "card" | "sbp" | "link" | "account";
  bank_name?: Bank;
  account_holder?: string;
  account_number?: string;
};

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
  bank_account?: BankAccount;
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
  bank_account?: BankAccount;
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
export const firstName = "Satoru";
export const lastName = "Gojo";
export const fullName = [firstName, lastName].join(" ");
export const ip = "8.8.8.8";
export const bankName = "Сбербанк";
export const accountNumber = "7355608";
export const email = "email@mail.com";
export const androidUserAgent =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36";
export const iosUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/69.0.3497.105 Mobile/15E148 Safari/605.1";
export const desktopUserAgent =
  "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0";

export function paymentRequest(currency: string): PaymentRequest {
  return {
    amount,
    currency,
    customer: {
      email,
    },
    product: "test product",
  };
}

export function p2pPaymentRequest(currency: string, requisite_type: Requisite) {
  if (PROJECT === "8pay") {
    const Mapping: Record<Requisite, string> = {
      sbp: "SBP",
      account: "",
      card: "Cards",
      link: "SBP_aquiring",
    };
    return {
      ...paymentRequest(currency),
      extra_return_param: Mapping[requisite_type],
    };
  } else {
    return {
      ...paymentRequest(currency),
      bank_account: {
        requisite_type: requisite_type,
      },
    };
  }
}

export function maskCard(card: string): string {
  if (card.length < 10) {
    return card;
  }

  const first6 = card.slice(0, 6);
  const last4 = card.slice(-4);
  const masked = "*".repeat(card.length - 10);

  return first6 + masked + last4;
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

export function browserObject() {
  return {
    accept_header: "application/json, text/plain, */*",
    color_depth: "24",
    ip: "102.129.158.25",
    java_enabled: "false",
    javascript_enabled: "true",
    language: "en",
    screen_height: "960",
    screen_width: "1536",
    tz: "-180",
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    window_height: "839",
    window_width: "1536",
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

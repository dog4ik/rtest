// This is cancer.

import * as assets from "@/assets";
import { err_bad_status } from "@/fetch_utils";
import type { Handler, MockProviderParams } from "@/mock_server/api";
import { CurlBuilder } from "@/story/curl";
import crypto from "node:crypto";
import { assert } from "vitest";
import { z } from "zod";
import { sign } from "./signature";
import { CONFIG } from "@/test_context";

export type PaysecureStatus =
  | "paid"
  | "payment_in_process"
  | "expired"
  | "error";

const PurchaseRequestSchema = z.object({
  client: z.object({
    email: z.email(),
    country: z.string(),
    city: z.string(),
    stateCode: z.string().optional(),
    street_address: z.string(),
    zip_code: z.string(),
    date_of_birth: z.string().optional(),
    phone: z.string().optional(),
    full_name: z.string(),
  }),
  purchase: z.object({
    currency: z.string().length(3),
    products: z.array(
      z.object({
        name: z.string(),
        price: z.float32(),
      }),
    ),
  }),
  brand_id: z.string(),
  paymentMethod: z.string().optional(),
  success_redirect: z.url(),
  pending_redirect: z.url(),
  failure_redirect: z.url(),
  success_callback: z.url(),
  failure_callback: z.url(),
});

const CreateSessionRequestSchema = z.object({
  customerId: z.string(),
  merchantRef: z.string().optional(),
  currency: z.string().length(1),
  products: z.array(
    z.object({
      name: z.string(),
      price: z.coerce.number(),
    }),
  ),
  totalAmount: z.coerce.number().nullish(),
  paymentMethod: z.string().optional(),
  success_redirect: z.url(),
  pending_redirect: z.url(),
  failure_redirect: z.url(),
  success_callback: z.url(),
  failure_callback: z.url(),
});

const CreateCustomerSchema = z.object({
  fullName: z.string(),
  emailId: z.email(),
  dateOfBirth: z.string(),
  phoneNo: z.string(),
  city: z.string(),
  stateCode: z.string().optional(),
  zipCode: z.string(),
  address: z.string(),
  country: z.string(),
  merchantCustomerId: z.string(),
  CustRegDate: z.string().nullish(),
  SuccessTxn: z.string().nullish(),
  extraParam: z.record(z.string(), z.string()).nullish(),
});

type CommonData = {
  payment_method?: string;
  success_redirect: string;
  failure_redirect: string;
  pending_redirect: string;
  success_callback: string;
  failure_callback: string;
  total: number;
  currency: string;
  brand_id: string;
  email: string;
  full_name: string;
  date_of_birth?: string;
  street_address: string;
  country: string;
  city: string;
  zip_code: string;
  stateCode?: string;
  products: { price: number; name: string }[];
};

export class PaysecureApmPayment {
  gateway_id: string;
  purchase_request?: z.infer<typeof PurchaseRequestSchema>;
  customer?: {
    customer_request: z.infer<typeof CreateCustomerSchema>;
    id: string;
  };
  session_request?: z.infer<typeof CreateSessionRequestSchema>;
  common_data?: CommonData;
  constructor() {
    this.gateway_id = crypto.randomBytes(16).toString("hex");
  }

  session_response(request: any, brand_id?: string) {
    assert(brand_id);
    this.session_request = CreateSessionRequestSchema.parse(request);
    assert(this.customer);
    let customer = this.customer.customer_request;
    this.common_data = {
      payment_method: this.session_request.paymentMethod,
      pending_redirect: this.session_request.pending_redirect,
      success_callback: this.session_request.success_callback,
      failure_redirect: this.session_request.failure_redirect,
      failure_callback: this.session_request.failure_callback,
      success_redirect: this.session_request.success_redirect,
      total:
        this.session_request.totalAmount ||
        this.session_request.products.reduce((acc, n) => acc + n.price, 0),
      currency: this.session_request.currency,
      brand_id: brand_id,
      stateCode: customer.stateCode,
      country: customer.country,
      zip_code: customer.zipCode,
      street_address: customer.address,
      date_of_birth: customer.dateOfBirth,
      full_name: customer.fullName,
      email: customer.emailId,
      city: customer.city,
      products: this.session_request.products,
    };
    return {
      sessionUrl:
        "https://api.choicepay.ca/payment-session/6984e3618b05f52e33886a7e/",
      brandId: brand_id,
      customerId: this.customer.id,
      sessionId: this.gateway_id,
      expiryOn: 1770317541,
      createdOn: 1770316641,
    };
  }

  create_session_handler(): Handler {
    return async (c) =>
      c.json(
        this.session_response(await c.req.json(), c.req.header("BrandId")),
      );
  }

  purchase_response(status: PaysecureStatus, request: any) {
    this.purchase_request = PurchaseRequestSchema.parse(request);
    let r = this.purchase_request;

    let total = this.purchase_request.purchase.products.reduce(
      (acc, n) => (n.price += acc),
      0,
    );

    this.common_data = {
      payment_method: r.paymentMethod,
      pending_redirect: r.pending_redirect,
      success_callback: r.success_callback,
      failure_redirect: r.failure_redirect,
      failure_callback: r.failure_callback,
      success_redirect: r.success_redirect,
      total,
      currency: r.purchase.currency,
      brand_id: r.brand_id,
      stateCode: r.client.stateCode,
      country: r.client.country,
      zip_code: r.client.zip_code,
      street_address: r.client.street_address,
      date_of_birth: r.client.date_of_birth,
      full_name: r.client.full_name,
      email: r.client.email,
      city: r.client.city,
      products: r.purchase.products,
    };

    return this.status_response(status);
  }

  create_purchase_handler(status: PaysecureStatus): Handler {
    return async (c) =>
      c.json(this.purchase_response(status, await c.req.json()), 202);
  }

  static no_customer_response() {
    return {
      message: "Customer with this information does not exist",
      code: "customer_does_not_exist",
    };
  }

  static no_customer_handler(): Handler {
    return (c) => c.json(this.no_customer_response(), 400);
  }

  get_customer_response() {
    assert(this.customer);
    let c = this.customer.customer_request;
    return {
      customerId: this.customer.id,
      merchantCustomerId: c.merchantCustomerId,
      fullName: c.fullName,
      emailId: c.emailId,
      dateOfBirth: c.dateOfBirth,
      phoneNo: c.phoneNo,
      brandID: "1d666074-39be-4b90-aec9-e9de78fbdcb9",
      city: c.city,
      zipCode: c.zipCode,
      address: c.address,
      country: c.country,
      stateCode: c.stateCode,
      custRegDate: c.CustRegDate,
      successTrans: 0,
      createdOn: 1763376070,
      lastUpdated: 0,
      lastActivity: 1763376070,
      extraParam: c.extraParam,
    };
  }

  private create_customer_response(request: any) {
    this.customer = {
      customer_request: CreateCustomerSchema.parse(request),
      id: crypto.randomBytes(16).toString("hex"),
    };
    return this.get_customer_response();
  }

  create_customer_handler(): Handler {
    return async (c) =>
      c.json(this.create_customer_response(await c.req.json()));
  }

  status_response(status: PaysecureStatus) {
    assert(this.common_data);

    return {
      purchaseId: this.gateway_id,
      client: {
        customerId: "NA",
        email: this.common_data.email,
        full_name: this.common_data.full_name,
        date_of_birth: this.common_data.date_of_birth,
        street_address: this.common_data.street_address,
        country: this.common_data.country,
        city: this.common_data.city,
        zip_code: this.common_data.zip_code,
        cc: [],
        bcc: [],
        stateCode: this.common_data.stateCode,
      },
      updated_on: 1770312367,
      type: "purchase",
      paymentMethod: this.common_data.payment_method,
      amountUnit: "MAJOR",
      errorMsg: "",
      errorCode: "NA",
      force_recurring: false,
      created_on: 1770312366,
      merchantRef: "6984d2aef216beecf669b07d",
      purchase: {
        currency: this.common_data.currency,
        products: this.common_data.products.map((p) => ({
          name: p.name,
          quantity: 1.0,
          price: p.price,
          discount: 0,
          tax_percent: "0.00",
        })),
        total: this.common_data.total,
        requestAmount: this.common_data.total,
        language: "en",
        notes: "",
        debt: 0,
        total_formatted: 1.0,
        taxAmount: 0.0,
        taxPercent: 0.0,
        request_client_details: [],
        email_message: "",
      },
      payment: {
        is_outgoing: false,
        payment_type: "PURCHASE",
        amount: this.common_data.total,
        currency: this.common_data.currency,
        net_amount: this.common_data.total,
        fee_amount: 0.0,
        pending_amount: 0.0,
        pending_unfreeze_on: null,
        description: "",
        paid_on: 1770312367,
        remote_paid_on: 1770312367,
      },
      issuer_details: {
        website: "",
        legal_street_address: "",
        legal_country: "",
        legal_city: "",
        legal_zip_code: "",
        bank_accounts: [{}],
        legal_name: "LIVE",
        brand_name: "LIVE",
        registration_number: "",
        tax_number: "",
      },
      transaction_data: {
        payment_method: "",
        flow: "payform",
        extra: {
          amount: this.common_data.total,
          masked_pan: "APPLEPAY-REDIRECT",
        },
        country: "",
        attempts: [
          {
            client_ip: "178.221.129.56",
            type: "execute",
            payment_method: "APPLEPAY-REDIRECT",
            flow: "payform",
            successful: true,
            country: "APPLEPAY-REDIRECT",
            processing_time: 1770312367,
            extra: {
              amount: this.common_data.total,
              masked_pan: "APPLEPAY-REDIRECT",
            },
          },
        ],
      },
      status: status.toUpperCase(),
      status_history: [
        { status: "created", timestamp: 1770312366 },
        { status: "pending_execute", timestamp: 1770312367 },
        { status: "payment_in_process", timestamp: 1770312367 },
      ],
      is_test: false,
      brand_id: this.common_data.brand_id,
      send_receipt: false,
      is_recurring_token: false,
      skip_capture: false,
      reference_generated: "PS276887",
      issued: "2026-02-05",
      due: 1770312366,
      refund_upto: 1785860767,
      cc_descriptor: "",
      fraudScore: "0",
      trustScore: "3",
      extraFee: "0",
      pix_payload: {},
      payInDetails: {},
      paidOn: 0,
      receivedAmt: 0.0,
      taxAmount: 0.0,
      surcharge: 0.0,
      surchargeType: "",
      sessionId: "",
      refund_availability: "NONE",
      refundable_amount: this.common_data.total,
      success_redirect: this.common_data.success_redirect,
      failure_redirect: this.common_data.failure_redirect,
      pending_redirect: this.common_data.pending_redirect,
      cancel_redirect: "",
      success_callback: this.common_data.success_callback,
      failure_callback: this.common_data.success_callback,
      platform: "API",
      created_from_ip: "178.221.129.56",
      checkout_url:
        "https://api.choicepay.ca/payments/0da42777e7799d1a953cdd017cb06488/",
      payoutProcess: false,
    };
  }

  status_handler(status: PaysecureStatus): Handler {
    return (c) => c.json(this.status_response(status), 202);
  }

  callback(status: PaysecureStatus, secret: string) {
    let customer_data =
      this.purchase_request?.client || this.customer?.customer_request;
    let c = this.customer?.customer_request;
    let pc = this.purchase_request?.client;

    let common_request = this.purchase_request || this.session_request;
    assert(common_request);
    let total: number;
    if (this.purchase_request) {
      total = this.purchase_request.purchase.products.reduce(
        (acc, n) => acc + n.price,
        0,
      );
    } else {
      assert(this.session_request);
      total = this.session_request.products.reduce(
        (acc, n) => acc + +n.price,
        0,
      );
    }

    return {
      message: {
        purchaseId: this.gateway_id,
        client: {
          customerId: this.customer?.id ?? "NA",
          email: c?.emailId ?? pc?.email,
          full_name: c?.fullName ?? pc?.email,
          street_address: c?.address ?? pc?.street_address,
          country: customer_data?.country,
          city: customer_data?.city,
          zip_code: c?.zipCode ?? pc?.zip_code,
          cc: [],
          bcc: [],
          stateCode: customer_data?.stateCode,
        },
        updated_on: 1770152406,
        type: "purchase",
        paymentMethod: common_request.paymentMethod ?? "APPLEPAY-REDIRECT",
        amountUnit: "MAJOR",
        errorMsg:
          status == "error" ? "This customer can not be processed !" : "",
        errorCode: "NA",
        force_recurring: false,
        created_on: 1770152405,
        merchantRef: "698261d5e09c785c9aab5200",
        purchase: {
          currency: "USD",
          products: [
            {
              name: "tesg ceoduct",
              quantity: 1,
              price: total.toString(),
              discount: 0,
              tax_percent: "0.00",
            },
          ],
          total: 1234.56,
          requestAmount: 1234.56,
          language: "en",
          notes: "",
          debt: 0,
          total_formatted: 1,
          taxAmount: 0,
          taxPercent: 0,
          request_client_details: [],
          email_message: "",
        },
        issuer_details: {
          website: "",
          legal_street_address: "",
          legal_country: "",
          legal_city: "",
          legal_zip_code: "",
          bank_accounts: [{}],
          legal_name: "LIVE",
          brand_name: "LIVE",
          registration_number: "",
          tax_number: "",
        },
        transaction_data: {
          payment_method: "",
          flow: "payform",
          extra: { amount: 1234.56, masked_pan: "APPLEPAY-REDIRECT" },
          country: "",
          attempts: [
            {
              client_ip: "212.200.207.142",
              type: "execute",
              payment_method: "APPLEPAY-REDIRECT",
              flow: "payform",
              successful: false,
              country: "APPLEPAY-REDIRECT",
              processing_time: 1770152405,
              extra: { amount: 1234.56, masked_pan: "APPLEPAY-REDIRECT" },
              error: {
                message: "This customer can not be processed !",
                code: "no_mid_found",
              },
            },
          ],
        },
        status: status.toUpperCase(),
        status_history: [
          { status: "created", timestamp: 1770152405 },
          { status: "pending_execute", timestamp: 1770152405 },
          { status: "error", timestamp: 1770152406 },
        ],
        is_test: false,
        brand_id: secret,
        send_receipt: false,
        is_recurring_token: false,
        skip_capture: false,
        reference_generated: "PS276231",
        issued: "2026-02-03",
        due: 1770152405,
        refund_upto: 0,
        cc_descriptor: "",
        fraudScore: "NA",
        trustScore: "NA",
        extraFee: "0",
        paidOn: 0,
        receivedAmt: 0,
        taxAmount: 0,
        surcharge: 0,
        surchargeType: "",
        sessionId: "",
        refund_availability: "NONE",
        refundable_amount: 0,
        success_redirect: common_request.success_redirect,
        failure_redirect: common_request.failure_redirect,
        pending_redirect: common_request.pending_redirect,
        cancel_redirect: "",
        success_callback: common_request.success_callback,
        failure_callback: common_request.failure_callback,
        platform: "API",
        created_from_ip: "212.200.207.142",
        checkout_url:
          "https://api.choicepay.ca/payments/599508268aca65d1533a76c6a94ba8e0/",
        payoutProcess: false,
      },
      status: status,
    };
  }
  async send_callback(status: PaysecureStatus, secret: string) {
    let request_data = this.session_request || this.purchase_request;
    assert(request_data);
    let url: string;
    if (status == "paid") {
      url = request_data.success_callback;
    } else {
      url = request_data.failure_callback;
    }

    let payload = this.callback(status, secret);

    let curl = new CurlBuilder(url, "POST").json_data(payload);
    console.log(`Gateway callback: ${curl.build()}`);

    let signature = sign(
      payload,
      await assets.read_to_string(assets.DummyRsaPath),
    );
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "paysecure-sign": signature,
        paysecure_sign: signature,
      },
      body: JSON.stringify(payload),
    }).then(err_bad_status);
  }

  static settings(secret: string) {
    return {
      api_key: secret,
      brand_id: secret,
      class: "paysecureapm",
      assets: {
        public_key: CONFIG.dummyRsaPub(),
      },
      sign_key: "7c9de985451bd9514b7b06938d20d901",
    };
  }

  static mock_params(secret: string): MockProviderParams {
    return {
      alias: "paysecureapm",
      filter_fn: (r) => {
        return r.header("authorization") === `Bearer ${secret}`;
      },
    };
  }
}

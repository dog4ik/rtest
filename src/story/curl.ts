import type { OperationType } from "@/db/business";

export function constructCurlRequest(
  request: Record<string, unknown>,
  private_key: string,
  operation_type: OperationType,
): string {
  let suffix = () => {
    if (operation_type === "pay") return "payments";
    else if (operation_type === "payout") return "payouts";
    else if (operation_type === "refund") return "refunds";
    else if (operation_type === "dispute") return "disputes";
  };

  const json = JSON.stringify(request, null, 2);

  return `curl 'http://localhost:4000/api/v1/${suffix()}' \\
-X POST \\
-H 'Content-Type: application/json' \\
-H 'Authorization: Bearer ${private_key}' \\
-d '${json}'`;
}

export class CurlBuilder {
  private headers: Headers;
  private form_fields: Map<string, any>;
  private data?: string;
  constructor(
    private url: string,
    private method: "POST" | "GET",
  ) {
    this.headers = new Headers();
    this.form_fields = new Map();
    this.data = undefined;
  }

  header(key: string, value: string) {
    this.headers.append(key, value);
    return this;
  }

  form_field(key: string, value: {}) {
    this.form_fields.set(key, value);
    return this;
  }

  set_headers(headers: Headers) {
    this.headers = headers;
    return this;
  }

  json_data(data: Record<string, any>) {
    this.headers.set("content-type", "application/json");
    this.data = JSON.stringify(data, null, 2);
    return this;
  }

  build() {
    let curl = `curl '${this.url}' \\
-X ${this.method} \\\n`;

    for (let [name, value] of this.headers.entries()) {
      curl += `-H '${name}: ${value}' \\\n`;
    }

    for (let [name, value] of this.form_fields.entries()) {
      curl += `-F '${name}=${value}' \\\n`;
    }

    if (this.data !== undefined) {
      curl += `-d '${this.data}' \\\n`;
    }
    return curl.slice(0, -3);
  }
}

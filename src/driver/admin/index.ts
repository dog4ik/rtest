import { err_bad_status } from "@/fetch_utils";
import type { Credentials } from "..";

export type FeedType =
  | "cashin_request"
  | "cashout_request"
  | "dispute_request"
  | "payin_request"
  | "payout_request"
  | "refund_request";

// Feed status enum values: created=0, accepted=1, declined=2, refunded=4
export type FeedStatus = 0 | 1 | 2 | 4;

export class AdminDriver {
  cookies: string | null;
  base_url: string;

  constructor(base_url: string) {
    this.cookies = null;
    this.base_url = base_url;
  }

  async login(credentials: Credentials) {
    let body = new URLSearchParams({
      "admin_user[email]": credentials.login,
      "admin_user[password]": credentials.password,
    });

    let res = await fetch(`${this.base_url}/admin_users/sign_in`, {
      method: "POST",
      redirect: "manual",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }).then(err_bad_status);

    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }

  async change_status(type: FeedType, id: number, status: FeedStatus) {
    let body = new URLSearchParams({
      _method: "put",
      [`${type}[status]`]: String(status),
      return_to: `${this.base_url}/admin/${type}`,
      _add_edit: "",
    });

    let res = await fetch(`${this.base_url}/admin/${type}/${id}/edit`, {
      method: "POST",
      redirect: "manual",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        cookie: this.cookies ?? "",
      },
    }).then(err_bad_status);

    let cookie = res.headers.get("set-cookie");
    if (cookie !== null) {
      this.cookies = cookie;
    }
  }
}

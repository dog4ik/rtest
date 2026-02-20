import { assert } from "vitest";

export type Credentials = {
  login: string;
  password: string;
};

export async function get_redirect_location(url: string) {
  let res = await fetch(url, { redirect: "manual" });
  assert.strictEqual(res.status, 302, "expected redirect to login page");
  let location = res.headers.get("location");
  console.log("Auth redirect location", location);
  assert(location, "location should not be empty");
  return location;
}

export async function authorize_client(
  credentials: Credentials,
  login_url: string,
) {
  console.log({ login_url });
  let loginInitRes = await fetch(login_url, { redirect: "follow" });
  let loginPageHtml = await loginInitRes.text();

  // yikes
  let actionMatch = loginPageHtml.match(/action="([^"]+)"/);
  if (!actionMatch) throw new Error("No form action found");
  let formAction = actionMatch[1].replace(/&amp;/g, "&");

  let keycloakCookies =
    loginInitRes.headers.getSetCookie?.() ??
    [loginInitRes.headers.get("set-cookie")].filter(Boolean);

  let authRes = await fetch(formAction, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: keycloakCookies.join("; "),
    },
    body: new URLSearchParams({
      username: credentials.login,
      password: credentials.password,
    }),
    redirect: "manual",
  });

  let callbackUrl = authRes.headers.get("location");
  if (!callbackUrl) throw new Error("No redirect after login");

  let callbackRes = await fetch(callbackUrl, {
    redirect: "manual",
  });

  let cookie = callbackRes.headers.get("set-cookie");
  console.log({ cookie });
  return cookie;
}

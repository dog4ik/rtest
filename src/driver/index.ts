export type Credentials = {
  login: string;
  password: string;
};

export async function authorize_client(
  credentials: Credentials,
  login_url: string,
) {
  console.log({ login_url });
  let loginInitRes = await fetch(login_url, { redirect: "manual" });

  let flaskCookies =
    loginInitRes.headers.getSetCookie?.() ??
    [loginInitRes.headers.get("set-cookie")].filter(Boolean);

  let keycloakUrl = loginInitRes.headers.get("location");
  if (!keycloakUrl) throw new Error("No redirect to Keycloak");

  let keycloakPageRes = await fetch(keycloakUrl, { redirect: "follow" });
  let loginPageHtml = await keycloakPageRes.text();

  let actionMatch = loginPageHtml.match(/action="([^"]+)"/);
  if (!actionMatch) throw new Error("No form action found");
  let formAction = actionMatch[1].replace(/&amp;/g, "&");

  let keycloakCookies =
    keycloakPageRes.headers.getSetCookie?.() ??
    [keycloakPageRes.headers.get("set-cookie")].filter(Boolean);

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
    headers: {
      Cookie: flaskCookies.join("; "),
    },
    redirect: "manual",
  });

  let cookie = callbackRes.headers.get("set-cookie");
  return cookie;
}

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

  let keycloakUrl: string;
  if (loginInitRes.status >= 300 && loginInitRes.status < 400) {
    let location = loginInitRes.headers.get("location");
    if (!location) throw new Error("No redirect to Keycloak");
    keycloakUrl = location;
  } else {
    let html = await loginInitRes.text();
    let hrefMatch = html.match(/href="([^"]*cloak[^"]*)"/);
    if (!hrefMatch) throw new Error("No Keycloak link found in page");
    let href = hrefMatch[1].replace(/&amp;/g, "&");

    if (href.startsWith("http")) {
      keycloakUrl = href;
    } else {
      // Relative href — follow local redirects until we leave the service origin (= Keycloak URL)
      let loginOrigin = new URL(login_url).origin;
      let currentUrl = new URL(href, login_url).toString();
      keycloakUrl = "";
      while (true) {
        let res = await fetch(currentUrl, {
          redirect: "manual",
          headers: { Cookie: flaskCookies.join("; ") },
        });
        let cookies: string[] = (res.headers.getSetCookie?.() ??
          [res.headers.get("set-cookie")].filter(Boolean)) as string[];
        flaskCookies = [...flaskCookies, ...cookies];
        let location = res.headers.get("location");
        if (!location) throw new Error("No Keycloak redirect from login link");
        let nextUrl = location.startsWith("http")
          ? location
          : new URL(location, currentUrl).toString();
        if (new URL(nextUrl).origin !== loginOrigin) {
          keycloakUrl = nextUrl;
          break;
        }
        currentUrl = nextUrl;
      }
    }
  }

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

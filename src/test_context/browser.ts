import * as playwright from "playwright";
import { CONFIG } from "@/config";
import { DEFAULT_CONFIG } from "@/config";

export async function createBrowser() {
  let chromium = playwright.chromium;
  if (CONFIG.browser?.ws_url) {
    return await chromium.connect(CONFIG.browser.ws_url);
  } else {
    let server = await chromium.launchServer({
      headless: CONFIG.browser?.headless ?? DEFAULT_CONFIG.browser.headless,
    });
    return await chromium.connect(server.wsEndpoint());
  }
}

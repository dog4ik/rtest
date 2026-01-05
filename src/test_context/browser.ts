import * as playwright from "playwright";
import { CONFIG } from ".";
import { DEFAULT_CONFIG } from "@/config";

export async function createBrowser() {
  let chromium = playwright.chromium;
  let server = await chromium.launchServer({
    headless: CONFIG.browser?.headless ?? DEFAULT_CONFIG.browser.headless,
  });
  return await chromium.connect(server.wsEndpoint());
}

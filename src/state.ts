import fs from "node:fs/promises";
import {
  type Config,
  postgresConnection,
  projectCredentials,
  projectUrls,
} from "@/config";
import { connectPool } from "@/db";
import { BusinessDb } from "@/db/business";
import { CoreDb } from "@/db/core";
import { SettingsDb } from "./db/settings";
import { AdminDriver } from "./driver/admin";
import { CoreDriver } from "./driver/core";
import { FlexyCommission } from "./driver/flexy_commission";
import { FlexyGuardHarness } from "./driver/flexy_guard";
import { SettingsDriver } from "./driver/settings";
import { MockServerState } from "./mock_server";
import { readProductionRb } from "./patch/production_file";
import { ProjectDir } from "./patch/project_dir";
import { GC_MAPPING_KEY, GC_MOCK_PORT } from "./provider_mocks/gateway_connect";
import {
  REACTIVEPAY_MAPPING_KEY,
  REACTIVEPAY_MOCK_PORT,
} from "./provider_mocks/reactivepay";
import { createBrowser } from "./test_context/browser";

export type SharedState = Awaited<ReturnType<typeof initState>>;

export async function initState(config: Config) {
  console.log("Initiating state", config);
  let p = config.project;
  let urls = projectUrls(config);
  let business_url = urls.business;
  let project_dir = new ProjectDir(config);
  let core_harness = new CoreDriver(urls.core, project_dir.dockerComposePath());

  let credentials = projectCredentials(config);

  let settings_service = new SettingsDriver(
    urls.settings,
    credentials.settings_credentials,
  );

  let commission_service = new FlexyCommission(
    urls.flexy_commission,
    credentials.flexy_commission_credentials,
  );

  let guard_service = new FlexyGuardHarness(
    urls.flexy_guard,
    credentials.flexy_guard_credentials,
  );

  let admin_service = new AdminDriver(urls.admin);

  let [core_db, business_db, settings_db, mapping, browser] = await Promise.all(
    [
      connectPool(postgresConnection(config, "core")),
      connectPool(postgresConnection(config, "business")),
      connectPool(postgresConnection(config, "settings")),
      fs
        .readFile(project_dir.businessProductionRbPath())
        .then((b) => b.toString())
        .then(readProductionRb),
      createBrowser(),
      core_harness.login(credentials.core_credentials),
      settings_service.login(),
      commission_service.login(credentials.flexy_commission_credentials),
      guard_service.login(credentials.flexy_guard_credentials),
    ],
  );

  mapping.set(GC_MAPPING_KEY, GC_MOCK_PORT);
  mapping.set(REACTIVEPAY_MAPPING_KEY, REACTIVEPAY_MOCK_PORT);
  if (config.extra_mapping !== undefined) {
    for (let [key, val] of Object.entries(config.extra_mapping)) {
      mapping.set(key, val);
    }
  }

  return {
    business_url,
    project: config.project,
    core_db: new CoreDb(core_db, p),
    business_db: new BusinessDb(business_db, p),
    settings_db: new SettingsDb(settings_db, p),
    core_harness,
    settings_service,
    commission_service,
    guard_service,
    admin_service,
    mock_servers: new MockServerState(mapping),
    browser,
  };
}

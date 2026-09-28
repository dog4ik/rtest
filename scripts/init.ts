import fs from "node:fs";
import * as toml from "@std/toml";
import { DummyCertPath, DummyRsaPath, DummyRsaPubPath } from "../src/assets";
import * as config from "../src/config/schema";
import { SettingsDriver } from "../src/driver/settings";

// Settings assets used by provider mocks, and the config fields holding their keys.
const DUMMY_ASSETS = [
  {
    name: "dummy_rsa",
    path: DummyRsaPath,
    field: "dummy_rsa_private_key_path",
  },
  {
    name: "dummy_rsa_pub",
    path: DummyRsaPubPath,
    field: "dummy_rsa_public_key_path",
  },
  { name: "dummy_cert", path: DummyCertPath, field: "dummy_ssl_path" },
] as const;

let path = "configuration.toml";
let { config: repaired, changes } = config.repair(path);

let project = config.projectCredentials(repaired);
let settings = new SettingsDriver(
  project.urls.settings,
  project.settings_credentials,
  repaired.project,
);
try {
  await settings.login();
  for (let asset of DUMMY_ASSETS) {
    let file = new Blob([fs.readFileSync(asset.path)]);
    let { asset: stored, created } = await settings.upsert_asset(
      asset.name,
      file,
      asset.path.split("/").at(-1) ?? asset.name,
    );
    if (created) {
      console.log(`Created settings asset ${asset.name}`);
    }
    if (project[asset.field] !== stored.file_path) {
      changes.push(
        `set ${repaired.project}.${asset.field} to ${asset.name} asset key`,
      );
      project[asset.field] = stored.file_path;
    }
  }
} catch (e) {
  console.warn(
    `Could not sync dummy assets with settings (${project.urls.settings}), keeping configured keys:`,
    e,
  );
}

if (changes.length > 0 && fs.existsSync(path)) {
  fs.copyFileSync(path, `${path}.bak`);
  console.log(`Backed up previous config to ${path}.bak`);
}
for (let change of changes) {
  console.log(`- ${change}`);
}
fs.writeFileSync(path, toml.stringify(repaired));
console.log(`Wrote ${path}`);

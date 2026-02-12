import fs from "node:fs";
import z from "zod";
import * as toml from "@std/toml";
import { ProjectSchema, type Project } from "@/project";

const DEFAULT_LOGIN_PASSWORD = {
  login: "admin@admin.admin",
  password: "admin@admin.admin",
};

const DUMMY_KEY_PLACEHOLDER = "replace with the path to the minio assert";

const DEFAULT_PROJECT_CONFIG = {
  core_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_commission_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_guard_credentials: DEFAULT_LOGIN_PASSWORD,
  settings_credentials: DEFAULT_LOGIN_PASSWORD,
  dummy_ssl_path: DUMMY_KEY_PLACEHOLDER,
  dummy_rsa_public_key_path: DUMMY_KEY_PLACEHOLDER,
  dummy_rsa_private_key_path: DUMMY_KEY_PLACEHOLDER,
} as const;

type NonUndefined<T> = T extends undefined ? never : T;

type RecursiveNonUndefineable<T> = {
  [K in keyof T]-?: RecursiveNonUndefineable<NonUndefined<T[K]>>;
};

export const DEFAULT_CONFIG: RecursiveNonUndefineable<
  z.infer<typeof CONFIG_SCHEMA>
> = {
  project: "reactivepay",
  debug: false,
  projects_dir: "..",
  browser: {
    headless: true,
    ws_url: "",
  },
  "8pay": DEFAULT_PROJECT_CONFIG,
  reactivepay: DEFAULT_PROJECT_CONFIG,
  spinpay: DEFAULT_PROJECT_CONFIG,
  paygateway: DEFAULT_PROJECT_CONFIG,
  extra_mapping: {},
} as const;

const LOGIN_PASSWORD_SCHEMA = z
  .strictObject({
    login: z.string().default(DEFAULT_LOGIN_PASSWORD.login),
    password: z.string().default(DEFAULT_LOGIN_PASSWORD.password),
  })
  .default(DEFAULT_LOGIN_PASSWORD);

const PROJECT_CONFIG = z.strictObject({
  core_credentials: LOGIN_PASSWORD_SCHEMA,
  settings_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_guard_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_commission_credentials: LOGIN_PASSWORD_SCHEMA,
  dummy_ssl_path: z.string().default(DUMMY_KEY_PLACEHOLDER),
  dummy_rsa_public_key_path: z.string().default(DUMMY_KEY_PLACEHOLDER),
  dummy_rsa_private_key_path: z.string().default(DUMMY_KEY_PLACEHOLDER),
});

const BROWSER_OBJECT = z.strictObject({
  headless: z.boolean().default(true),
  ws_url: z.string().default(""),
});

const CONFIG_SCHEMA = z.strictObject({
  extra_mapping: z.record(z.string(), z.int().positive()).optional(),
  project: ProjectSchema.default("reactivepay"),
  "8pay": PROJECT_CONFIG.optional(),
  reactivepay: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  spinpay: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  paygateway: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  browser: BROWSER_OBJECT.optional(),
  debug: z.boolean().default(false),
  projects_dir: z.string().default(".."),
});

export type Config = z.infer<typeof CONFIG_SCHEMA>;

export function parseConfig(contents: string) {
  return CONFIG_SCHEMA.parse(toml.parse(contents));
}

export function projectCredentials(
  config: Config,
): z.infer<typeof PROJECT_CONFIG> {
  return (
    (config[config.project as keyof typeof config] as z.infer<
      typeof PROJECT_CONFIG
    >) ?? PROJECT_CONFIG.parse({})
  );
}

export function open(path: string) {
  try {
    return parseConfig(fs.readFileSync(path).toString());
  } catch (e) {
    console.log("Config parse error", e);
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("Creating default configuration file");
      fs.writeFileSync(path, toml.stringify(DEFAULT_CONFIG));
    }
    return CONFIG_SCHEMA.parse({});
  }
}

export const CONFIG = {
  ...open("configuration.toml"),
  dummyRsaPub() {
    return this[this.project]!.dummy_rsa_public_key_path;
  },
  dummyRsa() {
    return this[this.project]!.dummy_rsa_private_key_path;
  },
  dummyCert() {
    return this[this.project]!.dummy_ssl_path;
  },
  in_project(projects: Project[] | Project) {
    if (Array.isArray(projects)) {
      return projects.includes(this.project);
    }
    return projects === this.project;
  },
};
export const PROJECT = CONFIG.project;

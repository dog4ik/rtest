import fs from "node:fs";
import * as toml from "@std/toml";
import z from "zod";
import { type Project, ProjectSchema } from "@/project";

const DEFAULT_LOGIN_PASSWORD = {
  login: "admin@admin.admin",
  password: "admin@admin.admin",
};

const DEFAULT_ADMIN_CREDENTIALS = {
  login: "admin@admin.admin",
  password: "admin@admin.admin",
};

const DUMMY_KEY_PLACEHOLDER = "replace with the path to the minio assert";

// Connection defaults applied per database when a field is omitted.
const DEFAULT_POSTGRES_CREDS = {
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "postgres",
} as const;

const DEFAULT_URLS = {
  core: "http://localhost:3000",
  business: "http://localhost:4000",
  settings: "http://localhost:6001",
  flexy_commission: "http://localhost:7082",
  flexy_guard: "http://localhost:7081",
  admin: "http://localhost:3002",
  trader: "http://localhost:4080",
  trader_sms: "http://localhost:5070",
  pixelwave: "http://localhost:4207",
  postgres: {
    core: {
      ...DEFAULT_POSTGRES_CREDS,
      database: "reactivepay_core_production",
    },
    business: {
      ...DEFAULT_POSTGRES_CREDS,
      database: "reactivepay_business_production",
    },
    settings: {
      ...DEFAULT_POSTGRES_CREDS,
      database: "reactivepay_settings_production",
    },
  },
  redis: "redis://localhost:6379",
  mongo: "mongodb://localhost:27017",
} as const;

const DEFAULT_PROJECT_CONFIG = {
  core_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_commission_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_guard_credentials: DEFAULT_LOGIN_PASSWORD,
  settings_credentials: DEFAULT_LOGIN_PASSWORD,
  admin_credentials: DEFAULT_ADMIN_CREDENTIALS,
  dummy_ssl_path: DUMMY_KEY_PLACEHOLDER,
  dummy_rsa_public_key_path: DUMMY_KEY_PLACEHOLDER,
  dummy_rsa_private_key_path: DUMMY_KEY_PLACEHOLDER,
  urls: DEFAULT_URLS,
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
  a2: DEFAULT_PROJECT_CONFIG,
  paysure: DEFAULT_PROJECT_CONFIG,
  fxmb: DEFAULT_PROJECT_CONFIG,
  kotulapay: DEFAULT_PROJECT_CONFIG,
  extra_mapping: {},
  flexy_flexy: false,
  patch_volumes: false,
} as const;

const LOGIN_PASSWORD_SCHEMA = z
  .strictObject({
    login: z.string().default(DEFAULT_LOGIN_PASSWORD.login),
    password: z.string().default(DEFAULT_LOGIN_PASSWORD.password),
  })
  .default(DEFAULT_LOGIN_PASSWORD);

const ADMIN_CREDENTIALS_SCHEMA = z
  .strictObject({
    login: z.string().default(DEFAULT_ADMIN_CREDENTIALS.login),
    password: z.string().default(DEFAULT_ADMIN_CREDENTIALS.password),
  })
  .default(DEFAULT_ADMIN_CREDENTIALS);

// Per-database connection. Every field has its own default: `database` is the
// legacy production name, the rest fall back to DEFAULT_POSTGRES_CREDS.
function postgresDbSchema(database: string) {
  return z
    .strictObject({
      database: z.string().default(database),
      host: z.string().default(DEFAULT_POSTGRES_CREDS.host),
      port: z.int().positive().default(DEFAULT_POSTGRES_CREDS.port),
      user: z.string().default(DEFAULT_POSTGRES_CREDS.user),
      password: z.string().default(DEFAULT_POSTGRES_CREDS.password),
    })
    .default({ ...DEFAULT_POSTGRES_CREDS, database });
}

const URLS_SCHEMA = z
  .strictObject({
    core: z.string().default(DEFAULT_URLS.core),
    business: z.string().default(DEFAULT_URLS.business),
    settings: z.string().default(DEFAULT_URLS.settings),
    flexy_commission: z.string().default(DEFAULT_URLS.flexy_commission),
    flexy_guard: z.string().default(DEFAULT_URLS.flexy_guard),
    admin: z.string().default(DEFAULT_URLS.admin),
    trader: z.string().default(DEFAULT_URLS.trader),
    trader_sms: z.string().default(DEFAULT_URLS.trader_sms),
    pixelwave: z.string().default(DEFAULT_URLS.pixelwave),
    postgres: z
      .strictObject({
        core: postgresDbSchema(DEFAULT_URLS.postgres.core.database),
        business: postgresDbSchema(DEFAULT_URLS.postgres.business.database),
        settings: postgresDbSchema(DEFAULT_URLS.postgres.settings.database),
      })
      .default(DEFAULT_URLS.postgres),
    redis: z.string().default(DEFAULT_URLS.redis),
    mongo: z.string().default(DEFAULT_URLS.mongo),
  })
  .default(DEFAULT_URLS);

const PROJECT_CONFIG = z.strictObject({
  core_credentials: LOGIN_PASSWORD_SCHEMA,
  settings_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_guard_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_commission_credentials: LOGIN_PASSWORD_SCHEMA,
  admin_credentials: ADMIN_CREDENTIALS_SCHEMA,
  dummy_ssl_path: z.string().default(DUMMY_KEY_PLACEHOLDER),
  dummy_rsa_public_key_path: z.string().default(DUMMY_KEY_PLACEHOLDER),
  dummy_rsa_private_key_path: z.string().default(DUMMY_KEY_PLACEHOLDER),
  urls: URLS_SCHEMA,
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
  kotulapay: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  spinpay: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  paygateway: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  a2: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  fxmb: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  paysure: PROJECT_CONFIG.default(DEFAULT_PROJECT_CONFIG),
  browser: BROWSER_OBJECT.optional(),
  debug: z.boolean().default(false),
  patch_volumes: z.boolean().default(false),
  projects_dir: z.string().default(".."),
  flexy_flexy: z.boolean().default(false),
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

export function projectUrls(config: Config): z.infer<typeof URLS_SCHEMA> {
  return projectCredentials(config).urls;
}

export type PostgresDatabase = "core" | "business" | "settings";

/** Resolve connection params for one of a project's postgres databases. */
export function postgresConnection(config: Config, db: PostgresDatabase) {
  return projectUrls(config).postgres[db];
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
    return this[this.project]?.dummy_rsa_public_key_path;
  },
  dummyRsa() {
    return this[this.project]?.dummy_rsa_private_key_path;
  },
  dummyCert() {
    return this[this.project]?.dummy_ssl_path;
  },
  urls() {
    return projectUrls(this);
  },
  /** Resolve the connection parameters for one of the project's databases. */
  postgres(db: PostgresDatabase) {
    return this.urls().postgres[db];
  },
  in_project(projects: Project[] | Project) {
    if (Array.isArray(projects)) {
      return projects.includes(this.project);
    }
    return projects === this.project;
  },
};
export const PROJECT = CONFIG.project;

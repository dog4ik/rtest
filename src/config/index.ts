import fs from "node:fs";
import z from "zod";
import * as toml from "@std/toml";
import { ProjectSchema } from "@/project";

const DEFAULT_LOGIN_PASSWORD = {
  login: "admin@admin.admin",
  password: "admin@admin.admin",
};

const DEFAULT_PROJECT_CREDENTIALS = {
  core_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_commission_credentials: DEFAULT_LOGIN_PASSWORD,
  flexy_guard_credentials: DEFAULT_LOGIN_PASSWORD,
  settings_credentials: DEFAULT_LOGIN_PASSWORD,
} as const;

type RecursiveNonNullable<T> = {
  [K in keyof T]-?: RecursiveNonNullable<NonNullable<T[K]>>;
};

export const DEFAULT_CONFIG: RecursiveNonNullable<
  z.infer<typeof CONFIG_SCHEMA>
> = {
  project: "reactivepay",
  debug: false,
  browser: {
    headless: true,
  },
  "8pay": DEFAULT_PROJECT_CREDENTIALS,
  reactivepay: DEFAULT_PROJECT_CREDENTIALS,
  spinpay: DEFAULT_PROJECT_CREDENTIALS,
  extra_mapping: {},
} as const;

const LOGIN_PASSWORD_SCHEMA = z
  .strictObject({
    login: z.string().default(DEFAULT_LOGIN_PASSWORD.login),
    password: z.string().default(DEFAULT_LOGIN_PASSWORD.password),
  })
  .default(DEFAULT_LOGIN_PASSWORD);

const CREDENTIALS_OBJECT = z.strictObject({
  core_credentials: LOGIN_PASSWORD_SCHEMA,
  settings_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_guard_credentials: LOGIN_PASSWORD_SCHEMA,
  flexy_commission_credentials: LOGIN_PASSWORD_SCHEMA,
});

const BROWSER_OBJECT = z.strictObject({
  headless: z.boolean().default(true),
});

const CONFIG_SCHEMA = z.strictObject({
  extra_mapping: z.record(z.string(), z.int().positive()).optional(),
  project: ProjectSchema.default("reactivepay"),
  "8pay": CREDENTIALS_OBJECT.optional(),
  reactivepay: CREDENTIALS_OBJECT.optional(),
  spinpay: CREDENTIALS_OBJECT.optional(),
  browser: BROWSER_OBJECT.optional(),
  debug: z.boolean().default(false),
});

export type Config = z.infer<typeof CONFIG_SCHEMA>;

export function parseConfig(contents: string) {
  return CONFIG_SCHEMA.parse(toml.parse(contents));
}

export function projectCredentials(
  config: Config,
): z.infer<typeof CREDENTIALS_OBJECT> {
  return (
    (config[config.project as keyof typeof config] as z.infer<
      typeof CREDENTIALS_OBJECT
    >) ?? CREDENTIALS_OBJECT.parse({})
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

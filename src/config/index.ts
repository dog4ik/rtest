import type { Project } from "@/project";
import { open, type PostgresDatabase, projectUrls } from "./schema";

export * from "./schema";

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

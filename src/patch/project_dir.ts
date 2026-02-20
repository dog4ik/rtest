import type { Config } from "@/config";
import type { Project } from "@/project";
import path from "node:path";

export class ProjectDir {
  path: string;
  constructor(config: Config) {
    console.log(config);
    this.path = resolveProjectDir(config);
  }

  dockerComposePath() {
    return path.resolve(this.path, "docker-compose.yml");
  }

  businessProductionRbPath() {
    return path.resolve(
      this.path,
      "services",
      "business",
      "config",
      "environments",
      "production.rb",
    );
  }
}

const PROJECT_DIR_MAP: Record<Project | string, string> = {
  reactivepay: "rpay-engine-pcidss",
  reactivepaystage: "rpay-engine-pcidss",
  "8pay": "rpay-engine-8pay",
  spinpay: "rpay-engine-spinpay",
  paygateway: "rpay-engine-paygateway",
  a2: "rpay-engine-a2",
};

function resolveProjectDir(config: Config) {
  let repoName = (project: Project) => {
    let dir = PROJECT_DIR_MAP[project];
    if (dir) return dir;
    throw Error(`Unsupported project: ${project}`);
  };

  return path.resolve(config.projects_dir, repoName(config.project));
}

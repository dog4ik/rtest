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

function resolveProjectDir(config: Config) {
  let repoName = (project: Project) => {
    if (project == "reactivepay" || project === "reactivepaystage") {
      return "rpay-engine-pcidss";
    } else if (project == "8pay") {
      return "rpay-engine-8pay";
    } else if (project == "spinpay") {
      return "rpay-engine-spinpay";
    }
    throw Error(`Unsupported project: ${project}`);
  };

  return path.resolve(config.projects_dir, repoName(config.project));
}

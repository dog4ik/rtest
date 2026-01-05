import type { Project } from "@/project";
import path from "node:path";

export class ProjectDir {
  path: string;
  constructor(project: Project) {
    this.path = resolveProjectDir(project);
  }

  dockerComposePath()  {
    return path.resolve(this.path, "docker-compose.yml")
  }

  businessProductionRbPath()  {
    return path.resolve(this.path, "services", "business", "config", "environments", "production.rb")
  }
}

function resolveProjectDir(project: Project) {
  let repoName = (project: Project) => {
    if (project == "reactivepay" || project === "reactivepaystage") {
      return "rpay-engine-pcidss"
    } else if (project == "8pay") {
      return "rpay-engine-8pay"
    }
    throw Error(`Unsupported project: ${project}`)
  }

  return path.resolve("..", repoName(project))
}

import fs from "node:fs";
import tracing from "@/tracing";
import { patchedDockerCompose } from "./docker_compose";
import { patchProductionRb } from "./production_file";
import { ProjectDir } from "./project_dir";
import type { Project } from "@/project";
import { applyGitPatch } from "./git_patch";

// todo: handle io errors
export async function patchProject(project: Project) {
  let project_dir = new ProjectDir(project);
  tracing.info(`Resolved project dir path: ${project_dir.path}`);

  let docker_compose_path = project_dir.dockerComposePath();
  let docker_compose_contents = fs.readFileSync(docker_compose_path);
  // todo handle errors more gracefully
  tracing.info(
    { path: docker_compose_path },
    "Writing in the docker compose file",
  );
  fs.writeFileSync(
    docker_compose_path,
    patchedDockerCompose(docker_compose_contents.toString()),
  );

  let production_rb_path = project_dir.businessProductionRbPath();
  let production_rb_contents = fs.readFileSync(production_rb_path);
  let { mapping, patched } = patchProductionRb(
    production_rb_contents.toString(),
  );
  fs.writeFileSync(production_rb_path, patched);
  tracing.info(
    { path: production_rb_path },
    `Patched production rb file with ${mapping.size} entries`,
  );

  await applyGitPatch(project_dir.path, "csrf_core.patch");
  await applyGitPatch(project_dir.path, "csrf_settings.patch");
}

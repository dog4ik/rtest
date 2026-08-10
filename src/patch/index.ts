import fs from "node:fs";
import type { Config } from "@/config";
import { patchedDockerCompose } from "./docker_compose";
import { applyGitPatch } from "./git_patch";
import { patchProductionRb } from "./production_file";
import { ProjectDir } from "./project_dir";

// todo: handle io errors
export async function patchProject(config: Config) {
  let project_dir = new ProjectDir(config);
  console.log(`Resolved project dir path: ${project_dir.path}`);

  let docker_compose_path = project_dir.dockerComposePath();
  let docker_compose_contents = fs.readFileSync(docker_compose_path);
  // todo handle errors more gracefully
  console.log(
    { path: docker_compose_path },
    "Writing in the docker compose file",
  );
  fs.writeFileSync(
    docker_compose_path,
    patchedDockerCompose(docker_compose_contents.toString(), config),
  );

  let production_rb_path = project_dir.businessProductionRbPath();
  let production_rb_contents = fs.readFileSync(production_rb_path);
  let { mapping, patched } = patchProductionRb(
    production_rb_contents.toString(),
  );
  fs.writeFileSync(production_rb_path, patched);
  console.log(
    { path: production_rb_path },
    `Patched production rb file with ${mapping.size} entries`,
  );

  await applyGitPatch(project_dir.path, "csrf_core.patch");
  await applyGitPatch(project_dir.path, "csrf_admin.patch");
  if (config.project === "a2") {
    await applyGitPatch(project_dir.path, "csrf_settings_a2.patch");
  } else {
    await applyGitPatch(project_dir.path, "csrf_settings.patch");
  }
}

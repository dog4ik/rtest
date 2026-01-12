import { patchProject } from "../src/patch"
import * as config from "../src/config"

await patchProject(config.open("configuration.toml"))

import * as config from "../src/config";
import { patchProject } from "../src/patch";

await patchProject(config.open("configuration.toml"));

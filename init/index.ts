import fs from "node:fs";
import * as toml from "@std/toml";
import * as config from "../src/config";

let path = "configuration.toml";
fs.writeFileSync(path, toml.stringify(config.open(path)));

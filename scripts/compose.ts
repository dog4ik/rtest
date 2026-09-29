import * as config from "../src/config";
import { runCompose } from "../src/patch";

await runCompose(config.open("configuration.toml"), process.argv.slice(2));

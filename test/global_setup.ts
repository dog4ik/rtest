import * as config from "@/config/schema";

export default function setup() {
  config.open("configuration.toml");
}

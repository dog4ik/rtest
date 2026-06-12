import { createClient } from "redis";
import { CONFIG } from "@/config";

function makeClient() {
  return createClient({ url: CONFIG.urls().redis });
}

class RedisDriver {
  client: ReturnType<typeof makeClient>;
  constructor() {
    this.client = makeClient();
  }
  async connect() {
    await this.client.connect();
  }
}

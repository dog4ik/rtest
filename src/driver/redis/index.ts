import { createClient } from "redis";

function makeClient() {
  return createClient({ url: "redis://127.0.0.1:6379" });
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

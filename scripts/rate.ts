import { spawn_provider_server } from "@/mock_server/api";
import { RATE_MOCK_PORT, RateDriver, STATIC_RATE } from "@/provider_mocks/rate";

let driver = new RateDriver();
let { handlers, server } = spawn_provider_server(RATE_MOCK_PORT);

handlers.push({
  filter: () => true,
  handler: driver._handler.bind(driver),
});

server.on("listening", () => {
  console.log(`Rate service mock listening on port ${RATE_MOCK_PORT}`);
  console.log(`Serving a static rate of ${STATIC_RATE}`);
});

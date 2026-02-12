import { CONFIG } from "@/config";
import { test } from "@/test_context";
import { delay } from "@std/async";

test.fails("test should fail after it finishes", async ({ ctx, skip }) => {
  skip(!CONFIG.debug);
  delay(200).then(() => ctx.testBackgroundReject("bad stuff"));
  await delay(1000);
});

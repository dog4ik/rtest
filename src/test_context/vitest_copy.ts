import type { TestAPI } from "vitest";
import type { TestContext } from ".";

export function createTestWrapper(baseTest: TestAPI) {
  const wrapper = ((
    name: string,
    fn: TestFn<TestContext>,
    timeout?: number,
  ) => {
    return baseTest<TestContext>(
      name,
      async (ctx) => {
        await Promise.race([
          fn(ctx),
          ctx.ctx.testBackgroundPromise, // injected via fixture
        ]);
      },
      timeout,
    );
  }) as TestAPI;

  // Re-export all modifiers using the same wrapper pattern
  wrapper.only = ((name, fn, timeout) =>
    baseTest.only<TestContext>(
      name,
      async (ctx) => {
        await Promise.race([fn(ctx), ctx.ctx.testBackgroundPromise]);
      },
      timeout,
    )) as typeof wrapper.only;

  wrapper.skip = ((name, fn, timeout) =>
    baseTest.skip<TestContext>(
      name,
      async (ctx) => {
        await Promise.race([fn(ctx), ctx.ctx.testBackgroundPromise]);
      },
      timeout,
    )) as typeof wrapper.skip;

  wrapper.todo = baseTest.todo;
  wrapper.each = baseTest.each;
  wrapper.extend = baseTest.extend;
  wrapper.concurrent = baseTest.concurrent;
  wrapper.for = baseTest.for;

  return wrapper;
}

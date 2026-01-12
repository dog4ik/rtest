# Rtest

### A testing framework for ReactivePay for E2E testing and provider mocking.

## Overview

- **End-to-end testing** for payment flows
- **Provider mocking** for external payment providers
- **Project patching** for test environment setup
- **Browser automation** with Playwright

## Get started

Необходимые системные зависимости: Node.js >= 24.0.0

1. Установить зависимости проекта: `npm i` && `npx playwright install`
2. Выполнить команду `npm run init` - будет создан конфигурационный файл `configuration.toml` с настройками по умолчанию.
3. В конфигурационном файле указать параметр `projects_dir`, задав путь к каталогу с проектами, например: `~/work`, поменять пароли сервисам, если нужно.
4. Повторно выполнить `npm run patch` - в клиентском проекте должны появиться изменения.
5. После успешного применения патча запустить проект стандартным способом.
6. Запустить тесты командой: `npm run test:ui`.

## Available Scripts

- `npm test` - Run tests with Vitest
- `npm run test:ui` - Run tests with Vitest UI
- `npm run test:run` - Run tests once
- `npm run patch` - Apply project patches
- `npm run init` - Init configuration file

### Core Components

- **Context** (`src/test_context/context.ts`) - Main test context providing core operations and mock server capabilities
- **Mock Server** (`src/mock_server/`) - HTTP server for mocking external providers
- **Database Layer** (`src/db/`) - PostgreSQL integration for core and settings databases
- **Driver Layer** (`src/driver/`) - Microservices drivers
- **Entities** (`src/entities/`) - Extended merchant and notification entities with helper methods
- **Patch System** (`src/patch/`) - Project patching for test environment setup

## Project Patching

```bash
npm run patch
```

This applies:

- Docker Compose modifications
- Production file patches
- Git patches to disable CSRF protection

## Development / Writing tests

It is important that all errors/asserts can be observed inside vitest test context.
Otherwise asserts/errors will get ignored.

Example (BAD):

```typescript
test("test test", async ({ ctx }) => {
  // assertion is ignored
  delay(200).then(() => assert.fail("something failed"));
  await delay(1000);
});
```

```typescript
test("test test", async ({ ctx }) => {
  // assertion will be caught only after the test is finished
  provider.queue(() => assert.fail("something failed"));
  await delay(1000);
});
```

Example (GOOD):

```typescript
test("test test", async ({ ctx }) => {
  // assert.fail throw is visible to the test
  await Promise.all(
    delay(200).then(() => assert.fail("something failed")),
    delay(1000),
  );
});
```

```typescript
test("test test", async ({ ctx }) => {
  // assertion will stop the test with failure
  await provider.queue(() => assert.fail("something failed"));
  await delay(1000);
});
```

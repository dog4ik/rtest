# Rtest

### Тестовый фреймворк для ReactivePay, предназначенный для E2E-тестирования и мокинга провайдеров.

## Функционал

- End-to-end тестирование платёжных сценариев
- Мокинг провайдеров внешних платёжных систем
- Патчинг проектов для подготовки тестового окружения
- Автоматизация браузера с использованием Playwright

## Get started

Необходимые системные зависимости: Node.js >= 24.0.0

1. Установить зависимости проекта: `npm i` && `npx playwright install`
2. Выполнить команду `npm run init` - будет создан конфигурационный файл `configuration.toml` с настройками по умолчанию.
3. В конфигурационном файле указать параметр `projects_dir`, задав путь к каталогу с проектами, например: `~/work` если проект находится в `~/work/rpay-engine-pcidss`.
4. Повторно выполнить `npm run patch` - в клиентском проекте должны появиться изменения.
5. После успешного применения патча запустить проект стандартным способом.
6. Запустить тесты командой: `npm run test`.

## Доступные скрипты

- `npm run test` - запуск тестов по одному файлу
- `npm run test:all` - concurrent запуск всех тестов
- `npm run patch` - применение патчей к проекту
- `npm run init` - инициализация конфигурационного файла

## Патчинг проекта

Перед применением патчей лучше работать с чистой веткой.

```bash
npm run patch
```

### Команда применяет следующие изменения:

- добавляет healthcheck для сервисов в Docker Compose и пробрасывает контейнеры в host-сеть
- патчит URL провайдеров в production.rb
- применяет git-патчи для отключения CSRF

## Development / Writing tests

- Все тесты должны быть помечены как concurrent. В противном случае тестовый раннер будет выполнять их последовательно.

- Все настройки 8pay по умолчанию имеют параметр `wrapped_to_json_response: true`, если не указано иначе.

- Важно, чтобы все ошибки и ассерты были наблюдаемы в контексте vitest-теста. В противном случае ошибки и ассерты будут проигнорированы.

Пример (Плохо):

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

Пример (Хорошо):

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

### Gateway connect integration tests

```
    Test
   /    \
 RP <--> GC integration
```

В данных интеграционных тестах тестовый сервис одновременно выступает мерчантом и провайдером.

Чтобы запустить тест gateway connect интеграции нужно:

1. Включить интеграцию в docker-compose
2. В файле `services/business/config/gateways_routing.yml` указать `full_url`, ссылающийся на контейнер и порт интеграции.
3. Настроить `CALLBACK_URL` для "провайдера"(провайдером является тест) так, чтобы он указывал на контейнер с интеграцией.
4. В ENV интеграции задать URL провайдера в формате `http://host.docker.internal:PORT`
5. Добавить используемый порт в конфигурацию тестов. Например:

```
[extra_mapping]
manypay = 6666
metricengine = 6667
stbl = 6668
```

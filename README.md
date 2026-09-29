# Rtest

### Тестовый фреймворк для ReactivePay, предназначенный для E2E-тестирования и мокинга провайдеров.

## Get started

Необходимые системные зависимости: Node.js >= 24.0.0, git, docker compose

1. Установить зависимости проекта: `npm i` && `npx playwright install`
2. Выполнить команду `npm run init` - будет создан конфигурационный файл `configuration.toml` с настройками по умолчанию.
3. В конфигурационном файле указать параметр `projects_dir`, задав путь к каталогу с проектами, например: `~/work` если проект находится в `~/work/rpay-engine-pcidss`. Либо указать путь к конкретному проекту параметром `path` в секции проекта (см. [Конфигурация проектов](#конфигурация-проектов)).
4. Запустить проект командой `npm run start` (см. [Запуск проекта](#запуск-проекта)). Репозиторий проекта при этом не изменяется.
5. Дождаться запуска сервисов.
6. Запустить тесты командой: `npm run test`.

## Доступные скрипты

- `npm run test` - запуск тестов по одному файлу
- `npm run test:all` - concurrent запуск всех тестов
- `npm run start` - запуск проекта (`docker compose up --build`) с патчами, применёнными в рантайме. Аргументы пробрасываются: `npm run start -- -d`.
- `npm run compose -- <cmd>` - любая команда docker compose с теми же патчами: `npm run compose -- down`, `npm run compose -- logs -f business`, `npm run compose -- run --rm business bash`
- `npm run init` - инициализация конфигурационного файла, подготовка проекта
- `npm run cleanup` - удаление созданных тестовых аккаунтов
- `npm run playground` - запустить тестовый траффик на трейдеров пока процесс не получит sigint
- `npm run rate` - Запустить моку rate сервиса с статичным курсом валюты.

## configuration.toml

Файл конфигурации содержит основные параметры для запуска тестов.

### Глобальные параметры

- **project** - название проекта, в котором будут работать тесты (например: `reactivepay`, `8pay`, `spinpay`, `a2`, `paygateway`)
- **projects_dir** - путь к каталогу, где расположены проекты (например: `..` или `/path/to/projects`)
- **flexy_flexy** - включить/выключить совместимость с новым flexy_guard
- **patch_volumes** - при запуске (`npm run start`) подменяет docker volumes сервисов `postgres`, `mongo` и `minio` на отдельные именованные тома (`postgres-data-test`, `mongo-data-test`, `minio-data-test`, `minio-config-test`), чтобы тестовые данные не смешивались с данными основного проекта. Однако требует повторно настравывать проект на новом volume
- **mock_rate** - Использовать моку сервиса rate

Секция `[extra_mapping]` позволяет переопределить порты для провайдеров:

```toml
[extra_mapping]
provider_name = 6666
```

### Конфигурация проектов

Некоторые провайдеры тесты требуют ассеты. Тесты использует общий набор ассетов для всех провайдеров (папка ./assets/).

Для каждого проекта (a2, 8pay, reactivepay, spinpay, paygateway) необходимо настроить:

- **dummy_ssl_path** - minio путь к SSL сертификату из ./assets/cert.pem для мокирования HTTPS запросов
- **dummy_rsa_public_key_path** - minio путь к публичному RSA ключу
- **dummy_rsa_private_key_path** - minio путь к приватному RSA ключу

Опционально:

- **path** - путь к каталогу конкретного проекта (например: `/path/to/rpay-engine-pcidss`). Если указан, используется вместо `projects_dir`. Относительный путь разрешается от текущего рабочего каталога.

```toml
[reactivepay]
path = "../rpay-engine-pcidss"
dummy_ssl_path = "a9bvYvWDgfoBu1nFdze5TVBb"
dummy_rsa_public_key_path = "bJXK9oBAcAUmGkNUFUEvJiSH"
dummy_rsa_private_key_path = "BYJHRMhwGbfyhk9ye41qXURv"
```

### Учетные данные

Для каждого проекта указываются учетные данные для доступа к различным сервисам:

- `[PROJECT.settings_credentials]` - учетные данные для сервиса Settings
- `[PROJECT.flexy_guard_credentials]` - учетные данные для Flexy Guard
- `[PROJECT.flexy_commission_credentials]` - учетные данные для Flexy Commission
- `[PROJECT.core_credentials]` - учетные данные для Core сервиса

Каждая секция содержит поля `login` и `password`.
По умолчанию логин и пароль - `admin@admin.admin`

### Конфигурация браузера

Секция `[browser]` содержит параметры для Playwright:

- **headless** - запуск браузера в режиме headless (без UI). Установите в `false` для визуального отладки тестов
- **ws_url** - URL для подключения удаленного браузера (пустое для локального браузера)

## Запуск проекта

Чтобы тесты могли интерактировать с проектом без припядствий необходимы некотороые изменения в проекте.
Они применяются в рантайме.

```bash
npm run start
```

Команда:

- генерирует пропатченные копии файлов проекта в `.generated/<project>/` (gitignored)
- генерирует `.generated/<project>/docker-compose.yml` на основе `docker-compose.yml` проекта: healthcheck-и сервисов, `host.docker.internal`, mock rate, `patch_volumes`
- монтирует пропатченные файлы (read-only) поверх оригиналов во все сервисы, которые монтируют их каталог:
  - `production.rb` - URL провайдеров ведут в тесты.
    Сделано так, потому что не все параметры в production.rb можно перепесать через env
  - git-патчи из `git_patches/` для отключения CSRF (чтобы ускорить и упростить фронтовые запросы в core/manage)
- запускает `docker compose --project-directory <project> -f .generated/<project>/docker-compose.yml [-f <project>/docker-compose.override.yml] up --build`.
  Имя compose-проекта, volumes и `.env` те же, что и при обычном запуске из каталога проекта.

Тесты берут маппинг портов провайдеров из сгенерированного `production.rb`, поэтому проект должен быть запущен через `npm run start`.
Изменения в `docker-compose.yml` или `production.rb` проекта подхватываются при следующем `npm run start`.

### Переход со старого `npm run patch`

Откатить ранее применённые патчи в проекте:

```bash
git -C <project> checkout -- docker-compose.yml services/business/config/environments/production.rb services/core/config/application.rb services/settings/config/initializers/rails_admin.rb
```

## Development / Writing tests

- Все тесты должны быть помечены как concurrent. В противном случае тестовый раннер будет выполнять их последовательно.

- Важно, чтобы все ошибки и ассерты были наблюдаемы в контексте vitest-теста. В противном случае ошибки и ассерты будут проигнорированы.

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

# FaceSwap app

Локальное приложение для face swap через ComfyUI (ReActor). Два фото — одна кнопка.

## Запуск

    npm run dev

Откроется http://localhost:7100. Нужна нода ReActor (Gourieff) с моделью `inswapper_128.onnx` в ComfyUI.

Приложение поднимает собственный выделенный экземпляр ComfyUI (порт 8199, свой `--user-directory`, `--disable-assets`) — кнопкой в интерфейсе или через `/api/start-comfyui`. Супервизор автоматически переподнимает ComfyUI, если он упал, и завершает его вместе с приложением.

## Конфигурация

`config.json` рядом с сервером (необязателен — есть автоопределение):

```json
{ "comfyDir": "Z:\\Comfy\\ComfyUI_windows_portable", "comfyPort": 8199 }
```

- `comfyDir` — папка установки ComfyUI portable (автоопределение: `comfyui/` рядом с приложением → `Z:\Comfy\ComfyUI_windows_portable`)
- `comfyPort` — порт выделенного экземпляра (по умолчанию 8199)

Переменные окружения: `PORT`, `HOST`, `COMFY_URL` (переопределяет адрес), `FACESWAP_DATA_DIR` (результаты/uploads/comfy-user), `KEEP_COMFY_ON_EXIT=1` (не убивать ComfyUI при выходе сервера).

## Как это работает

1. Браузер отправляет два фото на локальный сервер (`server.js`, Node без зависимостей).
2. Сервер заливает их в ComfyUI (`/upload/image`) и ставит в очередь workflow `workflow-face-swap.json` (`/prompt`).
3. Результат забирается через `/history` + `/view`, сохраняется в `results/` и показывается в интерфейсе; история — последние 24 результата.

## Сборка дистрибутива (фаза 4)

Требуется: Rust (rustup) + VS Build Tools (MSVC) + Inno Setup 7. Node-пользователю не нужен — в установщик зашит `node.exe` (сайдкар).

    npm run build:installer        # dist-web → cargo build --release → Inno Setup
    # или по шагам:
    npm run build:web              # статика в dist-web/
    npm run build:app              # + FaceSwap.exe (target\release\)
    # установщик вручную:
    iscc installer\faceswap.iss
    # релизная сборка "из коробки" с ComfyUI (~7 ГБ):
    iscc installer\faceswap.iss /DCOMFYUI_SOURCE="Z:\Comfy\ComfyUI_windows_portable"

Установка — per-user, без прав администратора: `{localappdata}\Programs\FaceSwap`. При закрытии приложения сервер и ComfyUI завершаются. Пользовательские данные — `%LOCALAPPDATA%\FaceSwap\data` (не удаляются при деинсталляции).

## Структура

- `server.js` — статика + API (`/api/status`, `/api/swap`, `/api/results`, `/api/start-comfyui`, `/api/setup/status`, `/api/setup/install`, `/api/restart-comfyui`)
- `workflow-face-swap.json` — шаблон workflow (ReActor Fast Face Swap)
- `models-manifest.json` — манифест установки: нода ReActor (zip + pip) и модели (URL, размер, SHA-256); проверяется при установке, битые файлы перекачиваются. `models-manifest.local.json` — необязательные локальные дополнения
- `index.html`, `styles.css`, `app.js` — интерфейс
- `src-tauri/` — Tauri-оболочка (Rust): поднимает сайдкар, ждёт порт, открывает окно, убивает дерево процессов при выходе
- `installer/faceswap.iss` — Inno Setup 7
- `sidecar/node.exe` — Node runtime для установщика
- `scripts/build-web.js`, `scripts/make-icons.py` — сборка ресурсов и иконок

## Шрифт

Manrope — лицензия OFL, файлы в `fonts/` (© The Manrope Project).


# Desktop ledger — Electron & Tauri concepts vs this platform

Step 5 of the plan: a research spike, recommendation only (approved rows
are implemented as step 6). Sources
([Electron API index](https://www.electronjs.org/docs/latest/api/app),
[Tauri v2 plugins](https://v2.tauri.app/plugin/)) were read 2026-10-16;
this file records concepts only — no API is copied, and Electron's
main/renderer process split is explicitly *not* adopted (our Blink host
and native targets have their own process story in `runtime/chromium`).

Dispositions as in coverage.md. `adopt-6` = real portable gap, interface
written in step 6. `covered` = already in draft 1. Concepts unique to
Electron/Tauri internals (ipcMain, webContents, command scopes) are
recorded as architecture, not APIs.

| Concept (source names) | Disposition | Home | Call |
|---|---|---|---|
| App lifecycle/quit/paths (Electron app, Tauri app) | sdk-gap | `sdk:app` | covered |
| Single-instance lock + second-instance args (both) | sdk-gap | `sdk:app` extension | adopt-6 |
| Windows, views (BrowserWindow, WebviewWindow) | sdk-gap | `sdk:windows` | covered (content binding still UI-layer) |
| Window state persistence (Tauri plugin) | compose | `sdk:storage` + geometry in `sdk:windows` | recorded — no module needed |
| Menus/context menus (both) | sdk-gap | `sdk:shell` | covered (was provisional) |
| Tray (both) | sdk-gap | `sdk:shell` | covered |
| Dialogs (both) | sdk-gap | `sdk:shell` + `sdk:documents` | covered |
| Global shortcuts (both) | sdk-gap | `sdk:shell` | covered |
| Autostart at login (Tauri plugin, Electron login items) | sdk-gap | `sdk:shell` | covered |
| Notifications (both) | standard + sdk-gap | `lib:Notification` `sdk:notifications` | covered |
| Clipboard incl. formats (both) | web-standard | `lib:Clipboard` | covered |
| Shell: open external, reveal in folder, trash (Electron shell, Tauri opener) | sdk-gap | `sdk:linking` + `sdk:shell` extension | adopt-6 (reveal/trash) |
| Deep linking, protocol/file handler registration (Tauri deep-link, Electron protocol) | build/config + sdk-gap | registration in product config; delivery `sdk:app` URL events | recorded |
| Displays: enumerate, work area, scale, changes (Electron screen) | sdk-gap | `sdk:displays` (desktop) | adopt-6 — Web Window Management is the shape reference |
| Appearance: dark mode, accent (nativeTheme, systemPreferences) | sdk-gap | `sdk:appearance` (shared — mobile has it too) | adopt-6 |
| Power: idle state, battery events, prevent sleep (powerMonitor, powerSaveBlocker) | sdk-gap | `sdk:power` (desktop) | adopt-6 — display sleep already `lib:WakeLock` |
| Screen/window capture sources (desktopCapturer) | standard + sdk-gap | `getDisplayMedia` in `lib:MediaDevices`; enumerate sources = `sdk:capture` (desktop) | adopt-6 |
| Secure storage (safeStorage, Stronghold) | sdk-gap | `sdk:security` | covered |
| Biometrics (Tauri plugin) | sdk-gap | `sdk:security` | covered |
| Geolocation, haptics, NFC, barcode (Tauri mobile plugins) | various | covered in coverage.md; NFC remains deferred (step 3) | recorded |
| File system with scopes (Tauri fs + persisted scope) | standard + sdk-gap | `sdk:documents` grants | covered — Tauri's scope model validates our grant handles |
| HTTP client (Tauri) | web-standard | `fetch` | recorded |
| SQL / Store (Tauri) | node-layer / sdk-gap | `node:sqlite`; `sdk:storage` | recorded / covered |
| Logging (Tauri) | web-standard | `lib:Console` | recorded |
| CLI args, process, shell spawn, localhost server (both) | node-layer | `node:child_process`, `node:http` (parked) | recorded |
| Updater (both) | build/config | Store/delivery owns updates | recorded |
| Crash reporting (crashReporter) | build/config | Native crash pipeline of the product | recorded |
| In-app purchase (Electron) | native-projection | StoreKit/Play Billing projections | recorded (see `sdk:store` note) |
| Content tracing, netLog, devtools plumbing | out-of-scope | Host internals | recorded |
| IPC/process model, webContents, asset protocol, command scopes | architecture | `runtime/chromium` + providers | recorded — informs providers, never public API |
| TouchBar, JumpList categories, recent documents | native-projection | macOS/Windows projections | recorded |

## Recommendation

Desktop needs are narrower than feared: draft 1 already covers most of
Tauri's plugin list because Tauri is mobile+desktop. The true desktop
additions are six: single-instance (`app`), reveal/trash (`shell`),
`displays`, `appearance`, `power`, `capture` — all small, none needing
Electron's process model. Adopt those in step 6; leave updater, crash,
billing, process and CLI to their recorded owners. Revisit
recent-documents/progress/taskbar niceties only with a real app asking.

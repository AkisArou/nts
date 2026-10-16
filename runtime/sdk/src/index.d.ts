/**
 * @nts/sdk — standards-first application SDK: Web globals for what the
 * Web covers, this package for the gaps. Interface only.
 * Prefer subpath imports (`@nts/sdk/camera`); this barrel is for
 * exploration. Fully-standard capabilities (clipboard, share) appear
 * as types only — use `navigator.clipboard` / `navigator.share`.
 */

export { app, platform } from "./shared/app.d.ts";
export type { App, AppInfo, AppState, DeviceInfo } from "./shared/app.d.ts";
export type {
  AppError, AppErrorCode, Availability, FormFactor, HostKind, Platform,
  PlatformOS, SignalOptions, Size, TypedEventTarget, Watch,
} from "./shared/core.d.ts";

export { permissions } from "./shared/permissions.d.ts";
export type { AppPermissionName, AppPermissions, AppPermissionStatus } from "./shared/permissions.d.ts";

export { camera, barcodeScanner } from "./shared/camera.d.ts";
export type { Camera, BarcodeScanner, CapturedPhoto } from "./shared/camera.d.ts";

export { photos } from "./shared/photos.d.ts";
export type { Photos, MediaAsset, Album } from "./shared/photos.d.ts";

export { documents, downloads } from "./shared/documents.d.ts";
export type { Documents, DocumentHandle, Downloads, DownloadTask } from "./shared/documents.d.ts";

export { storage } from "./shared/storage.d.ts";
export type { KeyValueStorage } from "./shared/storage.d.ts";

export { secureStorage, biometrics } from "./shared/security.d.ts";
export type { SecureStorage, Biometrics } from "./shared/security.d.ts";

export { backgroundLocation, geofencing, motion } from "./shared/location.d.ts";
export type { BackgroundLocation, Geofencing, LocationFix, Coordinates, Motion } from "./shared/location.d.ts";

export { tasks } from "./shared/tasks.d.ts";
export type { Tasks, TaskEvent, TaskHandler } from "./shared/tasks.d.ts";

export { notifications } from "./shared/notifications.d.ts";
export type { Notifications, PushToken, NotificationTrigger } from "./shared/notifications.d.ts";

export { contacts } from "./shared/contacts.d.ts";
export type { Contacts, Contact } from "./shared/contacts.d.ts";

export { calendar } from "./shared/calendar.d.ts";
export type { Calendar, CalendarEvent, Reminder } from "./shared/calendar.d.ts";

export { haptics, pedometer, barometer } from "./mobile/device.d.ts";
export type { Haptics, Pedometer, Barometer } from "./mobile/device.d.ts";

export { linking } from "./shared/linking.d.ts";
export type { Linking } from "./shared/linking.d.ts";

export { windows } from "./desktop/windows.d.ts";
export type { Windows, Window } from "./desktop/windows.d.ts";

export { menus, tray, shortcuts, autostart, dialogs, shell } from "./desktop/shell.d.ts";
export type { Menu, MenuItem, Tray } from "./desktop/shell.d.ts";


export { auth } from "./shared/auth.d.ts";
export type { Auth } from "./shared/auth.d.ts";

export { images } from "./shared/images.d.ts";
export type { Images, ImageOperation } from "./shared/images.d.ts";

export { media } from "./shared/media.d.ts";
export type { Media, AudioPlayer, VideoPlayer } from "./shared/media.d.ts";

export { compose } from "./shared/compose.d.ts";
export type { Compose, ComposeResult } from "./shared/compose.d.ts";

export { printing } from "./shared/printing.d.ts";
export type { Printing } from "./shared/printing.d.ts";

export { network } from "./shared/network.d.ts";
export type { Network, NetworkState } from "./shared/network.d.ts";

export { store } from "./shared/store.d.ts";
export type { Store } from "./shared/store.d.ts";

export { appearance } from "./shared/appearance.d.ts";
export type { Appearance, ColorScheme } from "./shared/appearance.d.ts";

export { displays } from "./desktop/displays.d.ts";
export type { Displays, Display } from "./desktop/displays.d.ts";

export { power } from "./shared/power.d.ts";
export type { Power } from "./shared/power.d.ts";

export { capture } from "./desktop/capture.d.ts";
export type { Capture, CaptureSource } from "./desktop/capture.d.ts";


export type { Clipboard, ClipboardItem } from "./shared/clipboard.d.ts";
export type { ShareData } from "./shared/share.d.ts";

export { clipboardExtras } from "./shared/clipboard.d.ts";
export type { ClipboardExtras } from "./shared/clipboard.d.ts";

export { locale } from "./shared/locale.d.ts";
export type { Locale, LocaleInfo } from "./shared/locale.d.ts";

export { browser } from "./shared/browser.d.ts";
export type { Browser } from "./shared/browser.d.ts";

export { brightness } from "./shared/brightness.d.ts";
export type { Brightness, BrightnessScope } from "./shared/brightness.d.ts";

export { screenProtection } from "./shared/screen-protection.d.ts";
export type { ScreenProtection } from "./shared/screen-protection.d.ts";

export * from "./shared/ui.d.ts";


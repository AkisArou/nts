/**
 * @nts/sdk/app — the application itself: identity, lifecycle, device.
 * Kind: native-only (the Web has fragments of this — `navigator`,
 * `document.visibilityState` — but no app concept).
 */
import type { Platform, TypedEventTarget } from "./core.d.ts";

export type { Platform, PlatformOS, HostKind, FormFactor } from "./core.d.ts";
export { platform } from "./core.d.ts";

export interface AppInfo {
  /** Bundle id / application id, e.g. `"dev.example.notes"`. */
  readonly id: string;
  readonly name: string;
  /** Marketing version from the product config, e.g. `"1.4.0"`. */
  readonly version: string;
  /** Build number, opaque and platform-shaped (`"204"`, `"1.4.0.1"`). */
  readonly build: string;
  readonly isDebug: boolean;
  /** When this installation was first installed / last updated, where the OS reports it. */
  readonly installedAt?: Date;
  readonly updatedAt?: Date;
}

export interface DeviceInfo {
  /** Human model name where the OS gives one, e.g. `"iPhone 16 Pro"`. */
  readonly model?: string;
  readonly manufacturer?: string;
  /** User-set device name ("Vivian's iPhone"), where exposed. */
  readonly name?: string;
  readonly osVersion: string;
  /** OS build identifier ("24A335", an Android build id), where exposed. */
  readonly osBuildId?: string;
  /** Installed RAM in bytes, if the OS reports it. */
  readonly totalMemory?: number;
}

/**
 * `active` ≈ visible and interactive; `background` ≈ not visible but running;
 * `inactive` is the transitional state some platforms have (iOS) — code must
 * not require it to occur. On the web these map onto page visibility.
 */
export type AppState = "active" | "inactive" | "background";

export interface AppStateChangeEvent extends Event {
  readonly state: AppState;
}

/** The URL the app was launched with, or that arrived while it ran. */
export interface LaunchURLEvent extends Event {
  readonly url: URL;
}

export interface SecondInstanceEvent extends Event {
  /** Command-line arguments of the would-be second instance (desktop). */
  readonly argv: readonly string[];
  /** The URL that instance was launched with, if any. */
  readonly url?: URL;
}

export interface AppEvents {
  statechange: AppStateChangeEvent;
  /** Another instance launched and was forwarded to us (desktop). */
  secondinstance: SecondInstanceEvent;
  /** Deep/universal/custom-scheme link. Also see `initialURL`. */
  url: LaunchURLEvent;
  /** The OS is asking us to shed memory. Desktop/browser may never fire it. */
  memorywarning: Event;
}

export interface App extends TypedEventTarget<AppEvents> {
  readonly info: AppInfo;
  readonly device: DeviceInfo;
  readonly platform: Platform;
  readonly state: AppState;
  /** The URL that launched the app, if any. Resolved once, stays stable. */
  readonly initialURL: URL | undefined;
  /**
   * Ask the OS to quit. Mobile platforms may refuse or ignore this
   * (iOS does); resolves false in that case rather than throwing.
   */
  exit(): Promise<boolean>;
  /** Seconds since device boot, where reported. */
  uptimeSeconds(): Promise<number | undefined>;
  /**
   * Ask to be the only running instance of this app. Returns true when
   * this process holds the lock; a second instance gets false and should
   * exit — the holder receives a `secondinstance` event with its argv/URL.
   * Mobile OSes are inherently single-instance and return true.
   */
  requestSingleInstanceLock(): Promise<boolean>;
}

export declare const app: App;

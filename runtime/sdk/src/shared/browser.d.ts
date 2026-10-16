/**
 * @nts/sdk/browser — a managed in-app browser session.
 * `linking.open(url, { inAppBrowser: true })` covers "show this page".
 * This module is the session form (expo-web-browser's real content):
 * warm up the browser engine before use, present with options, and
 * dismiss programmatically. Authentication sessions are `auth`.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

export interface BrowserOpenOptions extends SignalOptions {
  /** Toolbar/navigation bar tint as CSS hex, where themeable. */
  readonly toolbarColor?: string;
  /** iOS Safari reader mode where available. */
  readonly readerMode?: boolean;
  /** Dismiss button wording on iOS: "done" | "close" | "cancel". */
  readonly dismissButton?: "done" | "close" | "cancel";
}

export interface Browser {
  availability(): Promise<Availability>;
  /** Pre-warm the browser process for a faster open (Android Custom Tabs). */
  warmUp(url?: string): Promise<void>;
  coolDown(): Promise<void>;
  /** Resolves when the user dismisses the browser. */
  open(url: URL | string, options?: BrowserOpenOptions): Promise<void>;
  dismiss(): Promise<void>;
  /** Browsers able to serve as the in-app browser (Android), for diagnostics. */
  supportingBrowsers(): Promise<readonly string[]>;
}

export declare const browser: Browser;

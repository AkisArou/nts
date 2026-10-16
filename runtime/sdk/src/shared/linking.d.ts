/**
 * @nts/sdk/linking — URLs going out; URLs coming in are `app` events.
 * Kind: native-only. On the web `window.open` exists but has popup-blocker
 * semantics an app should not inherit by accident, so outbound opening is
 * explicit here; in a browser this delegates to it and reports refusal.
 */
import type { SignalOptions } from "./core.d.ts";

export interface OpenOptions extends SignalOptions {
  /**
   * Prefer an in-app browser surface (SFSafariViewController / Custom Tab /
   * a window in a desktop host) over handing off to the default browser.
   * Ignored where the concept does not exist; the URL still opens.
   */
  readonly inAppBrowser?: boolean;
}

export interface Linking {
  /**
   * Opens a URL with the OS handler for its scheme (`https:`, `mailto:`,
   * `tel:`, another app's scheme…). Resolves false when nothing can
   * handle it, instead of throwing — "no handler" is data, not failure.
   */
  open(url: URL | string, options?: OpenOptions): Promise<boolean>;
  canOpen(url: URL | string): Promise<boolean>;
}

export declare const linking: Linking;

/**
 * Incoming deep links: `app.initialURL` for launch, `app`'s `"url"` event
 * while running. They live on `app` because a launch URL is a fact about
 * the app's birth, not a linking operation — and because having two
 * event sources for the same thing (the React Native split) is how
 * handlers get registered twice.
 */

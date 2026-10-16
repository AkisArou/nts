/**
 * @nts/sdk/auth — signing a user in with an external provider.
 *
 * Standard part: passkeys are WebAuthn (`navigator.credentials`, see
 * @nts/sdk/security). There is no Web standard for "open the system
 * browser at an OAuth authorize URL and give me the redirect back" —
 * that one workflow is this module. Token exchange is ordinary `fetch`;
 * PKCE randomness/hashing is Web Crypto. We deliberately do not model
 * providers, tokens, or sessions: those are app/backend concerns and
 * every framework that models them gets outdated.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

/** Re-exported so `@nts/sdk/auth` is self-describing in the API reference. */
export type CredentialsContainer = globalThis.CredentialsContainer;
export type PublicKeyCredential = globalThis.PublicKeyCredential;

export interface AuthSessionOptions extends SignalOptions {
  /**
   * The redirect suffix/scheme that ends the session: a custom scheme
   * the app owns (`"myapp://"`) or an https universal-link prefix.
   * When the browser navigates there, the session resolves with that URL.
   */
  readonly redirect: string;
  /**
   * iOS: share cookies/session with Safari (single sign-on) at the cost
   * of a consent prompt. Default false (ephemeral). Ignored elsewhere.
   */
  readonly shareSession?: boolean;
}

export interface Auth {
  availability(): Promise<Availability>;
  /**
   * Opens `url` in the platform's auth browser surface
   * (ASWebAuthenticationSession / Custom Tab / a browser window) and
   * resolves with the redirect URL, or null when the user dismisses it.
   * Parse code/state/error from the URL with `URLSearchParams`, as usual.
   */
  openSession(url: URL | string, options: AuthSessionOptions): Promise<URL | null>;
}

export declare const auth: Auth;

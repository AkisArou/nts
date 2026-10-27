/**
 * @nts/sdk/core — the conventions every domain shares.
 *
 * Interface only. Nothing in this package has an implementation yet;
 * see ../DESIGN.md.
 */

// ---------------------------------------------------------------------------
// Platform identity
// ---------------------------------------------------------------------------

/** The operating system the app is running on. `"web"` means a browser. */
export type PlatformOS = "ios" | "android" | "macos" | "windows" | "linux" | "web";

/**
 * How the app is hosted. A Chromium-hosted app on macOS is
 * `os: "macos"`, `host: "chromium"` — OS and host are different axes,
 * the same split `docs/records/notebooks/nts-config.md` makes for target and backend.
 */
export type HostKind = "native" | "chromium" | "browser";

export type FormFactor = "phone" | "tablet" | "desktop" | "tv" | "watch" | "unknown";

export interface Platform {
  readonly os: PlatformOS;
  readonly host: HostKind;
  readonly formFactor: FormFactor;
  /** CPU architecture as reported by the OS, e.g. `"arm64"`, `"x64"`. */
  readonly arch: string;
  /** True when running in a simulator/emulator, when the OS can tell. */
  readonly isEmulator: boolean;
}

/** Synchronous, always available. Code may branch on this at module scope. */
export declare const platform: Platform;

// ---------------------------------------------------------------------------
// Availability — "can I use this here, at all?"
// ---------------------------------------------------------------------------

export type UnavailableReason =
  /** The platform/host has no such facility (e.g. tray in a browser). */
  | "unsupported"
  /** The facility exists in principle but the device lacks the hardware. */
  | "no-hardware"
  /** Blocked by OS policy: parental controls, MDM, kiosk, permissions hard-off. */
  | "restricted"
  /** Temporarily unusable (another app holds the camera, location services off). */
  | "busy"
  | "unknown";

export type Availability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: UnavailableReason };

/**
 * Every domain that can be absent exposes `availability()` returning this.
 * Availability never prompts for permission and never throws.
 * Permission is a separate question — see ./permissions.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable, machine-readable error codes. Every rejection from this SDK is an
 * `Error` carrying one of these in `code`, and — where the Web platform has
 * a name for the same failure — the matching `DOMException` name in `name`
 * (`NotAllowedError`, `NotFoundError`, `NotSupportedError`, `AbortError`, …).
 * Catch by `code`, display `message`, never parse either.
 *
 * Cancellation through an `AbortSignal` rejects with the signal's reason,
 * exactly like `fetch` — it does not use a code here.
 * A user dismissing a picker is NOT an error: single-item pickers
 * resolve `null`, multi-item pickers resolve `[]`.
 */
export type AppErrorCode =
  | "permission-denied"
  | "permission-restricted"
  | "unsupported"
  | "no-hardware"
  | "unavailable"
  | "not-found"
  | "already-exists"
  | "invalid-argument"
  | "quota-exceeded"
  | "busy"
  | "failed";

export interface AppError extends Error {
  readonly code: AppErrorCode;
  /** The SDK domain that failed, e.g. `"camera"`. */
  readonly domain: string;
}

// ---------------------------------------------------------------------------
// Common options, events, lifetime
// ---------------------------------------------------------------------------

/** Mixed into every async operation's options. Aborting rejects promptly. */
export interface SignalOptions {
  readonly signal?: AbortSignal;
}

/**
 * An event source with typed listeners. Objectively an `EventTarget`;
 * unsubscribe the Web way, with `{ signal }`, or `removeEventListener`.
 * There is deliberately no `addListener()`/`remove()` convention competing
 * with the platform one.
 */
export interface TypedEventTarget<Events extends Record<string, Event>> extends EventTarget {
  addEventListener<K extends keyof Events & string>(
    type: K,
    listener: (event: Events[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener<K extends keyof Events & string>(
    type: K,
    listener: (event: Events[K]) => void,
    options?: EventListenerOptions | boolean,
  ): void;
}

/**
 * A live stream of values (location fixes, sensor readings): consume it with
 * `for await`, stop it with `await using` or `close()`. Breaking out of the
 * loop closes it. `current` holds the most recent value, if any.
 */
export interface Watch<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly current: T | undefined;
  close(): Promise<void>;
}

/** A plain size in physical pixels unless a field says otherwise. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

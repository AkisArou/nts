/**
 * @nts/sdk/permissions — asking "may I?", once, for every domain.
 *
 * Standard part: the Web Permissions API. `navigator.permissions.query()`
 * answers for standard names. The SDK part exists because two mobile facts
 * have no Web expression — partial grants (`limited`: selected photos,
 * approximate location) and permanent denial (`canAskAgain: false`) — and
 * because several SDK capabilities (notifications on iOS, background
 * location) are requested, not triggered by use.
 *
 * Rules: `query()` never prompts and never throws. `request()` may prompt
 * and resolves with the answer (denial is data). Ordinary operations do
 * not prompt implicitly.
 */
import type { SignalOptions, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/permissions` is self-describing in the API reference. */
export type Permissions = globalThis.Permissions;
export type PermissionStatus = globalThis.PermissionStatus;
export type PermissionState = globalThis.PermissionState;
export type PermissionDescriptor = globalThis.PermissionDescriptor;

export type AppPermissionName =
  | "camera"
  | "microphone"
  | "photos"
  | "media-library"
  | "location"
  | "location-background"
  | "notifications"
  | "contacts"
  | "calendar"
  | "motion"
  | "bluetooth"
  | "local-network"
  | "screen-capture"
  | "background-execution";

export type AppPermissionState = PermissionState | "limited" | "restricted";

export interface AppPermissionStatus {
  readonly name: AppPermissionName;
  readonly state: AppPermissionState;
  /** False after a permanent denial: the only path left is system settings. */
  readonly canAskAgain: boolean;
  /** When a one-time/session grant ends, if the OS reports it. */
  readonly expiresAt?: Date;
}

export interface PermissionChangeEvent extends Event {
  readonly status: AppPermissionStatus;
}

export interface AppPermissions extends TypedEventTarget<{ change: PermissionChangeEvent }> {
  query(name: AppPermissionName): Promise<AppPermissionStatus>;
  request(name: AppPermissionName, options?: SignalOptions): Promise<AppPermissionStatus>;
  /** Opens this app's page in system settings, where the OS allows it. */
  openSettings(): Promise<boolean>;
}

export declare const permissions: AppPermissions;

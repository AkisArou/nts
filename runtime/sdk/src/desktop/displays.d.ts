/**
 * @nts/sdk/displays — physical displays (desktop). The shape follows
 * the Web Window Management API's ScreenDetails where it fits; a lone
 * phone screen also answers here (one display, no changes), which keeps
 * multi-window code from needing a mobile branch.
 */
import type { Availability, Size, TypedEventTarget } from "../shared/core.d.ts";

/** Re-exported so `@nts/sdk/displays` is self-describing in the API reference. */
export type ScreenOrientation = globalThis.ScreenOrientation;

export interface Display {
  readonly id: string;
  readonly label?: string;
  readonly isPrimary: boolean;
  /** Full bounds in desktop coordinates (logical pixels). */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Bounds minus taskbar/dock/menu areas. */
  readonly workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Physical/logical ratio (1, 1.5, 2, …). */
  readonly scaleFactor: number;
  /** Physical size where EDID reports it. */
  readonly physicalSize?: Size;
  readonly refreshRate?: number;
  /** Built-in laptop/phone panel vs external monitor. */
  readonly internal?: boolean;
}

export interface Displays extends TypedEventTarget<{ change: Event }> {
  availability(): Promise<Availability>;
  all(): Promise<readonly Display[]>;
  primary(): Promise<Display>;
  /** Display containing a desktop point (e.g. for placing a new window). */
  at(point: { readonly x: number; readonly y: number }): Promise<Display | undefined>;
}

export declare const displays: Displays;

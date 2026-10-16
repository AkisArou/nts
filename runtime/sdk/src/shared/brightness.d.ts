/**
 * @nts/sdk/brightness — screen brightness.
 * App-scope brightness (this window, for readers/media viewers) works
 * everywhere a window exists. System-scope writes the OS setting and
 * is restricted accordingly (permission on Android, unavailable on
 * iOS, portal-mediated on Linux). No Web standard covers either.
 */
import type { Availability } from "./core.d.ts";

export type BrightnessScope =
  /** This app's window only. */
  | "app"
  /** The system setting. */
  | "system";

export interface Brightness {
  availability(scope?: BrightnessScope): Promise<Availability>;
  /** 0..1 */
  get(scope?: BrightnessScope): Promise<number>;
  set(level: number, scope?: BrightnessScope): Promise<void>;
}

export declare const brightness: Brightness;

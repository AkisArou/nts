/**
 * @nts/sdk/appearance — how the user has told the OS to look.
 * On the Web this is CSS media queries (`prefers-color-scheme`) with no
 * JS-readable object outside Blink/DOM hosts. Native apps need the
 * values in code (theming logic, native controls, canvas). Shared, not
 * desktop: phones have the same settings.
 */
import type { TypedEventTarget } from "./core.d.ts";

export type ColorScheme = "light" | "dark" | "unspecified";

export interface AppearanceState {
  readonly colorScheme: ColorScheme;
  /** OS accent color as CSS hex, where the OS exposes one (Windows/macOS). */
  readonly accentColor?: string;
  /** User prefers reduced motion/animations. */
  readonly reducedMotion?: boolean;
  /** User prefers higher contrast. */
  readonly increasedContrast?: boolean;
}

export interface AppearanceChangeEvent extends Event {
  readonly state: AppearanceState;
}

export interface Appearance extends TypedEventTarget<{ change: AppearanceChangeEvent }> {
  /** Synchronous current state (known at startup). */
  readonly state: AppearanceState;
  /**
   * Override the scheme for this app ("system" clears the override).
   * Native controls and the DOM host follow; app-drawn UI still has to.
   */
  setColorScheme(scheme: ColorScheme | "system"): Promise<void>;
}

export declare const appearance: Appearance;

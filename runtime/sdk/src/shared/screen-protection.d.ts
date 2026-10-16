/**
 * @nts/sdk/screen-protection — keeping this app's content out of other
 * people's captures. The inverse of screen capture, and a phone-born
 * concept (Android FLAG_SECURE, iOS screenshot detection) that applies
 * on every target with a screen. No Web equivalent exists.
 * Enforcement is OS-shaped and never total — `isCaptured` reports what
 * the OS knows, nothing more.
 */
import type { Availability, TypedEventTarget } from "./core.d.ts";

export interface ScreenProtectionEvents {
  /** The user took a screenshot (platforms that report it; mostly iOS). */
  screenshot: Event;
  /** Screen recording of this app started/stopped (where reported). */
  recordingchange: Event;
}

export interface ScreenProtection extends TypedEventTarget<ScreenProtectionEvents> {
  availability(): Promise<Availability>;
  prevent(): Promise<void>;
  allow(): Promise<void>;
  readonly prevented: boolean;
  /** Currently being recorded/mirrored, where the OS reports it. */
  readonly isCaptured: boolean;
}

export declare const screenProtection: ScreenProtection;

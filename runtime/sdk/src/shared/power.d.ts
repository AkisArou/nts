/**
 * @nts/sdk/power — power, idleness, and battery-saver state.
 * Keeping the *display* awake is the standard `navigator.wakeLock`.
 * What no standard covers: system sleep/resume/lock events, user idle
 * time, and blocking *system* sleep (downloads, presentations, calls).
 * Sleep blocking is a desktop concept; battery-saver state is a
 * mobile one. Both live here because laptops have both, and each
 * operation reports availability honestly instead of splitting hairs.
 */
import type { Availability, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/power` is self-describing in the API reference. */
export type WakeLock = globalThis.WakeLock;
export type BatteryManager = globalThis.BatteryManager;

export type PowerStateName = "active" | "idle" | "locked" | "suspended" | "unknown";

export interface PowerEvents {
  /** Suspend/resume/lock/unlock/battery transitions — read `power.state`. */
  change: Event;
}

export interface SleepBlocker extends Disposable {
  readonly reason: string;
  release(): void;
  [Symbol.dispose](): void;
}

export interface Power extends TypedEventTarget<PowerEvents> {
  availability(): Promise<Availability>;
  readonly state: PowerStateName;
  /** True on external power; undefined when unknown (desktops without battery telemetry). */
  readonly onExternalPower?: boolean;
  /** Seconds since last user input system-wide, where the OS reports it. */
  idleSeconds(): Promise<number | undefined>;
  /**
   * Asks the OS not to sleep the system (display may still sleep unless
   * a WakeLock is also held). Always pair with a reason the user could
   * see in OS power diagnostics; release promptly.
   */
  preventSleep(reason: string): Promise<SleepBlocker>;
}

export declare const power: Power;

export interface PowerMode extends TypedEventTarget<{ change: Event }> {
  /** Battery-saver / low-power mode currently on. Pairs with navigator.getBattery(). */
  readonly lowPower: boolean;
}

export declare const powerMode: PowerMode;

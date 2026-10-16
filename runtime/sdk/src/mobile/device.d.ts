/**
 * @nts/sdk/device — hardware odds and ends.
 *
 * Standard parts (use directly, in lib.native-dom):
 * - Motion/orientation/light: Generic Sensors — `new Accelerometer({frequency: 60})`
 * - Battery: `await navigator.getBattery()`
 * - Keep-awake: `await navigator.wakeLock.request("screen")`
 * - Coarse vibration: `navigator.vibrate(pattern)`
 *
 * SDK parts: semantic haptics (the Web has patterns, not meanings; a Web
 * Haptics draft exists — watch it before locking this in) and pedometer.
 */
import type { Availability, SignalOptions, Watch } from "../shared/core.d.ts";

/** Re-exported so `@nts/sdk/device` is self-describing in the API reference. */
export type Sensor = globalThis.Sensor;
export type Accelerometer = globalThis.Accelerometer;
export type LinearAccelerationSensor = globalThis.LinearAccelerationSensor;
export type GravitySensor = globalThis.GravitySensor;
export type Gyroscope = globalThis.Gyroscope;
export type Magnetometer = globalThis.Magnetometer;
export type AbsoluteOrientationSensor = globalThis.AbsoluteOrientationSensor;
export type AmbientLightSensor = globalThis.AmbientLightSensor;
export type BatteryManager = globalThis.BatteryManager;
export type WakeLock = globalThis.WakeLock;
export type WakeLockSentinel = globalThis.WakeLockSentinel;

export type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
export type HapticNotificationKind = "success" | "warning" | "error";

export interface Haptics {
  availability(): Promise<Availability>;
  impact(style?: HapticImpactStyle): Promise<void>;
  notification(kind: HapticNotificationKind): Promise<void>;
  /** The subtle tick for selection changes (pickers, sliders). */
  selection(): Promise<void>;
}

export declare const haptics: Haptics;

export interface PedometerReading {
  /** Steps since the watch/query start. */
  readonly steps: number;
  /** Metres, where the platform estimates it. */
  readonly distance?: number;
  readonly at: Date;
}

export interface Pedometer {
  availability(): Promise<Availability>;
  /** Historical total between two instants, where the OS keeps history (needs `"motion"`). */
  stepsBetween(from: Date, to: Date, options?: SignalOptions): Promise<number>;
  watch(options?: SignalOptions): Promise<Watch<PedometerReading>>;
}

export declare const pedometer: Pedometer;

// ---- Step-4 additions from the coverage ledger ---------------------------

/** Atmospheric pressure. There is no Generic Sensor for this. */
export interface Barometer {
  availability(): Promise<Availability>;
  /** Current pressure in hectopascals. */
  pressure(options?: SignalOptions): Promise<{ readonly hPa: number; readonly at: Date }>;
  watch(options?: SignalOptions): Promise<Watch<{ readonly hPa: number; readonly at: Date }>>;
}

export declare const barometer: Barometer;

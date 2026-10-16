/**
 * @nts/sdk/location — where the device is.
 *
 * Standard part (use directly): Geolocation.
 *   navigator.geolocation.getCurrentPosition(...)
 *   const id = navigator.geolocation.watchPosition(...)
 * That covers every foreground need. SDK parts exist where the Web has
 * nothing: an OS-managed background tracking service and geofencing,
 * both delivered through background task handlers (@nts/sdk/tasks)
 * because the OS may wake a headless app to deliver them.
 */
import type { Availability, SignalOptions, Watch } from "./core.d.ts";

/** Re-exported so `@nts/sdk/location` is self-describing in the API reference. */
export type Geolocation = globalThis.Geolocation;
export type GeolocationPosition = globalThis.GeolocationPosition;
export type GeolocationCoordinates = globalThis.GeolocationCoordinates;
export type GeolocationPositionError = globalThis.GeolocationPositionError;
export type PositionOptions = globalThis.PositionOptions;

/** A position as plain data (GeolocationCoordinates, minus host object). */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude?: number;
  readonly altitudeAccuracy?: number;
  readonly heading?: number;
  readonly speed?: number;
}

export interface LocationFix {
  readonly coords: Coordinates;
  readonly timestamp: Date;
  /** True when the OS only grants approximate location. */
  readonly approximate: boolean;
  readonly mocked?: boolean;
}

export type BackgroundAccuracy = "best" | "high" | "balanced" | "low";

export interface BackgroundLocationOptions extends SignalOptions {
  /** Task name (tasks.define) that receives fixes while backgrounded. */
  readonly task: string;
  readonly accuracy?: BackgroundAccuracy;
  /** Min metres moved between deliveries, where the OS supports it. */
  readonly distanceFilter?: number;
  /** Min ms between deliveries, where the OS supports it. */
  readonly timeInterval?: number;
  /**
   * Android foreground-service notification text — the OS requires a
   * visible notification for background location; surfaced, not hidden.
   * Ignored elsewhere (iOS shows its own indicator).
   */
  readonly notification?: { readonly title: string; readonly body: string };
}

export interface BackgroundLocation {
  availability(): Promise<Availability>;
  /** Needs `"location-background"`. Unsupported in browsers. */
  start(options: BackgroundLocationOptions): Promise<void>;
  stop(task: string): Promise<void>;
  /** Names of currently running background-tracking tasks. */
  running(): Promise<readonly string[]>;
  /** Newest fix the OS already has, without powering the radio. */
  lastKnown(): Promise<LocationFix | undefined>;
}

export declare const backgroundLocation: BackgroundLocation;

/** Event delivered to the task named when the fix was produced. */
export interface BackgroundLocationEvent {
  readonly type: "location";
  readonly fixes: readonly LocationFix[];
}

export interface GeofenceRegion {
  readonly id: string;
  readonly center: { readonly latitude: number; readonly longitude: number };
  /** Metres. Platforms enforce minimums (~100m) and maximum counts (~20). */
  readonly radius: number;
  /** Task name (tasks.define) receiving enter/exit events. */
  readonly task: string;
}

export interface GeofenceEvent {
  readonly type: "geofence";
  readonly regionId: string;
  readonly transition: "enter" | "exit";
  readonly at: Date;
}

export interface Geofencing {
  availability(): Promise<Availability>;
  add(region: GeofenceRegion): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<readonly GeofenceRegion[]>;
}

export declare const geofencing: Geofencing;

export interface Heading {
  /** Degrees clockwise from true north; -1 when unavailable (Web convention). */
  readonly degrees: number;
  /** Heading accuracy in degrees, where reported. */
  readonly accuracy?: number;
  readonly at: Date;
}

export type MotionActivityKind = "stationary" | "walking" | "running" | "cycling" | "automotive" | "unknown";

export interface MotionActivity {
  readonly kind: MotionActivityKind;
  readonly confidence: "low" | "medium" | "high";
  readonly at: Date;
}

export interface Motion {
  /** Compass heading stream, foreground. DeviceOrientation covers browsers. */
  watchHeading(options?: SignalOptions): Promise<Watch<Heading>>;
  /** Needs `"motion"` where the OS gates activity classification. */
  activity(options?: SignalOptions): Promise<MotionActivity>;
  watchActivity(options?: SignalOptions): Promise<Watch<MotionActivity>>;
}

export declare const motion: Motion;

/**
 * Geocoding/reverse-geocoding was in the parked maps module and is out
 * of scope for now (docs/deferred/maps.d.ts) — deliberately not
 * re-homed here, so the location module stays "position, not places".
 */

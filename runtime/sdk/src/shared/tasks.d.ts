/**
 * @nts/sdk/tasks — OS-managed background work.
 * No Web standard describes this for native apps (Background Sync/Fetch
 * assume a service worker and a browser's lifecycle). The honest common
 * model across iOS BGTaskScheduler, Android WorkManager, and desktop
 * schedulers:
 *
 * - Work is a *named handler*, registered at module scope with
 *   `tasks.define(name, handler)`, because the OS can cold-launch the
 *   app headless: the handler must exist before any UI code runs.
 * - The OS decides when (and whether promptly) work runs. Schedules are
 *   requests with constraints, never timers. Anything else is a lie on
 *   mobile.
 * - Handlers receive an event; returning resolves the task, an `error`
 *   answer asks the OS to retry within its own backoff policy.
 *
 * Location/geofence delivery rides on this (see @nts/sdk/location).
 */
import type { Availability, SignalOptions } from "./core.d.ts";
import type { BackgroundLocationEvent, GeofenceEvent } from "./location.d.ts";

export type TaskEvent =
  | { readonly type: "periodic"; readonly scheduledAt: Date }
  | { readonly type: "expiration"; readonly task: string }
  | { readonly type: "fetch" }
  | BackgroundLocationEvent
  | GeofenceEvent;

export type TaskHandlerResult = "success" | "retry" | "failure";

export type TaskHandler = (event: TaskEvent) => Promise<TaskHandlerResult | void> | TaskHandlerResult | void;

export interface PeriodicSchedule {
  /** Minimum interval in seconds. OS minimums (e.g. 15 min) clamp, not error. */
  readonly everySeconds: number;
}

export interface TaskConstraints {
  readonly requiresNetwork?: boolean;
  readonly requiresCharging?: boolean;
  readonly requiresIdle?: boolean;
}

export interface Tasks {
  availability(): Promise<Availability>;
  /**
   * Registers a handler. Call at module scope of the app entry — a
   * handler registered after launch misses cold-launch deliveries.
   * Redefining a name replaces the handler.
   */
  define(name: string, handler: TaskHandler): void;
  /** Requests periodic execution of a defined task. Idempotent per name. */
  schedulePeriodic(name: string, schedule: PeriodicSchedule, constraints?: TaskConstraints): Promise<void>;
  /** Requests one execution as soon as constraints allow. */
  scheduleOnce(name: string, constraints?: TaskConstraints & { readonly delaySeconds?: number }): Promise<void>;
  cancel(name: string): Promise<void>;
  cancelAll(): Promise<void>;
  scheduled(): Promise<readonly string[]>;
  /** Handler names defined in this process (define() calls). */
  defined(): readonly string[];
  /** True when this process was cold-launched to run a task (headless). */
  readonly isBackgroundLaunch: boolean;
}

export declare const tasks: Tasks;

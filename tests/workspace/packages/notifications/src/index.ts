// The generic surface. No platform appears in this file, and that is the point:
// a consumer writes against this and never names a target.
//
// The per-platform modules below it are selected by the build, not by an
// `if (platform === ...)` at run time -- the wrong platform's module must not
// be *emitted*, because it names bindings that do not exist there.

export interface Notification {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Milliseconds from now. Zero delivers immediately. */
  readonly delay: number;
}

export type TapHandler = (id: string) => void;

export interface Scheduler {
  schedule(notification: Notification): void;
  cancel(id: string): void;
  onTap(handler: TapHandler): void;
}

/**
 * The platform's scheduler.
 *
 * Resolved at build time to exactly one of the siblings in this directory. How
 * that resolution is spelled is an open question in `docs/nts-config.md` -- a
 * conditional export, a target-keyed import, or something the compiler does --
 * and this fixture deliberately does not pick one.
 */
export declare function scheduler(): Scheduler;

import { DOMException } from "./errors.ts";

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export class Event {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly isTrusted = false;
  defaultPrevented = false;
  target: EventTarget | null = null;
  currentTarget: EventTarget | null = null;
  eventPhase = 0;
  private dispatching = false;
  private immediateStopped = false;

  constructor(type: string, init: EventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
    this.composed = init.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {}

  stopImmediatePropagation(): void {
    this.immediateStopped = true;
  }

  /** @internal */ begin(target: EventTarget): void {
    if (this.dispatching) {
      throw new DOMException("Event is already dispatching or uninitialized", "InvalidStateError");
    }
    this.dispatching = true;
    this.immediateStopped = false;
    this.target = target;
    this.currentTarget = target;
    this.eventPhase = 2;
  }

  /** @internal */ end(): void {
    this.dispatching = false;
    this.currentTarget = null;
    this.eventPhase = 0;
  }

  /** @internal */ get stopped(): boolean {
    return this.immediateStopped;
  }
}

export type EventListener = (this: EventTarget, event: Event) => void;

export interface EventHandlerSlot<Target extends EventTarget, E extends Event> {
  callback: ((this: Target, event: E) => void) | null;
  listener: EventListener | null;
}

export interface ListenerOptions {
  once?: boolean;
  capture?: boolean;
}

interface ListenerRecord {
  type: string;
  callback: EventListener;
  capture: boolean;
  once: boolean;
  removed: boolean;
}

/** Non-tree EventTarget; deliberately not a DOM propagation implementation. */
export class EventTarget {
  private readonly listeners: ListenerRecord[] = [];
  protected readonly report: (error: unknown) => void;

  constructor(report: (error: unknown) => void = () => {}) {
    this.report = report;
  }

  addEventListener(
    type: string,
    callback: EventListener | null,
    options: ListenerOptions | boolean = {},
  ): void {
    if (callback === null) return;
    const capture = typeof options === "boolean" ? options : (options.capture ?? false);
    const once = typeof options === "boolean" ? false : (options.once ?? false);
    if (
      this.listeners.some(
        (item) =>
          !item.removed &&
          item.type === type &&
          item.callback === callback &&
          item.capture === capture,
      )
    )
      return;
    this.listeners.push({ type, callback, capture, once, removed: false });
  }

  removeEventListener(
    type: string,
    callback: EventListener | null,
    options: ListenerOptions | boolean = {},
  ): void {
    const capture = typeof options === "boolean" ? options : (options.capture ?? false);
    for (const item of this.listeners) {
      if (item.type === type && item.callback === callback && item.capture === capture)
        item.removed = true;
    }
  }

  dispatchEvent(event: Event): boolean {
    event.begin(this);
    try {
      const snapshot = this.listeners.slice();
      for (const item of snapshot) {
        if (item.removed || item.type !== event.type) continue;
        if (item.once) item.removed = true;
        try {
          item.callback.call(this, event);
        } catch (error) {
          this.report(error);
        }
        if (event.stopped) break;
      }
    } finally {
      event.end();
      for (let i = this.listeners.length - 1; i >= 0; --i) {
        if (this.listeners[i]?.removed) this.listeners.splice(i, 1);
      }
    }
    return !event.defaultPrevented;
  }

  /** Property handlers occupy their registration position, just like ordinary listeners. */
  protected setHandler<Target extends EventTarget, E extends Event>(
    target: Target,
    slot: EventHandlerSlot<Target, E>,
    type: string,
    callback: ((this: Target, event: E) => void) | null,
    accepts: (event: Event) => event is E,
  ): void {
    slot.callback = callback;
    if (callback === null) {
      if (slot.listener !== null) target.removeEventListener(type, slot.listener);
      slot.listener = null;
    } else if (slot.listener === null) {
      slot.listener = (event) => {
        if (slot.callback !== null && accepts(event)) slot.callback.call(target, event);
      };
      target.addEventListener(type, slot.listener);
    }
  }
}

export interface MessageEventInit<T> extends EventInit {
  data?: T | null;
  lastEventId?: string;
  origin?: string;
  ports?: readonly EventTarget[];
  source?: EventTarget | null;
}

export class MessageEvent<T = unknown> extends Event {
  readonly data: T | null;
  readonly lastEventId: string;
  readonly origin: string;
  readonly ports: readonly EventTarget[];
  readonly source: EventTarget | null;

  constructor(type: string, init: MessageEventInit<T> = {}) {
    super(type, init);
    this.data = init.data === undefined ? null : init.data;
    this.lastEventId = init.lastEventId ?? "";
    this.origin = init.origin ?? "";
    this.ports = init.ports?.slice() ?? [];
    this.source = init.source ?? null;
  }
}

export interface CloseEventInit extends EventInit {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export class CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, init: CloseEventInit = {}) {
    super(type, init);
    this.code = init.code ?? 0;
    this.reason = init.reason ?? "";
    this.wasClean = init.wasClean ?? false;
  }
}

export interface ErrorEventInit extends EventInit {
  colno?: number;
  error?: unknown;
  filename?: string;
  lineno?: number;
  message?: string;
}

export class ErrorEvent extends Event {
  readonly colno: number;
  readonly error: unknown;
  readonly filename: string;
  readonly lineno: number;
  readonly message: string;

  constructor(type: string, init: ErrorEventInit = {}) {
    super(type, init);
    this.colno = init.colno ?? 0;
    this.error = init.error ?? null;
    this.filename = init.filename ?? "";
    this.lineno = init.lineno ?? 0;
    this.message = init.message ?? "";
  }
}

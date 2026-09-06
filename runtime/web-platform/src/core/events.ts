import { DOMException } from "./errors.ts";

export interface EventInit {
  cancelable?: boolean;
}
export class Event {
  readonly type: string;
  readonly cancelable: boolean;
  readonly bubbles = false;
  readonly composed = false;
  readonly isTrusted = false;
  defaultPrevented = false;
  target: EventTarget | null = null;
  currentTarget: EventTarget | null = null;
  eventPhase = 0;
  private dispatching = false;
  private immediateStopped = false;
  constructor(type: string, init: EventInit = {}) {
    this.type = type;
    this.cancelable = init.cancelable ?? false;
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
export class MessageEvent<T> extends Event {
  readonly data: T;
  readonly origin: string;
  constructor(type: string, data: T, origin = "") {
    super(type);
    this.data = data;
    this.origin = origin;
  }
}
export class CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  constructor(type: string, code = 0, reason = "", wasClean = false) {
    super(type);
    this.code = code;
    this.reason = reason;
    this.wasClean = wasClean;
  }
}

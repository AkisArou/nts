import { DOMException } from "./errors.ts";
import { toUnsignedLong, toUnsignedShort, toUSVString } from "./webidl.ts";

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export class Event {
  static readonly NONE = 0;
  static readonly CAPTURING_PHASE = 1;
  static readonly AT_TARGET = 2;
  static readonly BUBBLING_PHASE = 3;

  private eventType: string;
  private eventBubbles: boolean;
  private eventCancelable: boolean;
  private readonly eventComposed: boolean;
  private eventTarget: EventTarget | null = null;
  private eventCurrentTarget: EventTarget | null = null;
  private phase = Event.NONE;
  private canceled = false;
  private propagationStopped = false;
  private dispatching = false;
  private immediateStopped = false;
  private passiveListener = false;

  constructor(type: string, init: EventInit = {}) {
    this.eventType = type;
    this.eventBubbles = init.bubbles ? true : false;
    this.eventCancelable = init.cancelable ? true : false;
    this.eventComposed = init.composed ? true : false;
  }

  get type(): string {
    return this.eventType;
  }

  get target(): EventTarget | null {
    return this.eventTarget;
  }

  get srcElement(): EventTarget | null {
    return this.eventTarget;
  }

  get currentTarget(): EventTarget | null {
    return this.eventCurrentTarget;
  }

  composedPath(): EventTarget[] {
    if (!this.dispatching || this.eventCurrentTarget === null) return [];
    return [this.eventCurrentTarget];
  }

  get eventPhase(): number {
    return this.phase;
  }

  get NONE(): number {
    return Event.NONE;
  }

  get CAPTURING_PHASE(): number {
    return Event.CAPTURING_PHASE;
  }

  get AT_TARGET(): number {
    return Event.AT_TARGET;
  }

  get BUBBLING_PHASE(): number {
    return Event.BUBBLING_PHASE;
  }

  get bubbles(): boolean {
    return this.eventBubbles;
  }

  get cancelable(): boolean {
    return this.eventCancelable;
  }

  get returnValue(): boolean {
    return !this.canceled;
  }

  set returnValue(value: boolean) {
    if (!value) this.preventDefault();
  }

  get defaultPrevented(): boolean {
    return this.canceled;
  }

  get composed(): boolean {
    return this.eventComposed;
  }

  get isTrusted(): boolean {
    return false;
  }

  preventDefault(): void {
    if (this.eventCancelable && !this.passiveListener) this.canceled = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }

  get cancelBubble(): boolean {
    return this.propagationStopped;
  }

  set cancelBubble(value: boolean) {
    if (value) this.propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this.propagationStopped = true;
    this.immediateStopped = true;
  }

  initEvent(type: string, bubbles = false, cancelable = false): void {
    this.initialize(type, bubbles, cancelable);
  }

  protected initialize(type: string, bubbles: boolean, cancelable: boolean): boolean {
    if (this.dispatching) return false;
    this.propagationStopped = false;
    this.immediateStopped = false;
    this.canceled = false;
    this.eventTarget = null;
    this.eventType = type;
    this.eventBubbles = bubbles ? true : false;
    this.eventCancelable = cancelable ? true : false;
    return true;
  }

  /** @internal */ begin(target: EventTarget): void {
    if (this.dispatching) {
      throw new DOMException("Event is already dispatching or uninitialized", "InvalidStateError");
    }
    this.dispatching = true;
    this.eventTarget = target;
    this.eventCurrentTarget = target;
    this.phase = Event.AT_TARGET;
  }

  /** @internal */ end(): void {
    this.dispatching = false;
    this.passiveListener = false;
    this.eventCurrentTarget = null;
    this.phase = Event.NONE;
    this.propagationStopped = false;
    this.immediateStopped = false;
  }

  /** @internal */ setPassiveListener(passive: boolean): void {
    this.passiveListener = passive;
  }

  /** @internal */ get stopped(): boolean {
    return this.immediateStopped;
  }

  /** @internal */ get stoppedBeforeTarget(): boolean {
    return this.propagationStopped;
  }
}

export interface CustomEventInit<T> extends EventInit {
  detail?: T | null;
}

export class CustomEvent<T = unknown> extends Event {
  private customDetail: T | null;

  constructor(type: string, init: CustomEventInit<T> = {}) {
    super(type, init);
    this.customDetail = init.detail === undefined ? null : init.detail;
  }

  get detail(): T | null {
    return this.customDetail;
  }

  initCustomEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    detail: T | null = null,
  ): void {
    if (this.initialize(type, bubbles, cancelable)) this.customDetail = detail;
  }
}

export type EventListener = (this: EventTarget, event: Event) => void;

export interface EventListenerObject {
  handleEvent(event: Event): void;
}

export type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

export interface EventHandlerSlot<Target extends EventTarget, E extends Event> {
  callback: ((this: Target, event: E) => void) | null;
  listener: EventListener | null;
}

export interface ListenerOptions {
  once?: boolean;
  capture?: boolean;
  passive?: boolean;
  signal?: EventListenerSignal;
}

/** The AbortSignal operations EventTarget needs, without a runtime import cycle. */
export interface EventListenerSignal {
  readonly aborted: boolean;
  subscribe(callback: () => void): () => void;
}

interface ListenerRecord {
  type: string;
  callback: EventListenerOrEventListenerObject;
  capture: boolean;
  once: boolean;
  passive: boolean;
  removed: boolean;
  unsubscribeAbort: (() => void) | null;
}

function listenerOption(value: boolean | undefined): boolean {
  return value ? true : false;
}

function validateListenerSignal(signal: EventListenerSignal | undefined): void {
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== "object" || typeof signal.subscribe !== "function")
  ) {
    throw new TypeError("signal must be an AbortSignal");
  }
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
    callback: EventListenerOrEventListenerObject | null,
    options: ListenerOptions | boolean = {},
  ): void {
    const once = typeof options === "boolean" ? false : listenerOption(options.once);
    const capture = typeof options === "boolean" ? options : listenerOption(options.capture);
    const passive = typeof options === "boolean" ? false : listenerOption(options.passive);
    const signal = typeof options === "boolean" ? undefined : options.signal;
    validateListenerSignal(signal);
    if (callback === null) return;
    if (signal?.aborted) return;
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
    const listener: ListenerRecord = {
      type,
      callback,
      capture,
      once,
      passive,
      removed: false,
      unsubscribeAbort: null,
    };
    this.listeners.push(listener);
    if (signal !== undefined) {
      listener.unsubscribeAbort = signal.subscribe(() => this.removeRecord(listener));
    }
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options: ListenerOptions | boolean = {},
  ): void {
    if (callback === null) return;
    const capture = typeof options === "boolean" ? options : listenerOption(options.capture);
    for (const item of this.listeners) {
      if (item.type === type && item.callback === callback && item.capture === capture) {
        this.removeRecord(item);
        return;
      }
    }
  }

  dispatchEvent(event: Event): boolean {
    event.begin(this);
    try {
      if (!event.stoppedBeforeTarget) {
        const snapshot = this.listeners.slice();
        for (const item of snapshot) {
          if (event.stopped) break;
          if (item.removed || item.type !== event.type) continue;
          if (item.once) this.removeRecord(item);
          event.setPassiveListener(item.passive);
          try {
            if (typeof item.callback === "function") {
              item.callback.call(this, event);
            } else {
              item.callback.handleEvent(event);
            }
          } catch (error) {
            this.report(error);
          } finally {
            event.setPassiveListener(false);
          }
        }
      }
    } finally {
      event.end();
      let write = 0;
      for (let read = 0; read < this.listeners.length; read++) {
        const listener = this.listeners[read];
        if (listener !== undefined && !listener.removed) {
          this.listeners[write++] = listener;
        }
      }
      this.listeners.length = write;
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

  private removeRecord(listener: ListenerRecord): void {
    if (listener.removed) return;
    listener.removed = true;
    const unsubscribe = listener.unsubscribeAbort;
    listener.unsubscribeAbort = null;
    unsubscribe?.();
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
  private messageData: T | null;
  private messageLastEventId: string;
  private messageOrigin: string;
  private messagePorts: readonly EventTarget[];
  private messageSource: EventTarget | null;

  constructor(type: string, init: MessageEventInit<T> = {}) {
    super(type, init);
    this.messageData = init.data === undefined ? null : init.data;
    this.messageLastEventId = init.lastEventId ?? "";
    this.messageOrigin = toUSVString(init.origin ?? "");
    this.messagePorts = init.ports?.slice() ?? [];
    this.messageSource = init.source ?? null;
  }

  get data(): T | null {
    return this.messageData;
  }

  get lastEventId(): string {
    return this.messageLastEventId;
  }

  get origin(): string {
    return this.messageOrigin;
  }

  get ports(): readonly EventTarget[] {
    return this.messagePorts;
  }

  get source(): EventTarget | null {
    return this.messageSource;
  }

  initMessageEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    data: T | null = null,
    origin = "",
    lastEventId = "",
    source: EventTarget | null = null,
    ports: readonly EventTarget[] = [],
  ): void {
    if (!this.initialize(type, bubbles, cancelable)) return;
    this.messageData = data;
    this.messageOrigin = toUSVString(origin);
    this.messageLastEventId = lastEventId;
    this.messageSource = source;
    this.messagePorts = ports.slice();
  }
}

export interface CloseEventInit extends EventInit {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export class CloseEvent extends Event {
  private readonly closeCode: number;
  private readonly closeReason: string;
  private readonly clean: boolean;

  constructor(type: string, init: CloseEventInit = {}) {
    super(type, init);
    this.closeCode = toUnsignedShort(init.code ?? 0);
    this.closeReason = toUSVString(init.reason ?? "");
    this.clean = init.wasClean ? true : false;
  }

  get code(): number {
    return this.closeCode;
  }

  get reason(): string {
    return this.closeReason;
  }

  get wasClean(): boolean {
    return this.clean;
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
  private readonly errorColumn: number;
  private readonly errorValue: unknown;
  private readonly errorFilename: string;
  private readonly errorLine: number;
  private readonly errorMessage: string;

  constructor(type: string, init: ErrorEventInit = {}) {
    super(type, init);
    this.errorColumn = toUnsignedLong(init.colno ?? 0);
    this.errorValue = init.error ?? null;
    this.errorFilename = toUSVString(init.filename ?? "");
    this.errorLine = toUnsignedLong(init.lineno ?? 0);
    this.errorMessage = init.message ?? "";
  }

  get colno(): number {
    return this.errorColumn;
  }

  get error(): unknown {
    return this.errorValue;
  }

  get filename(): string {
    return this.errorFilename;
  }

  get lineno(): number {
    return this.errorLine;
  }

  get message(): string {
    return this.errorMessage;
  }
}

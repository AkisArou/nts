import type { AbortSignal } from "./abort.ts";
import {
  currentWebPlatformRuntime,
  hasWebPlatformRuntime,
} from "../provider/environment.ts";
import { abortSignalBrand } from "./abort-brand.ts";
import type { AbortSignalOperations } from "./abort-brand.ts";
import { DOMException } from "./errors.ts";
import {
  coerceToDOMString,
  coerceToUSVString,
  requireArguments,
  requireDictionary,
  toUnsignedLong,
  toUnsignedShort,
} from "./webidl.ts";
import { abortSignalSubscribe } from "./abort-brand.ts";

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

/**
 * Keys for the members `EventTarget` and the event subclasses need, which Web IDL does not
 * define on `Event`.
 *
 * `begin`, `end`, `stopped`, `stoppedBeforeTarget` and `setPassiveListener` are the dispatch
 * algorithm's grip on an event and are used only by `EventTarget` in this file; `initialize`
 * and `applyConvertedEventInit` are the constructor helpers every event subclass shares.
 * Symbols so none of them sit on `Event.prototype`. Never re-exported from the public barrel.
 */
export const eventBegin: unique symbol = Symbol("Event begin dispatch");
export const eventEnd: unique symbol = Symbol("Event end dispatch");
export const eventStopped: unique symbol = Symbol("Event propagation stopped");
export const eventStoppedBeforeTarget: unique symbol = Symbol("Event stopped before target");
export const eventSetPassiveListener: unique symbol = Symbol("Event set passive listener");
export const eventInitialize: unique symbol = Symbol("Event initialize");
export const eventApplyConvertedInit: unique symbol = Symbol("Event apply converted init");

export class Event {
  static readonly NONE = 0;
  static readonly CAPTURING_PHASE = 1;
  static readonly AT_TARGET = 2;
  static readonly BUBBLING_PHASE = 3;

  private eventType: string;
  private eventBubbles = false;
  private eventCancelable = false;
  private eventComposed = false;
  private eventTarget: EventTarget | null = null;
  private eventCurrentTarget: EventTarget | null = null;
  private phase = Event.NONE;
  private trusted = false;
  private readonly eventTimeStamp: number;
  /**
   * One getter function shared by every instance, not one closure each.
   *
   * `Object.getOwnPropertyDescriptor(new Event("x"), "isTrusted").get` must be the
   * *same function* for two different events -- the descriptor is per-instance, the
   * accessor behind it is not. A per-instance arrow satisfies every other assertion
   * about this property and fails that one.
   */
  private static readonly isTrustedGetter = function (this: Event): boolean {
    return this.trusted;
  };
  private canceled = false;
  private propagationStopped = false;
  private dispatching = false;
  private immediateStopped = false;
  private passiveListener = false;

  constructor(...args: [type: string, init?: EventInit]) {
    requireArguments(args, 1, "Event constructor");
    const type = args[0];
    const init = args[1];
    const convertedType = coerceToDOMString(type);
    this.eventType = convertedType;
    if (init !== undefined && init !== null) {
      requireDictionary(init, "Event init");
      this.eventBubbles = init.bubbles ? true : false;
      this.eventCancelable = init.cancelable ? true : false;
      this.eventComposed = init.composed ? true : false;
    }
    // Captured at construction, as the standard requires.
    //
    // Asked rather than provoked. `AbortController`, `AbortSignal` and `EventTarget` are
    // all usable with no runtime installed, and reading the environment unguarded here
    // fails 41 of this lane's own tests. `File` reads the clock unguarded for
    // `lastModified` and gets away with it because nobody builds a `File` without a
    // platform; an `Event` is built by code that has no idea whether there is one.
    this.eventTimeStamp = hasWebPlatformRuntime()
      ? currentWebPlatformRuntime().monotonicMilliseconds()
      : 0;
    // `isTrusted` is `[LegacyUnforgeable]`: an own, non-configurable accessor on every
    // instance rather than one on the prototype. The difference is observable --
    // `Object.getOwnPropertyDescriptor(new Event("x"), "isTrusted")` must find it -- and
    // the point of it is that a script cannot redefine or delete the flag that says
    // whether a script made the event.
    Object.defineProperty(this, "isTrusted", {
      get: Event.isTrustedGetter,
      enumerable: true,
      configurable: false,
    });
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

  get timeStamp(): number {
    return this.eventTimeStamp;
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

  initEvent(...args: [type: string, bubbles?: boolean, cancelable?: boolean]): void {
    requireArguments(args, 1, "Event.initEvent");
    const type = args[0];
    const bubbles = args[1] ?? false;
    const cancelable = args[2] ?? false;
    this[eventInitialize](coerceToDOMString(type), bubbles ? true : false, cancelable ? true : false);
  }

  protected [eventInitialize](type: string, bubbles: boolean, cancelable: boolean): boolean {
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

  protected [eventApplyConvertedInit](
    bubbles: boolean,
    cancelable: boolean,
    composed: boolean,
  ): void {
    this.eventBubbles = bubbles;
    this.eventCancelable = cancelable;
    this.eventComposed = composed;
  }

  [eventBegin](target: EventTarget, trusted: boolean): void {
    if (this.dispatching) {
      throw new DOMException("Event is already dispatching or uninitialized", "InvalidStateError");
    }
    this.dispatching = true;
    this.trusted = trusted;
    this.eventTarget = target;
    this.eventCurrentTarget = target;
    this.phase = Event.AT_TARGET;
  }

  [eventEnd](): void {
    this.dispatching = false;
    this.passiveListener = false;
    this.eventCurrentTarget = null;
    this.phase = Event.NONE;
    this.propagationStopped = false;
    this.immediateStopped = false;
  }

  [eventSetPassiveListener](passive: boolean): void {
    this.passiveListener = passive;
  }

  get [eventStopped](): boolean {
    return this.immediateStopped;
  }

  get [eventStoppedBeforeTarget](): boolean {
    return this.propagationStopped;
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL constants are data properties on the interface prototype object as well as on
    // the interface object: non-writable, enumerable, **non-configurable**. Getters returning
    // the static value read correctly and have the wrong shape -- the same accessor-for-data
    // mistake as `@@toStringTag`, which this file already had.
    for (const [name, value] of [
      ["NONE", 0],
      ["CAPTURING_PHASE", 1],
      ["AT_TARGET", 2],
      ["BUBBLING_PHASE", 3],
    ] as const) {
      Object.defineProperty(this.prototype, name, {
        value,
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
    // Web IDL member attributes. Safe now: the dispatch algorithm's grip on this object and
    // the subclass constructor helpers are symbol-keyed, so `getOwnPropertyNames` reaches
    // only the interface's own members and its constants.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "Event",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export interface CustomEventInit<T> extends EventInit {
  detail?: T | null;
}

export class CustomEvent<T = unknown> extends Event {
  private customDetail: T | null;

  constructor(...args: [type: string, init?: CustomEventInit<T>]) {
    requireArguments(args, 1, "CustomEvent constructor");
    const type = args[0];
    const init = args[1];
    super(type);
    if (init === undefined || init === null) {
      this.customDetail = null;
    } else {
      requireDictionary(init, "CustomEvent init");
      const bubbles = init.bubbles ? true : false;
      const cancelable = init.cancelable ? true : false;
      const composed = init.composed ? true : false;
      const detail = init.detail;
      this[eventApplyConvertedInit](bubbles, cancelable, composed);
      this.customDetail = detail === undefined ? null : detail;
    }
  }

  get detail(): T | null {
    return this.customDetail;
  }

  initCustomEvent(
    ...args: [type: string, bubbles?: boolean, cancelable?: boolean, detail?: T | null]
  ): void {
    requireArguments(args, 1, "CustomEvent.initCustomEvent");
    const type = args[0];
    const bubbles = args[1] ?? false;
    const cancelable = args[2] ?? false;
    const detail = args[3] ?? null;
    const convertedType = coerceToDOMString(type);
    const convertedBubbles = bubbles ? true : false;
    const convertedCancelable = cancelable ? true : false;
    if (this[eventInitialize](convertedType, convertedBubbles, convertedCancelable)) {
      this.customDetail = detail;
    }
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes; this prototype carries no non-standard names.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "CustomEvent",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export type EventListener = (this: EventTarget, event: Event) => void;

export interface EventListenerObject {
  handleEvent(event: Event): void;
}

export type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

interface EventListenerCallbackObject {
  readonly handleEvent?: unknown;
}

type ConvertedEventListener = EventListener | EventListenerCallbackObject;

export interface EventHandlerSlot<Target extends EventTarget, E extends Event> {
  callback: ((this: Target, event: E) => void) | null;
  listener: EventListener | null;
}

export interface ListenerOptions {
  once?: boolean;
  capture?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

interface ListenerRecord {
  type: string;
  callback: ConvertedEventListener;
  capture: boolean;
  once: boolean;
  passive: boolean;
  removed: boolean;
  unsubscribeAbort: (() => void) | null;
  /**
   * Internal, never Web-observable: when set, this listener lives only as long as
   * the referenced resource does. It is not an `addEventListener` option and no
   * dictionary member reaches it.
   */
  weakResource: WeakRef<object> | null;
  /**
   * Internal, never Web-observable: this listener runs even after an earlier one
   * called `stopImmediatePropagation()`. It is not an `addEventListener` option and no
   * dictionary member reaches it.
   */
  resistStopPropagation: boolean;
}

interface WeaklyHeldRetirement {
  readonly target: WeakRef<EventTarget>;
  readonly listener: ListenerRecord;
}

/**
 * Captured by EventTarget's static initializer. The weakly held seam therefore
 * reaches ECMAScript-private state without becoming a property of EventTarget, so
 * script can neither call it nor observe that it exists.
 */
let registerInternal!: (
  target: EventTarget,
  type: string,
  callback: ConvertedEventListener,
  resource: object | null,
  once: boolean,
  resist: boolean,
) => void;
let retireWeaklyHeld!: (target: EventTarget, listener: ListenerRecord) => void;

/**
 * Retires a weakly held listener once its resource is collected. The held value
 * references the target weakly so that registering a listener never becomes a new
 * reason for the target to stay alive.
 */
const weaklyHeldListeners = new FinalizationRegistry<WeaklyHeldRetirement>((retirement) => {
  const target = retirement.target.deref();
  if (target !== undefined) retireWeaklyHeld(target, retirement.listener);
});

type ListenerObserver = (type: string, added: boolean) => void;

function listenerOption(value: unknown): boolean {
  return value ? true : false;
}

function isEventListener(callback: unknown): callback is EventListener {
  return typeof callback === "function";
}

function isEventListenerCallbackObject(callback: unknown): callback is EventListenerCallbackObject {
  return typeof callback === "object" && callback !== null;
}

function convertEventListener(callback: unknown): ConvertedEventListener | null {
  if (callback === undefined || callback === null) {
    return null;
  }
  if (isEventListener(callback) || isEventListenerCallbackObject(callback)) {
    return callback;
  }
  throw new TypeError("callback must be an EventListener");
}

interface ListenerOptionsDictionary {
  readonly capture?: unknown;
  readonly once?: unknown;
  readonly passive?: unknown;
  readonly signal?: unknown;
}

function isListenerOptionsDictionary(value: unknown): value is ListenerOptionsDictionary {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function convertEventListenerOptions(options: unknown): boolean {
  if (typeof options === "boolean") {
    return options;
  }
  if (options === undefined || options === null) {
    return false;
  }
  if (isListenerOptionsDictionary(options)) {
    return listenerOption(options.capture);
  }
  return options ? true : false;
}

function convertListenerSignal(signal: unknown): AbortSignalOperations | undefined {
  if (signal === undefined) {
    return undefined;
  }
  if (isEventListenerSignal(signal)) {
    return signal;
  }
  throw new TypeError("signal must be an AbortSignal");
}

function isEventListenerSignal(signal: unknown): signal is AbortSignalOperations {
  return (
    signal !== null &&
    typeof signal === "object" &&
    abortSignalBrand in signal &&
    signal[abortSignalBrand] === true &&
    "aborted" in signal &&
    typeof signal.aborted === "boolean" &&
    abortSignalSubscribe in signal &&
    typeof signal[abortSignalSubscribe] === "function"
  );
}

/** Non-tree EventTarget; deliberately not a DOM propagation implementation. */
/**
 * Keys for the members subclasses need and the standard does not define.
 *
 * `protected` is a compile-time notion: it leaves an ordinary method on the prototype, where
 * Web IDL says an interface prototype carries the interface's members and nothing else.
 * Symbols keep them reachable from `AbortSignal`, `EventSource` and `WebSocket` while taking
 * them off the enumerable surface. Never re-exported from the public barrel.
 */
export const eventTargetDispatchTrusted: unique symbol = Symbol("EventTarget dispatch trusted");
export const eventTargetSetHandler: unique symbol = Symbol("EventTarget set handler");
export const eventTargetSetListenerObserver: unique symbol = Symbol("EventTarget set listener observer");
export const eventTargetSetErrorReporter: unique symbol = Symbol("EventTarget set error reporter");
export const eventTargetReportError: unique symbol = Symbol("EventTarget report error");

export class EventTarget {
  private readonly listeners: ListenerRecord[] = [];
  private listenerObserver: ListenerObserver | null = null;
  private dispatchDepth = 0;
  private errorReporter: (error: unknown) => void = () => {};

  static {
    registerInternal = (target, type, callback, resource, once, resist): void => {
      target.#addInternal(type, callback, resource, once, resist);
    };
    retireWeaklyHeld = (target, listener): void => {
      target.#retireWeaklyHeld(listener);
    };
  }

  /**
   * Registers an internal listener, optionally bounded by `resource` and optionally
   * resisting `stopImmediatePropagation()`. Duplicate registration follows the same
   * (type, callback, capture) rule as `addEventListener`, so this seam cannot install
   * a second copy of a listener the public API would have rejected.
   */
  #addInternal(
    type: string,
    callback: ConvertedEventListener,
    resource: object | null,
    once: boolean,
    resist: boolean,
  ): void {
    if (
      this.listeners.some(
        (item) =>
          !item.removed && item.type === type && item.callback === callback && !item.capture,
      )
    )
      return;
    const listener: ListenerRecord = {
      type,
      callback,
      capture: false,
      once,
      passive: false,
      removed: false,
      unsubscribeAbort: null,
      weakResource: resource === null ? null : new WeakRef(resource),
      resistStopPropagation: resist,
    };
    this.listeners.push(listener);
    this.listenerObserver?.(type, true);
    if (resource !== null) {
      weaklyHeldListeners.register(resource, { target: new WeakRef(this), listener }, listener);
    }
  }

  #retireWeaklyHeld(listener: ListenerRecord): void {
    this.#removeRecord(listener);
  }

  addEventListener(
    ...args: [
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: ListenerOptions | boolean,
    ]
  ): void {
    requireArguments(args, 2, "EventTarget.addEventListener");
    const type = args[0];
    const callback = args[1];
    const options = args[2];
    const convertedType = coerceToDOMString(type);
    const convertedCallback = convertEventListener(callback);
    let capture = false;
    let once = false;
    let passive = false;
    let signal: AbortSignalOperations | undefined;
    if (typeof options === "boolean") {
      capture = options;
    } else if (options !== undefined && options !== null) {
      if (isListenerOptionsDictionary(options)) {
        capture = listenerOption(options.capture);
        once = listenerOption(options.once);
        passive = listenerOption(options.passive);
        signal = convertListenerSignal(options.signal);
      } else {
        capture = options ? true : false;
      }
    }
    if (convertedCallback === null) return;
    if (signal?.aborted) return;
    if (
      this.listeners.some(
        (item) =>
          !item.removed &&
          item.type === convertedType &&
          item.callback === convertedCallback &&
          item.capture === capture,
      )
    )
      return;
    const listener: ListenerRecord = {
      type: convertedType,
      callback: convertedCallback,
      capture,
      once,
      passive,
      removed: false,
      unsubscribeAbort: null,
      weakResource: null,
      resistStopPropagation: false,
    };
    this.listeners.push(listener);
    this.listenerObserver?.(convertedType, true);
    if (signal !== undefined) {
      listener.unsubscribeAbort = signal[abortSignalSubscribe](() => this.#removeRecord(listener));
    }
  }

  removeEventListener(
    ...args: [
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: ListenerOptions | boolean,
    ]
  ): void {
    requireArguments(args, 2, "EventTarget.removeEventListener");
    const type = args[0];
    const callback = args[1];
    const options = args[2];
    const convertedType = coerceToDOMString(type);
    const convertedCallback = convertEventListener(callback);
    const capture = convertEventListenerOptions(options);
    if (convertedCallback === null) return;
    for (const item of this.listeners) {
      if (
        item.type === convertedType &&
        item.callback === convertedCallback &&
        item.capture === capture
      ) {
        this.#removeRecord(item);
        return;
      }
    }
  }

  dispatchEvent(...args: [event: Event]): boolean {
    requireArguments(args, 1, "EventTarget.dispatchEvent");
    const event = args[0];
    if (!(event instanceof Event)) {
      throw new TypeError("event must be an Event");
    }
    return this.#dispatch(event, false);
  }

  /** Provider-created events are trusted; script-dispatched events are not. */
  protected [eventTargetDispatchTrusted](event: Event): boolean {
    return this.#dispatch(event, true);
  }

  #dispatch(event: Event, trusted: boolean): boolean {
    event[eventBegin](this, trusted);
    this.dispatchDepth++;
    const listenerCount = this.listeners.length;
    try {
      if (!event[eventStoppedBeforeTarget]) {
        for (let index = 0; index < listenerCount; index++) {
          const item = this.listeners[index];
          if (item === undefined) continue;
          if (item.removed || item.type !== event.type) continue;
          // `stopImmediatePropagation()` hides the rest of the list from ordinary
          // listeners. A resisting listener is internal and is not something script
          // registered, so script stopping propagation does not cancel it; scanning
          // continues rather than breaking, or the resisting listener would be
          // unreachable behind the one that stopped.
          if (event[eventStopped] && !item.resistStopPropagation) continue;
          // A finalization callback is not synchronous with collection, so the
          // liveness of the resource is decided here rather than trusting that the
          // registry has already run.
          if (item.weakResource !== null && item.weakResource.deref() === undefined) {
            this.#removeRecord(item);
            continue;
          }
          if (item.once) this.#removeRecord(item);
          event[eventSetPassiveListener](item.passive);
          try {
            if (isEventListener(item.callback)) {
              item.callback.call(this, event);
            } else {
              const handleEvent = item.callback.handleEvent;
              if (typeof handleEvent !== "function") {
                throw new TypeError("EventListener.handleEvent must be callable");
              }
              handleEvent.call(item.callback, event);
            }
          } catch (error) {
            this[eventTargetReportError](error);
          } finally {
            event[eventSetPassiveListener](false);
          }
        }
      }
    } finally {
      event[eventEnd]();
      this.dispatchDepth--;
      if (this.dispatchDepth === 0) this.#compactListeners();
    }
    return !event.defaultPrevented;
  }

  /** Property handlers occupy their registration position, just like ordinary listeners. */
  protected [eventTargetSetHandler]<Target extends EventTarget, E extends Event>(
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

  /** Lets a specialized EventTarget account for the lifetime of its listeners. */
  protected [eventTargetSetListenerObserver](observer: ListenerObserver): void {
    this.listenerObserver = observer;
  }

  /** Binds provider exception reporting without changing the public constructor. */
  protected [eventTargetSetErrorReporter](reporter: (error: unknown) => void): void {
    this.errorReporter = reporter;
  }

  /** Reports an exception through the owning provider. */
  protected [eventTargetReportError](error: unknown): void {
    this.errorReporter(error);
  }

  #removeRecord(listener: ListenerRecord): void {
    if (listener.removed) return;
    listener.removed = true;
    if (listener.weakResource !== null) {
      listener.weakResource = null;
      weaklyHeldListeners.unregister(listener);
    }
    const unsubscribe = listener.unsubscribeAbort;
    listener.unsubscribeAbort = null;
    unsubscribe?.();
    this.listenerObserver?.(listener.type, false);
    if (this.dispatchDepth === 0) this.#compactListeners();
  }

  #compactListeners(): void {
    let write = 0;
    for (let read = 0; read < this.listeners.length; read++) {
      const listener = this.listeners[read];
      if (listener !== undefined && !listener.removed) this.listeners[write++] = listener;
    }
    this.listeners.length = write;
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes. Safe now: the members subclasses need are symbol-keyed and
    // the two used only here are private identifiers, so `getOwnPropertyNames` reaches
    // nothing but the interface's own members.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "EventTarget",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * @internal Register an `EventTarget` listener whose lifetime is bounded by a
 * caller-supplied resource.
 *
 * The listener holds the resource weakly. Once the resource is collected the
 * listener is retired and a later dispatch does not call it, so a caller waiting on
 * that event waits forever rather than being answered on behalf of something that no
 * longer exists. Node's `util.aborted(signal, resource)` needs exactly this.
 *
 * This is deliberately not an `addEventListener` option and adds no property to
 * `EventTarget`: the seam is reached through a module-scope function that the class's
 * static initializer wired to ECMAScript-private state. Nothing script can pass to
 * the public API reaches it, and the host's private symbol is not copied.
 */
export function addWeaklyHeldEventListener(
  target: EventTarget,
  type: string,
  callback: EventListener,
  resource: object,
  options: InternalListenerOptions = {},
): void {
  registerInternal(
    target,
    type,
    callback,
    resource,
    options.once ?? false,
    options.resistStopPropagation ?? false,
  );
}

/** Options for the internal listener seams. None of these is Web-observable. */
export interface InternalListenerOptions {
  readonly once?: boolean;
  /**
   * Run even after an earlier listener called `stopImmediatePropagation()`.
   *
   * Script stopping propagation is a statement about the listeners script registered.
   * A runtime listener that must observe the event regardless — Node's abort listeners
   * are the case this exists for — is not one of those, and an earlier listener must
   * not be able to silence it.
   */
  readonly resistStopPropagation?: boolean;
}

/**
 * @internal Register an `EventTarget` listener that is not part of the Web API.
 *
 * Same non-observability as {@link addWeaklyHeldEventListener}: not an
 * `addEventListener` option, no new property on `EventTarget` or its prototype, and
 * the host's private symbols are not copied. The listener is held normally; use
 * {@link addWeaklyHeldEventListener} when its lifetime must follow a resource.
 */
export function addInternalEventListener(
  target: EventTarget,
  type: string,
  callback: EventListener,
  options: InternalListenerOptions = {},
): void {
  registerInternal(
    target,
    type,
    callback,
    null,
    options.once ?? false,
    options.resistStopPropagation ?? false,
  );
}

export interface MessageEventInit<T> extends EventInit {
  data?: T | null;
  lastEventId?: string;
  origin?: string;
  ports?: Iterable<EventTarget> & object;
  source?: EventTarget | null;
}

function convertEventTargetSequence(
  input: (Iterable<EventTarget> & object) | undefined,
): EventTarget[] {
  if (input === undefined) {
    return [];
  }
  if ((typeof input !== "object" || input === null) && typeof input !== "function") {
    throw new TypeError("MessageEvent ports must be a sequence");
  }
  const ports: EventTarget[] = [];
  for (const port of input) {
    if (!(port instanceof EventTarget)) {
      throw new TypeError("MessageEvent ports must contain EventTarget values");
    }
    ports.push(port);
  }
  return ports;
}

export class MessageEvent<T = unknown> extends Event {
  private messageData: T | null;
  private messageLastEventId: string;
  private messageOrigin: string;
  private messagePorts: readonly EventTarget[];
  private messageSource: EventTarget | null;

  constructor(...args: [type: string, init?: MessageEventInit<T>]) {
    requireArguments(args, 1, "MessageEvent constructor");
    const type = args[0];
    const init = args[1];
    super(type);
    if (init === undefined || init === null) {
      this.messageData = null;
      this.messageLastEventId = "";
      this.messageOrigin = "";
      this.messagePorts = [];
      this.messageSource = null;
    } else {
      requireDictionary(init, "MessageEvent init");
      const bubbles = init.bubbles ? true : false;
      const cancelable = init.cancelable ? true : false;
      const composed = init.composed ? true : false;
      const dataValue = init.data;
      const lastEventIdValue = init.lastEventId;
      const lastEventId = lastEventIdValue === undefined ? "" : coerceToDOMString(lastEventIdValue);
      const originValue = init.origin;
      const origin = originValue === undefined ? "" : coerceToUSVString(originValue);
      const ports = convertEventTargetSequence(init.ports);
      const sourceValue = init.source;
      if (
        sourceValue !== undefined &&
        sourceValue !== null &&
        !(sourceValue instanceof EventTarget)
      ) {
        throw new TypeError("MessageEvent source must be an EventTarget");
      }
      this[eventApplyConvertedInit](bubbles, cancelable, composed);
      this.messageData = dataValue === undefined ? null : dataValue;
      this.messageLastEventId = lastEventId;
      this.messageOrigin = origin;
      this.messagePorts = ports;
      this.messageSource = sourceValue ?? null;
    }
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
    ...args: [
      type: string,
      bubbles?: boolean,
      cancelable?: boolean,
      data?: T | null,
      origin?: string,
      lastEventId?: string,
      source?: EventTarget | null,
      ports?: Iterable<EventTarget> & object,
    ]
  ): void {
    requireArguments(args, 1, "MessageEvent.initMessageEvent");
    const type = args[0];
    const bubbles = args[1] ?? false;
    const cancelable = args[2] ?? false;
    const data = args[3] ?? null;
    const origin = args[4] === undefined ? "" : args[4];
    const lastEventId = args[5] === undefined ? "" : args[5];
    const source = args[6] ?? null;
    const ports = args[7] === undefined ? [] : args[7];
    const convertedType = coerceToDOMString(type);
    const convertedBubbles = bubbles ? true : false;
    const convertedCancelable = cancelable ? true : false;
    const convertedOrigin = coerceToUSVString(origin);
    const convertedLastEventId = coerceToDOMString(lastEventId);
    if (source !== null && !(source instanceof EventTarget)) {
      throw new TypeError("MessageEvent source must be an EventTarget");
    }
    const convertedPorts = convertEventTargetSequence(ports);
    if (!this[eventInitialize](convertedType, convertedBubbles, convertedCancelable)) return;
    this.messageData = data;
    this.messageOrigin = convertedOrigin;
    this.messageLastEventId = convertedLastEventId;
    this.messageSource = source;
    this.messagePorts = convertedPorts;
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes; this prototype carries no non-standard names.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "MessageEvent",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
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

  constructor(...args: [type: string, init?: CloseEventInit]) {
    requireArguments(args, 1, "CloseEvent constructor");
    const type = args[0];
    const init = args[1];
    super(type);
    if (init === undefined || init === null) {
      this.closeCode = 0;
      this.closeReason = "";
      this.clean = false;
    } else {
      requireDictionary(init, "CloseEvent init");
      const bubbles = init.bubbles ? true : false;
      const cancelable = init.cancelable ? true : false;
      const composed = init.composed ? true : false;
      const codeValue = init.code;
      const code = codeValue === undefined ? 0 : toUnsignedShort(codeValue);
      const reasonValue = init.reason;
      const reason = reasonValue === undefined ? "" : coerceToUSVString(reasonValue);
      const wasClean = init.wasClean ? true : false;
      this[eventApplyConvertedInit](bubbles, cancelable, composed);
      this.closeCode = code;
      this.closeReason = reason;
      this.clean = wasClean;
    }
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

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes; this prototype carries no non-standard names.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "CloseEvent",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
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

  constructor(...args: [type: string, init?: ErrorEventInit]) {
    requireArguments(args, 1, "ErrorEvent constructor");
    const type = args[0];
    const init = args[1];
    super(type);
    if (init === undefined || init === null) {
      this.errorColumn = 0;
      this.errorValue = undefined;
      this.errorFilename = "";
      this.errorLine = 0;
      this.errorMessage = "";
    } else {
      requireDictionary(init, "ErrorEvent init");
      const bubbles = init.bubbles ? true : false;
      const cancelable = init.cancelable ? true : false;
      const composed = init.composed ? true : false;
      const colnoValue = init.colno;
      const colno = colnoValue === undefined ? 0 : toUnsignedLong(colnoValue);
      const errorValue = init.error;
      const filenameValue = init.filename;
      const filename = filenameValue === undefined ? "" : coerceToUSVString(filenameValue);
      const linenoValue = init.lineno;
      const lineno = linenoValue === undefined ? 0 : toUnsignedLong(linenoValue);
      const messageValue = init.message;
      const message = messageValue === undefined ? "" : coerceToDOMString(messageValue);
      this[eventApplyConvertedInit](bubbles, cancelable, composed);
      this.errorColumn = colno;
      this.errorValue = errorValue;
      this.errorFilename = filename;
      this.errorLine = lineno;
      this.errorMessage = message;
    }
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

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes; this prototype carries no non-standard names.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ErrorEvent",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

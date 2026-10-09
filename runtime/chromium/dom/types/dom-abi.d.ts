/** @ntsHeader "dom_abi.h" */
// The hand-written half of `nts:dom`: what Blink's IDL does not say. The
// interfaces and their members are generated (types/dom-idl.d.ts); this is
// the document an entry runs in, and listening with a compiled closure.
// Contract: abi/dom_abi.h.
declare module "nts:dom" {
  import type { CNumber, Closure, HostClass, Ptr, ScopedClosure, StringView } from "c:types";
  /**
   * `requestAnimationFrame(callback)`: once, before the next frame, with its
   * time, in the queue page script's callbacks share.
   * @ntsSymbol nts_dom_request_animation_frame
   */
  export function requestAnimationFrame(callback: Closure<(time: CNumber<"double">) => void>): CNumber<"int32">;
  /** @ntsSymbol nts_dom_cancel_animation_frame */
  export function cancelAnimationFrame(id: CNumber<"int32">): void;
  /**
   * `requestIdleCallback(callback, { timeout })`: once, in an idle period or
   * once the timeout (ms) passes, with the deadline. Answers the id
   * cancelIdleCallback takes.
   * @ntsSymbol nts_dom_request_idle_callback
   */
  export function requestIdleCallback(callback: Closure<(deadline: IdleDeadline) => void>, timeout: CNumber<"double">): CNumber<"int32">;
  /**
   * `requestIdleCallback(callback)`: no timeout.
   * @ntsSymbol nts_dom_request_idle_callback_default
   */
  export function requestIdleCallback(callback: Closure<(deadline: IdleDeadline) => void>): CNumber<"int32">;
  /** @ntsSymbol nts_dom_cancel_idle_callback */
  export function cancelIdleCallback(id: CNumber<"int32">): void;
  /**
   * `setTimeout(handler, timeout)`: once, after the timeout, as HTML's timer
   * steps schedule it. Answers the id clearTimeout takes.
   * @ntsSymbol nts_dom_set_timeout
   */
  export function setTimeout(handler: Closure<() => void>, timeout: CNumber<"double">): CNumber<"int32">;
  /**
   * `setTimeout(handler)`: the timeout is 0.
   * @ntsSymbol nts_dom_set_timeout_default
   */
  export function setTimeout(handler: Closure<() => void>): CNumber<"int32">;
  /**
   * `setInterval(handler, timeout)`: every timeout until cleared.
   * @ntsSymbol nts_dom_set_interval
   */
  export function setInterval(handler: Closure<() => void>, timeout: CNumber<"double">): CNumber<"int32">;
  /**
   * `setInterval(handler)`: the timeout is 0, so at least 1 ms.
   * @ntsSymbol nts_dom_set_interval_default
   */
  export function setInterval(handler: Closure<() => void>): CNumber<"int32">;
  /**
   * `clearTimeout(id)`: any number, converted as WebIDL's `long` (ToInt32),
   * as page script's binding converts it.
   * @ntsSymbol nts_dom_clear_timeout
   */
  export function clearTimeout(id: CNumber<"double">): void;
  /**
   * `clearInterval(id)`: as clearTimeout.
   * @ntsSymbol nts_dom_clear_interval
   */
  export function clearInterval(id: CNumber<"double">): void;
  /**
   * `new MutationObserver(callback)`: Blink's own observer, delivering to
   * the closure with the records and the observer, at the microtask
   * checkpoint page script's are delivered at. Observe with `observe(target,
   * {childList: true, ...})`.
   * @ntsSymbol nts_dom_new_mutation_observer
   */
  export function newMutationObserver(callback: Closure<(records: MutationRecordSequence, observer: MutationObserver) => void>): MutationObserver;
  /**
   * `new ResizeObserver(callback)`: delivered in the rendering steps after
   * layout, with the entries and the observer, as page script's is.
   * @ntsSymbol nts_dom_new_resize_observer
   */
  export function newResizeObserver(callback: Closure<(entries: ResizeObserverEntrySequence, observer: ResizeObserver) => void>): ResizeObserver;
  /**
   * `new IntersectionObserver(callback)`, with the default options: the
   * viewport, no margin, threshold 0. Delivered by a posted task.
   * @ntsSymbol nts_dom_new_intersection_observer
   */
  export function newIntersectionObserver(callback: Closure<(entries: IntersectionObserverEntrySequence, observer: IntersectionObserver) => void>): IntersectionObserver;
  /** The document the running code is part of. */
  /** @ntsSymbol nts_dom_document */
  export function document(): Document;
  /**
   * The window of the document the running code is part of: page script's
   * `window`.
   * @ntsSymbol nts_dom_window
   */
  export function window(): Window;
  export interface HTMLCanvasElementOwnMethods {
    /**
     * `canvas.getContext("2d")`: the canvas's 2D context, made on first use;
     * null if it already has a context of another kind.
     * @ntsSymbol nts_dom_HTMLCanvasElement_getContext_2d
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    getContext(this: HTMLCanvasElement, contextId: "2d", error?: Ptr<DOMException | null>): CanvasRenderingContext2D | null;
  }
  export interface CanvasRenderingContext2DOwnMethods {
    /**
     * `ctx.fillStyle = color`: a CSS color; one that does not parse is
     * ignored, as in page script.
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_set_fillStyle_string
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    _set_fillStyle_string(this: CanvasRenderingContext2D, value: StringView, error?: Ptr<DOMException | null>): void;
    /**
     * `ctx.fillStyle = gradient`.
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_set_fillStyle_gradient
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    _set_fillStyle_gradient(this: CanvasRenderingContext2D, value: CanvasGradient, error?: Ptr<DOMException | null>): void;
    /**
     * @ntsSet _set_fillStyle_string
     */
    set fillStyle(value: StringView);
    /**
     * `ctx.strokeStyle = color`.
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_set_strokeStyle_string
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    _set_strokeStyle_string(this: CanvasRenderingContext2D, value: StringView, error?: Ptr<DOMException | null>): void;
    /**
     * `ctx.strokeStyle = gradient`.
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_set_strokeStyle_gradient
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    _set_strokeStyle_gradient(this: CanvasRenderingContext2D, value: CanvasGradient, error?: Ptr<DOMException | null>): void;
    /**
     * @ntsSet _set_strokeStyle_string
     */
    set strokeStyle(value: StringView);
    /**
     * `ctx.fillStyle = pattern`.
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_set_fillStyle_pattern
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    _set_fillStyle_pattern(this: CanvasRenderingContext2D, value: CanvasPattern, error?: Ptr<DOMException | null>): void;
    /**
     * `ctx.strokeStyle = pattern`.
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_set_strokeStyle_pattern
     * @ntsThrows error nts_dom_exception_take_message
     * @ntsNoEscape error
     */
    _set_strokeStyle_pattern(this: CanvasRenderingContext2D, value: CanvasPattern, error?: Ptr<DOMException | null>): void;
  }
  export interface EventTargetOwnMethods {
    /**
     * `addEventListener(type, listener)` for a compiled closure, called with
     * the event. The returned listener removes it.
     * @ntsSymbol nts_dom_listen
     */
    listen(this: EventTarget, type: StringView, listener: Closure<(event: Event) => void>): Listener;
    /**
     * `addEventListener` as the DOM defines it: an equal listener -- same
     * type, capture and function -- is added once. `once` removes it before
     * its first call; aborting `signal` removes it. `passive` left out is
     * Blink's to default: true for touch and wheel listeners on the window,
     * the document and its root and body.
     * @ntsSymbol nts_dom_add_event_listener
     * @ntsDefault capture=0 once=0 signal=null
     */
    addEventListener(this: EventTarget, type: StringView, listener: EventCallback, capture?: boolean, once?: boolean, signal?: AbortSignal | null): void;
    /**
     * The same with `passive` given: a passive listener's preventDefault()
     * does nothing. An options literal reaches this overload only when it
     * names `passive`, so passive's default is never used.
     * @ntsSymbol nts_dom_add_event_listener_passive
     * @ntsDefault capture=0 once=0 signal=null passive=0
     */
    addEventListener(this: EventTarget, type: StringView, listener: EventCallback, capture?: boolean, once?: boolean, signal?: AbortSignal | null, passive?: boolean): void;
    /**
     * @ntsSymbol nts_dom_remove_event_listener
     * @ntsDefault capture=0
     */
    removeEventListener(this: EventTarget, type: StringView, listener: ScopedClosure<(event: Event) => void>, capture?: boolean): void;
  }
  export interface ListenerMethods {
    /**
     * Stops listening and gives the closure back; again, nothing.
     * @ntsSymbol nts_dom_unlisten
     */
    remove(this: Listener): void;
  }
  /** A listener's closure: one type, shared by the overloads that take it. */
  export type EventCallback = Closure<(event: Event) => void>;
  export type Listener = HostClass<"NtsDomListener", null, "nts_dom_listener_retain", "nts_dom_listener_release"> &
    ListenerMethods;
}

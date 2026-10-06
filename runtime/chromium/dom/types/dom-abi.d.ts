/** @ntsHeader "dom_abi.h" */
// The hand-written half of `nts:dom`: what Blink's IDL does not say. The
// interfaces and their members are generated (types/dom-idl.d.ts); this is
// the document an entry runs in, and listening with a compiled closure.
// Contract: abi/dom_abi.h.
declare module "nts:dom" {
  import type { CNumber, Closure, HostClass, ScopedClosure, StringView } from "c:types";
  /**
   * `requestAnimationFrame(callback)`: once, before the next frame, with its
   * time, in the queue page script's callbacks share.
   * @ntsSymbol nts_dom_request_animation_frame
   */
  export function requestAnimationFrame(callback: Closure<(time: CNumber<"double">) => void>): CNumber<"int32">;
  /** @ntsSymbol nts_dom_cancel_animation_frame */
  export function cancelAnimationFrame(id: CNumber<"int32">): void;
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
  /** @ntsSymbol nts_dom_clear_timeout */
  export function clearTimeout(id: CNumber<"int32">): void;
  /** @ntsSymbol nts_dom_clear_interval */
  export function clearInterval(id: CNumber<"int32">): void;
  /** The document the running code is part of. */
  /** @ntsSymbol nts_dom_document */
  export function document(): Document;
  /**
   * The window of the document the running code is part of: page script's
   * `window`.
   * @ntsSymbol nts_dom_window
   */
  export function window(): Window;
  export interface EventTargetOwnMethods {
    /**
     * `addEventListener(type, listener)` for a compiled closure, called with
     * the event. The returned listener removes it.
     * @ntsSymbol nts_dom_listen
     */
    listen(this: EventTarget, type: StringView, listener: Closure<(event: Event) => void>): Listener;
    /**
     * `addEventListener` as the DOM defines it: an equal listener -- same
     * type, capture and function -- is added once.
     * @ntsSymbol nts_dom_add_event_listener
     * @ntsDefault capture=0
     */
    addEventListener(this: EventTarget, type: StringView, listener: Closure<(event: Event) => void>, capture?: boolean): void;
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
  export type Listener = HostClass<"NtsDomListener", null, "nts_dom_listener_retain", "nts_dom_listener_release"> &
    ListenerMethods;
}

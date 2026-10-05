/** @ntsHeader "dom_abi.h" */
// The hand-written half of `nts:dom`: what Blink's IDL does not say. The
// interfaces and their members are generated (types/dom-idl.d.ts); this is
// the document an entry runs in, and listening with a compiled closure.
// Contract: native/ffi/dom_abi.h.
declare module "nts:dom" {
  import type { CNumber, Closure, HostClass, StringView } from "c:types";
  /**
   * `requestAnimationFrame(callback)`: once, before the next frame, with its
   * time, in the queue page script's callbacks share.
   * @ntsSymbol nts_dom_request_animation_frame
   */
  export function requestAnimationFrame(callback: Closure<(time: CNumber<"double">) => void>): CNumber<"int32">;
  /** @ntsSymbol nts_dom_cancel_animation_frame */
  export function cancelAnimationFrame(id: CNumber<"int32">): void;
  /** The document the running code is part of. */
  /** @ntsSymbol nts_dom_document */
  export function document(): Document;
  export interface EventTargetOwnMethods {
    /**
     * `addEventListener(type, listener)` for a compiled closure, called with
     * the event. The returned listener removes it.
     * @ntsSymbol nts_dom_listen
     */
    listen(this: EventTarget, type: StringView, listener: Closure<(event: Event) => void>): Listener;
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

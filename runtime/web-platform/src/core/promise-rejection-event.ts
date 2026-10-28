import { Event, eventApplyConvertedInit } from "./events.ts";
import type { EventInit } from "./events.ts";
import { coerceToDOMString, requireArguments, requireDictionary } from "./webidl.ts";

export interface PromiseRejectionEventInit extends EventInit {
  promise: object;
  reason?: unknown;
}

/** HTML: the PromiseRejectionEvent interface, including its Web IDL dictionary. */
export class PromiseRejectionEvent extends Event {
  readonly #promise: object;
  readonly #reason: unknown;
  readonly [Symbol.toStringTag] = "PromiseRejectionEvent";

  constructor(type: string, init: PromiseRejectionEventInit) {
    requireArguments(arguments, 2, "PromiseRejectionEvent constructor");
    const convertedType = coerceToDOMString(type);
    requireDictionary(init, "PromiseRejectionEvent init");
    let bubbles = false;
    let cancelable = false;
    let composed = false;
    if (init !== undefined && init !== null) {
      // Inherited dictionary members are converted before the derived members,
      // and all conversion finishes before Event captures its timestamp.
      bubbles = !!init.bubbles;
      cancelable = !!init.cancelable;
      composed = !!init.composed;
    }
    const promise = init === undefined || init === null ? undefined : init.promise;
    // HTML deliberately declares object, not Promise<any>: retain any object or
    // function without reading .then, wrapping it, or checking a Promise brand.
    // https://html.spec.whatwg.org/#the-promiserejectionevent-interface
    // https://webidl.spec.whatwg.org/#es-object
    if (promise === null || (typeof promise !== "object" && typeof promise !== "function")) {
      throw new TypeError("PromiseRejectionEvent init.promise must be an object");
    }
    const reason = init.reason;
    super(convertedType);
    this[eventApplyConvertedInit](bubbles, cancelable, composed);
    this.#promise = promise;
    this.#reason = reason;
  }

  get promise(): object {
    return this.#promise;
  }

  get reason(): unknown {
    return this.#reason;
  }
}

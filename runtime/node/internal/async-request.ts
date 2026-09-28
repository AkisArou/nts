// One native request as an async resource: node's `ReqWrap`.
//
// A request -- a connect, a write, a DNS lookup -- is an `AsyncWrap` in node:
// hooks see it `init` when it is made, `before` and `after` around its one
// callback, and `destroy` straight after. Its callback also runs in the async
// context the request was made in, which is what keeps `AsyncLocalStorage`
// flowing through a callback-style API. `net` had this as its own
// `SocketRequest`; it is shared so that every module's requests report the
// same way.

import { AsyncContextFrame } from "./async-context.ts";
import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  initHooksExist,
  newAsyncId,
} from "./async-hooks.ts";

/** The request provider names node's `AsyncWrap` reports, for the requests this profile makes. */
export type RequestProvider =
  | "GETADDRINFOREQWRAP"
  | "GETNAMEINFOREQWRAP"
  | "QUERYWRAP"
  | "TCPCONNECTWRAP"
  | "PIPECONNECTWRAP"
  | "WRITEWRAP"
  | "SHUTDOWNWRAP"
  | "RANDOMBYTESREQUEST"
  | "PBKDF2REQUEST"
  | "DERIVEBITSREQUEST"
  | "SCRYPTREQUEST"
  | "SIGNREQUEST";

export class AsyncRequest {
  #asyncId: number;
  #triggerAsyncId: number;
  #contextFrame: AsyncContextFrame | undefined;

  constructor(type: RequestProvider, triggerAsyncId: number) {
    this.#asyncId = newAsyncId();
    this.#triggerAsyncId = triggerAsyncId;
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      emitInit(this.#asyncId, type, triggerAsyncId, this);
    }
  }

  /**
   * Run the request's callback in its scope, then retire the request. Returns
   * nothing: a generic result was refused by the compiled lane, and every
   * caller is a completion that has nothing to hand back.
   */
  complete(callback: () => void): void {
    const prior = AsyncContextFrame.exchange(this.#contextFrame);
    emitBefore(this.#asyncId, this.#triggerAsyncId, this);
    // `after` only when the callback returns. A callback that throws leaves
    // its scope open, as node's does, so the `uncaughtException` handler runs
    // inside the request; the process's fatal-exception path then closes
    // every scope still open. `destroy` is queued either way.
    try {
      callback();
      emitAfter(this.#asyncId);
    } finally {
      emitDestroy(this.#asyncId);
      AsyncContextFrame.setCurrent(prior);
    }
  }
}

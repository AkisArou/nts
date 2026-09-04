// `node:async_hooks`, from node v24.20.0 `lib/async_hooks.js`.
//
// Two audiences, and the module reads oddly until they are separated.
//
// `AsyncLocalStorage` is for programs: it answers "which request is this?" and
// almost every use of this module in the wild is that class alone. It is
// exported from here for historical reasons rather than structural ones.
//
// `createHook` is for tools -- tracers, profilers, leak hunters. It offers a
// callback on every asynchronous resource the process creates, enters, leaves
// and discards, which is enough to reconstruct a causal graph of everything
// that happened. That power is why the hooks are constrained the way they are:
// they run between a resource and the code using it, so a hook that throws
// takes the process down, and a hook that is slow is slow on every operation
// in the program.

import {
  ERR_ASYNC_CALLBACK,
  ERR_INVALID_ARG_VALUE,
} from "../../internal/errors.ts";
import { validateBoolean, validateFunction } from "../../internal/validators.ts";
import {
  addHook,
  enabledHooksExist,
  executionAsyncId,
  executionAsyncResource,
  removeHook,
  triggerAsyncId,
  type HookCallbacks,
  type RegisteredHook,
} from "../../internal/async-hooks.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import { AsyncResource } from "./resource.ts";
import { AsyncLocalStorage, RunScope } from "./local-storage.ts";

export { AsyncResource, AsyncLocalStorage, RunScope };
export { executionAsyncId, triggerAsyncId, executionAsyncResource };
export type { AsyncLocalStorageOptions } from "./local-storage.ts";
export type { AsyncResourceOptions } from "./resource.ts";
export type { HookCallbacks };

/** Enqueue a raw VM microtask without creating a promise. */
declare function nts_enqueue_microtask(callback: () => void): void;

const microtaskResourceOptions: Readonly<{ requireManualDestroy: true }> = {
  requireManualDestroy: true,
};

/**
 * The Node-global `queueMicrotask`, kept here because it participates in this
 * module's resource graph even though it is not a named export.
 *
 * The no-context/no-hook path stays allocation-free. Once either facility is
 * active, an explicit resource carries both the async id and context frame
 * across the VM queue boundary and reports its finite lifetime.
 */
export function queueMicrotaskForRuntime(callback: () => void): void {
  validateFunction(callback, "callback");

  if (AsyncContextFrame.current() === undefined && !enabledHooksExist()) {
    nts_enqueue_microtask(callback);
    return;
  }

  const resource = new AsyncResource("Microtask", microtaskResourceOptions);
  nts_enqueue_microtask(() => {
    resource.runInAsyncScope(() => {
      try {
        callback();
      } finally {
        resource.emitDestroy();
      }
    });
  });
}

/**
 * A registration, with `enable`/`disable` on it.
 *
 * Created disabled. A hook that started running the moment it was constructed
 * would fire for resources created between the constructor returning and the
 * caller finishing its setup, which is a race a program cannot close.
 */
export class AsyncHook {
  /** What the registry sees. Kept apart so the callbacks cannot be swapped. */
  #registration: RegisteredHook;

  constructor(callbacks: HookCallbacks) {
    const { init, before, after, destroy, promiseResolve, trackPromises } = callbacks;
    // Checked here, at registration, rather than where they are called. A hook
    // is called from between a resource and its consumer, and a TypeError
    // thrown there would be fatal and would point at this module rather than
    // at the program that passed the wrong thing.
    if (init !== undefined && typeof init !== "function") throw new ERR_ASYNC_CALLBACK("hook.init");
    if (before !== undefined && typeof before !== "function") throw new ERR_ASYNC_CALLBACK("hook.before");
    if (after !== undefined && typeof after !== "function") throw new ERR_ASYNC_CALLBACK("hook.after");
    if (destroy !== undefined && typeof destroy !== "function") throw new ERR_ASYNC_CALLBACK("hook.destroy");
    if (promiseResolve !== undefined && typeof promiseResolve !== "function") {
      throw new ERR_ASYNC_CALLBACK("hook.promiseResolve");
    }
    if (trackPromises !== undefined) validateBoolean(trackPromises, "trackPromises");

    if (trackPromises === false && promiseResolve) {
      throw new ERR_INVALID_ARG_VALUE(
        "trackPromises",
        trackPromises,
        "must not be false when promiseResolve is enabled",
      );
    }

    this.#registration = {
      init,
      before,
      after,
      destroy,
      promiseResolve,
      // Opting out of promises is what a hook does when it only cares about
      // I/O: promises are far and away the most numerous resource in a
      // running program, and reporting them costs every `async` call.
      noPromiseHook: trackPromises === false,
    };
  }

  enable(): this {
    addHook(this.#registration);
    return this;
  }

  disable(): this {
    removeHook(this.#registration);
    return this;
  }
}

export function createHook(callbacks: HookCallbacks): AsyncHook {
  return new AsyncHook(callbacks);
}

/**
 * The names and numbers of the resource types the runtime reports.
 *
 * A closed, readonly table rather than node's frozen null-prototype object.
 * NTS objects have a static layout and no prototype chain, so neither piece of
 * engine machinery changes a lookup here. Generated from node's
 * `NODE_ASYNC_PROVIDER_TYPES`, in its order: the numbers are part of the
 * interface, not an implementation detail, because a hook may receive either
 * the name or the number depending on where the resource came from.
 */
export const asyncWrapProviders: Readonly<Record<string, number>> = {
  NONE: 0,
  DIRHANDLE: 1,
  DNSCHANNEL: 2,
  ELDHISTOGRAM: 3,
  FILEHANDLE: 4,
  FILEHANDLECLOSEREQ: 5,
  BLOBREADER: 6,
  FSEVENTWRAP: 7,
  FSREQCALLBACK: 8,
  FSREQPROMISE: 9,
  GETADDRINFOREQWRAP: 10,
  GETNAMEINFOREQWRAP: 11,
  HEAPSNAPSHOT: 12,
  HTTP2SESSION: 13,
  HTTP2STREAM: 14,
  HTTP2PING: 15,
  HTTP2SETTINGS: 16,
  HTTPINCOMINGMESSAGE: 17,
  HTTPCLIENTREQUEST: 18,
  LOCKS: 19,
  JSSTREAM: 20,
  JSUDPWRAP: 21,
  MESSAGEPORT: 22,
  PIPECONNECTWRAP: 23,
  PIPESERVERWRAP: 24,
  PIPEWRAP: 25,
  PROCESSWRAP: 26,
  PROMISE: 27,
  QUERYWRAP: 28,
  QUIC_ENDPOINT: 29,
  QUIC_LOGSTREAM: 30,
  QUIC_SESSION: 31,
  QUIC_STREAM: 32,
  QUIC_UDP: 33,
  SHUTDOWNWRAP: 34,
  SIGNALWRAP: 35,
  STATWATCHER: 36,
  STREAMPIPE: 37,
  TCPCONNECTWRAP: 38,
  TCPSERVERWRAP: 39,
  TCPWRAP: 40,
  TTYWRAP: 41,
  UDPSENDWRAP: 42,
  UDPWRAP: 43,
  SIGINTWATCHDOG: 44,
  WORKER: 45,
  WORKERCPUPROFILE: 46,
  WORKERCPUUSAGE: 47,
  WORKERHEAPPROFILE: 48,
  WORKERHEAPSNAPSHOT: 49,
  WORKERHEAPSTATISTICS: 50,
  WRITEWRAP: 51,
  ZLIB: 52,
  CHECKPRIMEREQUEST: 53,
  PBKDF2REQUEST: 54,
  KEYPAIRGENREQUEST: 55,
  KEYGENREQUEST: 56,
  KEYEXPORTREQUEST: 57,
  ARGON2REQUEST: 58,
  CIPHERREQUEST: 59,
  DERIVEBITSREQUEST: 60,
  HASHREQUEST: 61,
  RANDOMBYTESREQUEST: 62,
  RANDOMPRIMEREQUEST: 63,
  SCRYPTREQUEST: 64,
  SIGNREQUEST: 65,
  TLSWRAP: 66,
  VERIFYREQUEST: 67,
};

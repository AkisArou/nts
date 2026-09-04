// The object node's tests see as `require('async_hooks')`.
//
// Node exports seven names and nothing else. Ours has more -- `AsyncHook` and
// `RunScope` are classes a program can reach through the values it is given
// but cannot name -- so the extras are dropped here rather than left to be
// noticed by a test that enumerates the module.

import * as hooks from "../internal/async-hooks.ts";

export function shape(exports) {
  return {
    AsyncLocalStorage: exports.AsyncLocalStorage,
    createHook: exports.createHook,
    executionAsyncId: exports.executionAsyncId,
    triggerAsyncId: exports.triggerAsyncId,
    executionAsyncResource: exports.executionAsyncResource,
    asyncWrapProviders: exports.asyncWrapProviders,
    AsyncResource: exports.AsyncResource,
  };
}

/**
 * The node-internal module ids these files stand in for.
 *
 * Node's tests reach for `internal/async_hooks` in two ways: for
 * `enabledHooksExist`, to assert that a module they loaded did not quietly
 * turn hooks on, and for `symbols.async_id_symbol`, to read the id a core
 * object is carrying. Both are internal on purpose -- the first is a statement
 * about this module's own state, and the second names a slot on somebody
 * else's object.
 */
export function internals() {
  return {
    "internal/async_hooks": {
      enabledHooksExist: hooks.enabledHooksExist,
      initHooksExist: hooks.initHooksExist,
      afterHooksExist: hooks.afterHooksExist,
      destroyHooksExist: hooks.destroyHooksExist,
      promiseResolveHooksExist: hooks.promiseResolveHooksExist,
      newAsyncId: hooks.newAsyncId,
      getOrSetAsyncId: hooks.getOrSetAsyncId,
      getDefaultTriggerAsyncId: hooks.getDefaultTriggerAsyncId,
      defaultTriggerAsyncIdScope: hooks.defaultTriggerAsyncIdScope,
      emitInit: hooks.emitInit,
      emitBefore: hooks.emitBefore,
      emitAfter: hooks.emitAfter,
      emitDestroy: hooks.emitDestroy,
      hasAsyncIdStack: hooks.hasAsyncIdStack,
      pushAsyncContext: hooks.pushAsyncContext,
      popAsyncContext: hooks.popAsyncContext,
      executionAsyncId: hooks.executionAsyncId,
      triggerAsyncId: hooks.triggerAsyncId,
      registerDestroyHook: hooks.registerDestroyHook,
      symbols: {
        async_id_symbol: hooks.kAsyncId,
        trigger_async_id_symbol: hooks.kTriggerAsyncId,
        owner_symbol: hooks.kResourceOwner,
      },
    },
  };
}

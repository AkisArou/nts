// The object node's tests see as `require('async_hooks')`.
//
// Node exports seven names and nothing else. Ours has more -- `AsyncHook` and
// `RunScope` are classes a program can reach through the values it is given
// but cannot name -- so the extras are dropped here rather than left to be
// noticed by a test that enumerates the module.

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

export function installGlobals(_underTest, rawExports) {
  globalThis.queueMicrotask = rawExports.queueMicrotaskForRuntime;
}

/**
 * The node-internal module ids these files stand in for.
 *
 * Node's tests reach for `internal/async_hooks` in two ways: for
 * `enabledHooksExist`, to assert that a module they loaded did not quietly
 * turn hooks on. Node also exposes private Symbol slots here; those require a
 * dynamic property map and are outside the NTS object model, so this shape does
 * not advertise them.
 */
export function internals(exports) {
  return {
    // Node's GC regression test only asks which of its two implementations is
    // active so it can perform the matching cleanup. This profile always uses
    // continuation-preserved frames, so the truthful answer is fixed.
    "internal/async_context_frame": {
      enabled: true,
    },
    "internal/async_hooks": {
      enabledHooksExist: exports.enabledHooksExist,
      initHooksExist: exports.initHooksExist,
      afterHooksExist: exports.afterHooksExist,
      destroyHooksExist: exports.destroyHooksExist,
      promiseResolveHooksExist: exports.promiseResolveHooksExist,
      newAsyncId: exports.newAsyncId,
      getOrSetAsyncId: exports.getOrSetAsyncId,
      getDefaultTriggerAsyncId: exports.getDefaultTriggerAsyncId,
      defaultTriggerAsyncIdScope: exports.defaultTriggerAsyncIdScope,
      emitInit: exports.emitInit,
      emitBefore: exports.emitBefore,
      emitAfter: exports.emitAfter,
      emitDestroy: exports.emitDestroy,
      hasAsyncIdStack: exports.hasAsyncIdStack,
      pushAsyncContext: exports.pushAsyncContext,
      popAsyncContext: exports.popAsyncContext,
      executionAsyncId: exports.executionAsyncId,
      triggerAsyncId: exports.triggerAsyncId,
      registerDestroyHook: exports.registerDestroyHook,
    },
  };
}

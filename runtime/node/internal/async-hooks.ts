// The bookkeeping under `node:async_hooks`, from node v24.20.0
// `lib/internal/async_hooks.js`.
//
// Two things live here that are easy to conflate. One is the *identity* of
// asynchronous work -- every resource gets a number, and every callback runs
// with a current number and the number of whatever caused it. The other is the
// *observation* of it: the hooks a program registers to be told when resources
// are created, entered, left and collected.
//
// The identity half has to be maintained whether or not anyone is watching,
// because a hook enabled halfway through must still see coherent ids. The
// observation half is skipped entirely when no hook wants it, which is why
// nearly every emit below opens with a count check: this code sits between a
// callback and its caller on every single asynchronous operation in the
// process, so the cost of it doing nothing is a cost the whole runtime pays.
//
// Node keeps the counters in typed arrays shared with C++. There is no C++ to
// share with here, so they are named fields.

/**
 * Write to standard error.
 *
 * The binding rather than `internal/stdio.ts`, which is a `Writable` built on
 * `EventEmitter`, which schedules through `nextTick`, which reports itself to
 * this file. Reaching for the stream here would close that loop. It is also
 * the right layer: this is the fatal path, and it should not depend on any
 * machinery that could itself be the thing that failed.
 */
declare function nts_write_stderr(text: string): number;

/** Stop the process. A hook that throws is not a recoverable condition. */
declare function nts_process_really_exit(code: number): void;

/**
 * Watch promises being created, entered, left and settled.
 *
 * A VM capability, like the context frame: a promise's continuation is
 * scheduled by the engine, so only the engine can say when it runs. Passing
 * `null` for a callback means "do not report this", which matters because the
 * engine can skip work for the ones nobody asked for.
 */
declare function nts_promise_hook_install(
  init: ((promise: object, parent: object | undefined) => void) | null,
  before: ((promise: object) => void) | null,
  after: ((promise: object) => void) | null,
  settled: ((promise: object) => void) | null,
): void;

/** Stop reporting promises entirely. */
declare function nts_promise_hook_uninstall(): void;

/**
 * Run `callback` at the end of the current microtask drain.
 *
 * A binding rather than `Promise.resolve().then(...)` because the callers here
 * are the promise machinery: scheduling with a promise would create a promise,
 * which the hook being torn down would report, which would schedule another.
 * Node uses a native `enqueueMicrotask` for the same reason.
 */
declare function nts_enqueue_microtask(callback: () => void): void;

/** Schedule work in the host's check phase without keeping its loop alive. */
declare function nts_schedule_unreferenced_immediate(callback: () => void): void;

/** Report `resource` as collected, so a `destroy` hook can fire for it. */
declare function nts_on_collected(resource: object, onCollected: () => void): void;

/** Identity retained for a VM-owned resource such as a promise. */
interface ExternalAsyncIdentity {
  asyncId: number;
  triggerAsyncId: number;
}

/**
 * Metadata for objects this module does not own.
 *
 * Node writes private Symbol properties onto promises and native handles. NTS
 * objects have fixed fields and no dynamic property map, so the same lifetime
 * relationship is represented directly: a weak association from the host
 * object to a statically typed record. The association cannot keep a promise
 * alive, which is the property the original Symbol slots relied on.
 */
const externalAsyncIdentities = new WeakMap<object, ExternalAsyncIdentity>();

export interface HookCallbacks {
  init?: ((asyncId: number, type: string, triggerAsyncId: number, resource: object) => void) | undefined;
  before?: ((asyncId: number) => void) | undefined;
  after?: ((asyncId: number) => void) | undefined;
  destroy?: ((asyncId: number) => void) | undefined;
  promiseResolve?: ((asyncId: number) => void) | undefined;
  /** Whether this hook wants to hear about promises at all. */
  trackPromises?: boolean | undefined;
}

/** A registered hook, as the registry sees it. */
export interface RegisteredHook extends HookCallbacks {
  noPromiseHook?: boolean | undefined;
}

// -- identity ---------------------------------------------------------------

let asyncIdCounter = 0;
/** The id of the resource whose callback is currently running. 1 is the root. */
let currentExecutionAsyncId = 1;
/** The id of whatever caused it. */
let currentTriggerAsyncId = 0;
/**
 * An override for the next resource's trigger id.
 *
 * Needed because a resource is often constructed somewhere other than where it
 * was asked for: a `Socket` made inside the server's accept callback was
 * triggered by the *server*, not by the accept. -1 means "no override".
 */
let defaultTriggerAsyncId = -1;

export function newAsyncId(): number {
  return ++asyncIdCounter;
}

export function executionAsyncId(): number {
  return currentExecutionAsyncId;
}

export function triggerAsyncId(): number {
  return currentTriggerAsyncId;
}

export function getDefaultTriggerAsyncId(): number {
  return defaultTriggerAsyncId < 0 ? currentExecutionAsyncId : defaultTriggerAsyncId;
}

/** Give a VM-owned `object` an id, or return the one it already has. */
export function getOrSetAsyncId(object: object): number {
  const existing = externalAsyncIdentities.get(object);
  if (existing !== undefined) return existing.asyncId;

  const identity: ExternalAsyncIdentity = {
    asyncId: newAsyncId(),
    triggerAsyncId: getDefaultTriggerAsyncId(),
  };
  externalAsyncIdentities.set(object, identity);
  return identity.asyncId;
}

/**
 * Run `block` with the trigger id for anything it creates set to `id`.
 *
 * Restored in a `finally` because the override is process-wide: a throw that
 * left it set would attribute every later resource to a scope that has already
 * unwound.
 */
export function defaultTriggerAsyncIdScope<A extends unknown[], R>(
  id: number | undefined,
  block: (...args: A) => R,
  ...args: A
): R {
  if (id === undefined) return block(...args);
  const prior = defaultTriggerAsyncId;
  defaultTriggerAsyncId = id;
  try {
    return block(...args);
  } finally {
    defaultTriggerAsyncId = prior;
  }
}

// -- the execution stack ----------------------------------------------------

/**
 * The execution stack, kept in fixed-capacity storage.
 *
 * This is entered for every asynchronous callback. Parallel primitive arrays
 * avoid allocating a frame object on that hot path. Explicit capacity growth
 * keeps the common push and pop to indexed stores while making the uncommon
 * allocation point visible and shared across all three columns.
 */
let executionAsyncIds = new Float64Array(16);
let executionTriggerIds = new Float64Array(16);
let executionResources = new Array<object | undefined>(16);
let executionDepth = 0;

function growExecutionStack(): void {
  const capacity = executionAsyncIds.length * 2;
  const asyncIds = new Float64Array(capacity);
  const triggerIds = new Float64Array(capacity);
  const resources = new Array<object | undefined>(capacity);
  asyncIds.set(executionAsyncIds);
  triggerIds.set(executionTriggerIds);
  for (let i = 0; i < executionDepth; i++) resources[i] = executionResources[i];
  executionAsyncIds = asyncIds;
  executionTriggerIds = triggerIds;
  executionResources = resources;
}

/**
 * What `executionAsyncResource()` returns before anything asynchronous has
 * happened. A shared object rather than `undefined`, because callers index it.
 */
const topLevelResource: object = {};

export function hasAsyncIdStack(): boolean {
  return executionDepth > 0;
}

export function pushAsyncContext(asyncId: number, trigger: number, resource: object): void {
  if (executionDepth === executionAsyncIds.length) growExecutionStack();
  executionAsyncIds[executionDepth] = currentExecutionAsyncId;
  executionTriggerIds[executionDepth] = currentTriggerAsyncId;
  executionResources[executionDepth] = resource;
  executionDepth += 1;
  currentExecutionAsyncId = asyncId;
  currentTriggerAsyncId = trigger;
}

export function popAsyncContext(asyncId: number): boolean {
  if (executionDepth === 0) return false;
  // Node crashes the process when the id being popped is not the one on top,
  // because it means a `before` and an `after` have been paired wrongly and
  // every id from here on would be attributed to the wrong resource. Nothing
  // here can be that certain -- a hook enabled mid-callback legitimately sees
  // an `after` whose `before` it missed -- so the frame is left alone and the
  // caller is told nothing was popped.
  if (checkDepth > 0 && currentExecutionAsyncId !== asyncId) return false;
  const index = executionDepth - 1;
  const priorAsyncId = executionAsyncIds[index];
  const priorTriggerAsyncId = executionTriggerIds[index];
  if (priorAsyncId === undefined || priorTriggerAsyncId === undefined) return false;
  executionResources[index] = undefined;
  executionDepth = index;
  currentExecutionAsyncId = priorAsyncId;
  currentTriggerAsyncId = priorTriggerAsyncId;
  return executionDepth > 0;
}

/** The resource whose callback is running, or the top-level stand-in. */
export function executionAsyncResource(): object {
  if (executionDepth === 0) return topLevelResource;
  const resource = executionResources[executionDepth - 1];
  return resource === undefined ? topLevelResource : resource;
}

// -- the registry -----------------------------------------------------------

interface HookCounts {
  init: number;
  before: number;
  after: number;
  destroy: number;
  promiseResolve: number;
}

type HookEventKind = "before" | "after" | "destroy" | "promiseResolve";

const counts: HookCounts = {
  init: 0,
  before: 0,
  after: 0,
  destroy: 0,
  promiseResolve: 0,
};

let hooks = new Map<RegisteredHook, RegisteredHook>();

/**
 * How deep we are inside hook callbacks.
 *
 * A hook is allowed to enable or disable hooks, including itself, and the set
 * that a given emit walks must not change underneath it -- a hook removed
 * halfway through an emit would leave the ones after it unvisited for that
 * event only, which is a difference no program could account for. So changes
 * during an emit are staged and applied when the outermost one returns.
 */
let callDepth = 0;
let stagedHooks: Map<RegisteredHook, RegisteredHook> | null = null;
let stagedCounts: HookCounts | null = null;

/** Non-zero while any hook is enabled; gates the `popAsyncContext` check. */
let checkDepth = 0;

function hasHooks(kind: "init" | HookEventKind): boolean {
  switch (kind) {
    case "init":
      return counts.init > 0;
    case "before":
      return counts.before > 0;
    case "after":
      return counts.after > 0;
    case "destroy":
      return counts.destroy > 0;
    case "promiseResolve":
      return counts.promiseResolve > 0;
  }
}

export function initHooksExist(): boolean { return hasHooks("init"); }
export function afterHooksExist(): boolean { return hasHooks("after"); }
export function destroyHooksExist(): boolean { return hasHooks("destroy"); }
export function promiseResolveHooksExist(): boolean { return hasHooks("promiseResolve"); }
export function enabledHooksExist(): boolean { return hooks.size > 0; }

/** The registry a mutation should touch: the live one, or the staged copy. */
function mutableRegistry(): [Map<RegisteredHook, RegisteredHook>, HookCounts] {
  if (callDepth === 0) return [hooks, counts];
  if (stagedHooks === null) {
    stagedHooks = new Map(hooks);
    stagedCounts = {
      init: counts.init,
      before: counts.before,
      after: counts.after,
      destroy: counts.destroy,
      promiseResolve: counts.promiseResolve,
    };
  }
  const fields = stagedCounts;
  if (fields === null) return [hooks, counts];
  return [stagedHooks, fields];
}

function applyStagedRegistry(): void {
  if (callDepth !== 0 || stagedHooks === null) return;
  const fields = stagedCounts;
  if (fields === null) return;
  hooks = stagedHooks;
  counts.init = fields.init;
  counts.before = fields.before;
  counts.after = fields.after;
  counts.destroy = fields.destroy;
  counts.promiseResolve = fields.promiseResolve;
  stagedHooks = null;
  stagedCounts = null;
}

/** Register `hook`. Adding one twice is not an error and not a second entry. */
export function addHook(hook: RegisteredHook): boolean {
  const [registry, fields] = mutableRegistry();
  if (registry.has(hook)) return false;

  const before = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (hook.init) fields.init++;
  if (hook.before) fields.before++;
  if (hook.after) fields.after++;
  if (hook.destroy) fields.destroy++;
  if (hook.promiseResolve) fields.promiseResolve++;
  registry.set(hook, hook);

  const after = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (before === 0 && after > 0) checkDepth += 1;
  if (!hook.noPromiseHook) updatePromiseHookMode();
  return true;
}

export function removeHook(hook: RegisteredHook): boolean {
  const [registry, fields] = mutableRegistry();
  if (!registry.has(hook)) return false;

  const before = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (hook.init) fields.init--;
  if (hook.before) fields.before--;
  if (hook.after) fields.after--;
  if (hook.destroy) fields.destroy--;
  if (hook.promiseResolve) fields.promiseResolve--;
  registry.delete(hook);

  const after = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (before > 0 && after === 0) {
    checkDepth -= 1;
    wantPromiseHook = false;
    // Deferred, because we may be between a promise's `before` and its
    // `after`: tearing the hook down now would drop the `after` and leave the
    // execution stack with a frame nothing will ever pop.
    nts_enqueue_microtask(disablePromiseHookIfUnwanted);
  }
  return true;
}

/**
 * A hook threw.
 *
 * There is nowhere to put this error. It happened between a resource and the
 * code using it, so no `try` in the program encloses it, and swallowing it
 * would leave hooks in a state the program believes is working. Node prints
 * and exits, and so does this.
 */
function fatalError(error: unknown): void {
  let stack: string | undefined;
  if (
    typeof error === "object" &&
    error !== null &&
    "stack" in error &&
    typeof error.stack === "string"
  ) {
    stack = error.stack;
  }
  // Node wraps a non-Error throw in an Error-shaped diagnostic.  In
  // particular, hooks that throw `null` or a symbol print `Error: null` and
  // `Error: Symbol(...)`, rather than printing the bare value as an ordinary
  // uncaught throw would.
  const diagnostic = typeof stack === "string" ? stack : `Error: ${String(error)}`;
  nts_write_stderr(`${diagnostic}\n`);
  nts_process_really_exit(1);
}

/** Call one kind of hook on every registered hook that wants it. */
function hookEventCallback(
  hook: RegisteredHook,
  kind: HookEventKind,
): ((asyncId: number) => void) | undefined {
  switch (kind) {
    case "before":
      return hook.before;
    case "after":
      return hook.after;
    case "destroy":
      return hook.destroy;
    case "promiseResolve":
      return hook.promiseResolve;
  }
}

function emit(kind: HookEventKind, asyncId: number, fromPromise: boolean): void {
  callDepth += 1;
  try {
    for (const hook of hooks.values()) {
      const fn = hookEventCallback(hook, kind);
      if (typeof fn !== "function") continue;
      if (fromPromise && hook.noPromiseHook) continue;
      fn(asyncId);
    }
  } catch (error) {
    fatalError(error);
  } finally {
    callDepth -= 1;
  }
  applyStagedRegistry();
}

export function emitInit(
  asyncId: number,
  type: string,
  trigger: number | null,
  resource: object,
  fromPromise = false,
): void {
  if (!hasHooks("init")) return;
  const triggerId = trigger === null ? getDefaultTriggerAsyncId() : trigger;

  callDepth += 1;
  try {
    for (const hook of hooks.values()) {
      if (typeof hook.init !== "function") continue;
      if (fromPromise && hook.noPromiseHook) continue;
      hook.init(asyncId, type, triggerId, resource);
    }
  } catch (error) {
    fatalError(error);
  } finally {
    callDepth -= 1;
  }
  applyStagedRegistry();
}

/**
 * Enter a resource's scope.
 *
 * The push happens whether or not anyone is listening, because the ids have to
 * stay coherent for a hook enabled later; only the callback is conditional.
 */
export function emitBefore(
  asyncId: number,
  trigger: number,
  resource: object,
  fromPromise = false,
): void {
  pushAsyncContext(asyncId, trigger, resource);
  if (hasHooks("before")) emit("before", asyncId, fromPromise);
}

export function emitAfter(asyncId: number, fromPromise = false): void {
  if (hasHooks("after")) emit("after", asyncId, fromPromise);
  popAsyncContext(asyncId);
}

export function emitPromiseResolve(asyncId: number): void {
  if (!hasHooks("promiseResolve")) return;
  emit("promiseResolve", asyncId, true);
}

// -- destroy ----------------------------------------------------------------

/**
 * Ids waiting for their `destroy` hook.
 *
 * Batched rather than immediate because `emitDestroy` is called from places
 * that are finishing something -- often from inside a hook -- and running user
 * code there would let a `destroy` handler observe a half-torn-down resource.
 * Node drains them from its own phase; this drains them from a tick, which is
 * the same guarantee: after the current operation, before any I/O.
 */
let destroyQueue = new Float64Array(16);
let destroyQueueLength = 0;
let destroyScheduled = false;
const destroyMicrotaskThreshold = 16_384;

function growDestroyQueue(): void {
  const next = new Float64Array(destroyQueue.length * 2);
  next.set(destroyQueue);
  destroyQueue = next;
}

export function emitDestroy(asyncId: number): void {
  if (!hasHooks("destroy") || !(asyncId > 0)) return;
  if (!destroyScheduled) {
    destroyScheduled = true;
    nts_schedule_unreferenced_immediate(drainDestroyQueue);
  }
  // Node asks the VM for an interrupt at this threshold so a producer cannot
  // grow the queue without bound before the check phase. We are already on
  // the owner thread, so directly enqueueing the resulting microtask has the
  // same ordering and avoids an interrupt round trip.
  if (destroyQueueLength === destroyMicrotaskThreshold) {
    nts_enqueue_microtask(drainDestroyQueue);
  }
  if (destroyQueueLength === destroyQueue.length) growDestroyQueue();
  destroyQueue[destroyQueueLength] = asyncId;
  destroyQueueLength += 1;
}

function drainDestroyQueue(): void {
  destroyScheduled = false;
  // Length read each time round rather than cached: a `destroy` hook that
  // destroys something else adds to this queue, and node runs those in the
  // same drain rather than deferring them to another tick.
  for (let i = 0; i < destroyQueueLength; i++) {
    const asyncId = destroyQueue[i];
    if (asyncId !== undefined) emit("destroy", asyncId, false);
  }
  destroyQueueLength = 0;
}

/**
 * Emit `destroy` for `asyncId` when `resource` is collected.
 *
 * The escape hatch for resources nobody closes explicitly. A promise is the
 * clearest case: there is no `promise.close()`, so the only moment anyone can
 * say it is finished with is when it becomes unreachable.
 *
 * `state` is shared with the caller so that an explicit `emitDestroy()` can
 * mark it and stop this from firing a second one.
 */
export function registerDestroyHook(
  resource: object,
  asyncId: number,
  state?: { destroyed: boolean },
): void {
  nts_on_collected(resource, () => {
    if (state?.destroyed) return;
    emitDestroy(asyncId);
  });
}

// -- promises ---------------------------------------------------------------

let wantPromiseHook = false;
let promiseHookInstalled = false;

/** Give a promise its ids, if it has not been seen before. */
function trackPromise(promise: object, parent?: object): ExternalAsyncIdentity {
  const existing = externalAsyncIdentities.get(promise);
  if (existing !== undefined) return existing;
  // The parent's id is taken first so that, if it too is new, it gets the
  // lower number. A child that appeared to predate its parent would make any
  // ordering a hook derives from the ids wrong.
  const trigger = parent !== undefined
    ? getOrSetAsyncId(parent)
    : getDefaultTriggerAsyncId();
  const identity: ExternalAsyncIdentity = {
    asyncId: newAsyncId(),
    triggerAsyncId: trigger,
  };
  externalAsyncIdentities.set(promise, identity);
  return identity;
}

function promiseInit(promise: object, parent: object | undefined): void {
  const identity = trackPromise(promise, parent);
  emitInit(
    identity.asyncId,
    "PROMISE",
    identity.triggerAsyncId,
    promise,
    true,
  );
  if (destroyHooksExist()) {
    registerDestroyHook(promise, identity.asyncId);
  }
}

function promiseDestroyTracking(promise: object, parent: object | undefined): void {
  const identity = trackPromise(promise, parent);
  registerDestroyHook(promise, identity.asyncId);
}

function promiseBefore(promise: object): void {
  const identity = trackPromise(promise);
  emitBefore(identity.asyncId, identity.triggerAsyncId, promise, true);
}

function promiseAfter(promise: object): void {
  const asyncId = trackPromise(promise).asyncId;
  if (hasHooks("after")) emit("after", asyncId, true);
  // Only pop what we pushed. Hooks enabled *during* a promise's callback see
  // this `after` without having seen the matching `before`, and popping then
  // would take a frame belonging to something else.
  if (asyncId === currentExecutionAsyncId) popAsyncContext(asyncId);
}

function promiseSettled(promise: object): void {
  emitPromiseResolve(trackPromise(promise).asyncId);
}

/**
 * Install exactly the promise callbacks the registered hooks need.
 *
 * Re-decided on every registry change rather than installed once, because the
 * engine reports only what it is asked for and promises are the most numerous
 * resource in a running program by a wide margin: asking for `init` when no
 * hook has one would put a callback on every `async` call in the process.
 */
function updatePromiseHookMode(): void {
  wantPromiseHook = true;
  let init: ((promise: object, parent: object | undefined) => void) | null = null;
  if (initHooksExist()) init = promiseInit;
  else if (destroyHooksExist()) init = promiseDestroyTracking;

  nts_promise_hook_install(
    init,
    promiseBefore,
    promiseAfter,
    promiseResolveHooksExist() ? promiseSettled : null,
  );
  promiseHookInstalled = true;
}

function disablePromiseHookIfUnwanted(): void {
  if (wantPromiseHook || !promiseHookInstalled) return;
  nts_promise_hook_uninstall();
  promiseHookInstalled = false;
}

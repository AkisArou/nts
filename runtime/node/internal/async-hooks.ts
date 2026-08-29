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
declare function nts_write_stderr(text: string): void;

/** Stop the process. A hook that throws is not a recoverable condition. */
declare function nts_process_really_exit(code: number): void;

/**
 * Queue `callback` to run once the current stack unwinds.
 *
 * The binding directly rather than `internal/tick.ts`, for two reasons. The
 * layering one is that `nextTick` reports itself to the hooks here, so
 * depending on it would be circular. The semantic one is the same fact from
 * the other side: the destroy queue must not be an observable tick, or every
 * batch of `destroy` callbacks would announce itself as one more resource and
 * schedule another batch.
 */
declare function nts_next_tick(callback: (...args: never) => void, args: unknown[]): void;

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

/** Report `resource` as collected, so a `destroy` hook can fire for it. */
declare function nts_on_collected(resource: object, onCollected: () => void): void;

// The ids a resource carries. Symbols rather than fields because they go onto
// objects this module does not own -- promises, most of all.
export const kAsyncId = Symbol("asyncId");
export const kTriggerAsyncId = Symbol("triggerAsyncId");
/**
 * The asynchronous context a resource was created in.
 *
 * Beside the ids because it is captured at the same moment and for the same
 * reason: what a resource must remember about where it came from.
 */
export const kContextFrame = Symbol("contextFrame");
/**
 * The public face of an internal resource.
 *
 * A hook should be handed the `Socket`, not the handle inside it. Node calls
 * this `owner_symbol` and uses it for the same reason.
 */
export const kResourceOwner = Symbol("owner");

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

/** Give `object` an id, or return the one it already has. */
export function getOrSetAsyncId(object: Record<symbol, unknown>): number {
  if (Object.prototype.hasOwnProperty.call(object, kAsyncId)) {
    return object[kAsyncId] as number;
  }
  const id = newAsyncId();
  object[kAsyncId] = id;
  return id;
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

/** The ids to restore when the current callback returns, innermost last. */
const executionStack: { asyncId: number; triggerAsyncId: number }[] = [];
/** The resource for each frame, so `executionAsyncResource()` can answer. */
const executionResources: object[] = [];

/**
 * What `executionAsyncResource()` returns before anything asynchronous has
 * happened. A shared object rather than `undefined`, because callers index it.
 */
const topLevelResource: object = {};

export function hasAsyncIdStack(): boolean {
  return executionStack.length > 0;
}

export function pushAsyncContext(asyncId: number, trigger: number, resource: object): void {
  executionStack.push({ asyncId: currentExecutionAsyncId, triggerAsyncId: currentTriggerAsyncId });
  executionResources.push(resource);
  currentExecutionAsyncId = asyncId;
  currentTriggerAsyncId = trigger;
}

export function popAsyncContext(asyncId: number): boolean {
  if (executionStack.length === 0) return false;
  // Node crashes the process when the id being popped is not the one on top,
  // because it means a `before` and an `after` have been paired wrongly and
  // every id from here on would be attributed to the wrong resource. Nothing
  // here can be that certain -- a hook enabled mid-callback legitimately sees
  // an `after` whose `before` it missed -- so the frame is left alone and the
  // caller is told nothing was popped.
  if (checkDepth > 0 && currentExecutionAsyncId !== asyncId) return false;
  const frame = executionStack.pop() as { asyncId: number; triggerAsyncId: number };
  executionResources.pop();
  currentExecutionAsyncId = frame.asyncId;
  currentTriggerAsyncId = frame.triggerAsyncId;
  return executionStack.length > 0;
}

/** The resource whose callback is running, or the top-level stand-in. */
export function executionAsyncResource(): object {
  const index = executionResources.length - 1;
  if (index === -1) return topLevelResource;
  return publicResource(executionResources[index] as object);
}

/** An internal handle's public wrapper, if it has one. */
function publicResource(resource: object): object {
  if (typeof resource !== "object" || resource === null) return resource;
  const owner = (resource as Record<symbol, unknown>)[kResourceOwner];
  return owner === undefined ? resource : (owner as object);
}

// -- the registry -----------------------------------------------------------

const counts = { init: 0, before: 0, after: 0, destroy: 0, promiseResolve: 0 };
type CountKey = keyof typeof counts;

let hooks: RegisteredHook[] = [];

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
let stagedHooks: RegisteredHook[] | null = null;
let stagedCounts: typeof counts | null = null;

/** Non-zero while any hook is enabled; gates the `popAsyncContext` check. */
let checkDepth = 0;

function totalCount(): number {
  return counts.init + counts.before + counts.after + counts.destroy + counts.promiseResolve;
}

function hasHooks(key: CountKey): boolean {
  return counts[key] > 0;
}

export function initHooksExist(): boolean { return hasHooks("init"); }
export function afterHooksExist(): boolean { return hasHooks("after"); }
export function destroyHooksExist(): boolean { return hasHooks("destroy"); }
export function promiseResolveHooksExist(): boolean { return hasHooks("promiseResolve"); }
export function enabledHooksExist(): boolean { return hooks.length > 0; }

/** The arrays a mutation should touch: the live ones, or the staged copies. */
function mutableRegistry(): [RegisteredHook[], typeof counts] {
  if (callDepth === 0) return [hooks, counts];
  if (stagedHooks === null) {
    stagedHooks = hooks.slice();
    stagedCounts = { ...counts };
  }
  return [stagedHooks, stagedCounts as typeof counts];
}

function applyStagedRegistry(): void {
  if (callDepth !== 0 || stagedHooks === null) return;
  hooks = stagedHooks;
  Object.assign(counts, stagedCounts);
  stagedHooks = null;
  stagedCounts = null;
}

/** Register `hook`. Adding one twice is not an error and not a second entry. */
export function addHook(hook: RegisteredHook): boolean {
  const [array, fields] = mutableRegistry();
  if (array.includes(hook)) return false;

  const before = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (hook.init) fields.init++;
  if (hook.before) fields.before++;
  if (hook.after) fields.after++;
  if (hook.destroy) fields.destroy++;
  if (hook.promiseResolve) fields.promiseResolve++;
  array.push(hook);

  const after = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (before === 0 && after > 0) checkDepth += 1;
  if (!hook.noPromiseHook) updatePromiseHookMode();
  return true;
}

export function removeHook(hook: RegisteredHook): boolean {
  const [array, fields] = mutableRegistry();
  const index = array.indexOf(hook);
  if (index === -1) return false;

  const before = fields.init + fields.before + fields.after + fields.destroy + fields.promiseResolve;
  if (hook.init) fields.init--;
  if (hook.before) fields.before--;
  if (hook.after) fields.after--;
  if (hook.destroy) fields.destroy--;
  if (hook.promiseResolve) fields.promiseResolve--;
  array.splice(index, 1);

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
  const stack = (error as { stack?: unknown } | null | undefined)?.stack;
  nts_write_stderr(`${typeof stack === "string" ? stack : String(error)}\n`);
  nts_process_really_exit(1);
}

/** Call one kind of hook on every registered hook that wants it. */
function emit(kind: Exclude<CountKey, "init">, asyncId: number, fromPromise: boolean): void {
  callDepth += 1;
  try {
    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i] as RegisteredHook;
      const fn = hook[kind];
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
  const shown = publicResource(resource);
  try {
    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i] as RegisteredHook;
      if (typeof hook.init !== "function") continue;
      if (fromPromise && hook.noPromiseHook) continue;
      hook.init(asyncId, type, triggerId, shown);
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
const destroyQueue: number[] = [];
let destroyScheduled = false;

export function emitDestroy(asyncId: number): void {
  if (!hasHooks("destroy") || !(asyncId > 0)) return;
  destroyQueue.push(asyncId);
  if (destroyScheduled) return;
  destroyScheduled = true;
  nts_next_tick(drainDestroyQueue as (...a: never) => void, []);
}

function drainDestroyQueue(): void {
  destroyScheduled = false;
  // Length read each time round rather than cached: a `destroy` hook that
  // destroys something else adds to this queue, and node runs those in the
  // same drain rather than deferring them to another tick.
  for (let i = 0; i < destroyQueue.length; i++) {
    emit("destroy", destroyQueue[i] as number, false);
  }
  destroyQueue.length = 0;
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
function trackPromise(promise: object, parent?: object): void {
  const carrier = promise as Record<symbol, unknown>;
  if (carrier[kAsyncId]) return;
  // The parent's id is taken first so that, if it too is new, it gets the
  // lower number. A child that appeared to predate its parent would make any
  // ordering a hook derives from the ids wrong.
  const trigger = parent
    ? getOrSetAsyncId(parent as Record<symbol, unknown>)
    : getDefaultTriggerAsyncId();
  carrier[kAsyncId] = newAsyncId();
  carrier[kTriggerAsyncId] = trigger;
}

function promiseInit(promise: object, parent: object | undefined): void {
  trackPromise(promise, parent);
  const carrier = promise as Record<symbol, unknown>;
  emitInit(
    carrier[kAsyncId] as number,
    "PROMISE",
    carrier[kTriggerAsyncId] as number,
    promise,
    true,
  );
  if (destroyHooksExist()) {
    registerDestroyHook(promise, carrier[kAsyncId] as number);
  }
}

function promiseDestroyTracking(promise: object, parent: object | undefined): void {
  trackPromise(promise, parent);
  registerDestroyHook(promise, (promise as Record<symbol, unknown>)[kAsyncId] as number);
}

function promiseBefore(promise: object): void {
  trackPromise(promise);
  const carrier = promise as Record<symbol, unknown>;
  emitBefore(carrier[kAsyncId] as number, carrier[kTriggerAsyncId] as number, promise, true);
}

function promiseAfter(promise: object): void {
  trackPromise(promise);
  const asyncId = (promise as Record<symbol, unknown>)[kAsyncId] as number;
  if (hasHooks("after")) emit("after", asyncId, true);
  // Only pop what we pushed. Hooks enabled *during* a promise's callback see
  // this `after` without having seen the matching `before`, and popping then
  // would take a frame belonging to something else.
  if (asyncId === currentExecutionAsyncId) popAsyncContext(asyncId);
}

function promiseSettled(promise: object): void {
  trackPromise(promise);
  emitPromiseResolve((promise as Record<symbol, unknown>)[kAsyncId] as number);
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

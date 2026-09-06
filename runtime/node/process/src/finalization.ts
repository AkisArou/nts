// `process.finalization`, from node v24.20.0
// `lib/internal/process/finalization.js`.
//
// A finalization registration must not keep its resource alive. The callback
// and event are retained strongly, while the resource itself is held only by a
// `WeakRef`; the `FinalizationRegistry` removes that record if the resource is
// collected before process shutdown.

import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";

export type ProcessFinalizationEvent = "beforeExit" | "exit";

export type ProcessFinalizationCallback<
  T extends object,
  Event extends ProcessFinalizationEvent,
> = (
  resource: T,
  event: Event,
) => void;

export interface ProcessFinalization {
  register<T extends object>(
    resource: T,
    callback: ProcessFinalizationCallback<T, "exit">,
  ): void;
  registerBeforeExit<T extends object>(
    resource: T,
    callback: ProcessFinalizationCallback<T, "beforeExit">,
  ): void;
  unregister(resource: object): void;
}

interface FinalizationTarget {
  on(event: ProcessFinalizationEvent, listener: () => void): unknown;
  removeListener(event: ProcessFinalizationEvent, listener: () => void): unknown;
  emitWarning(message: string, type: string): void;
}

/** A type-erased registration whose resource remains weak. */
interface FinalizationReference {
  deref(): object | undefined;
  invoke(): void;
}

/**
 * Keep the resource and its matching callback statically related without
 * widening the callback parameter to `object`.
 */
class RegisteredFinalizer<
  T extends object,
  Event extends ProcessFinalizationEvent,
> implements FinalizationReference {
  readonly #resource: WeakRef<T>;
  readonly #event: Event;
  readonly #callback: ProcessFinalizationCallback<T, Event>;

  constructor(
    resource: T,
    event: Event,
    callback: ProcessFinalizationCallback<T, Event>,
  ) {
    this.#resource = new WeakRef(resource);
    this.#event = event;
    this.#callback = callback;
  }

  deref(): object | undefined {
    return this.#resource.deref();
  }

  invoke(): void {
    const resource = this.#resource.deref();
    if (resource !== undefined) this.#callback(resource, this.#event);
  }
}

/** Node accepts ordinary objects and functions here, but not arrays. */
function validateFinalizationResource(resource: object): void {
  const kind = typeof resource;
  if (
    resource === null ||
    Array.isArray(resource) ||
    (kind !== "object" && kind !== "function")
  ) {
    throw new ERR_INVALID_ARG_TYPE("obj", "Object", resource);
  }
}

/** Build the registry bound to the one process object that owns its events. */
export function createProcessFinalization(target: FinalizationTarget): ProcessFinalization {
  const exitReferences = new Set<FinalizationReference>();
  const beforeExitReferences = new Set<FinalizationReference>();
  const warnedFeatures = new Set<string>();
  let registry: FinalizationRegistry<FinalizationReference> | undefined;

  function referencesFor(event: ProcessFinalizationEvent): Set<FinalizationReference> {
    return event === "exit" ? exitReferences : beforeExitReferences;
  }

  function onExit(): void {
    invokeReferences("exit");
  }

  function onBeforeExit(): void {
    invokeReferences("beforeExit");
  }

  function listenerFor(event: ProcessFinalizationEvent): () => void {
    return event === "exit" ? onExit : onBeforeExit;
  }

  function install(event: ProcessFinalizationEvent): void {
    if (referencesFor(event).size === 0) target.on(event, listenerFor(event));
  }

  function uninstall(event: ProcessFinalizationEvent): void {
    if (referencesFor(event).size !== 0) return;
    target.removeListener(event, listenerFor(event));
    if (exitReferences.size === 0 && beforeExitReferences.size === 0) {
      registry = undefined;
    }
  }

  function invokeReferences(event: ProcessFinalizationEvent): void {
    const references = referencesFor(event);
    for (const reference of references) reference.invoke();
    references.clear();
  }

  function clear(reference: FinalizationReference): void {
    if (exitReferences.delete(reference)) uninstall("exit");
    if (beforeExitReferences.delete(reference)) uninstall("beforeExit");
  }

  function emitExperimentalWarning(feature: string): void {
    if (warnedFeatures.has(feature)) return;
    warnedFeatures.add(feature);
    target.emitWarning(
      `${feature} is an experimental feature and might change at any time`,
      "ExperimentalWarning",
    );
  }

  function add<T extends object, Event extends ProcessFinalizationEvent>(
    event: Event,
    resource: T,
    callback: ProcessFinalizationCallback<T, Event>,
  ): void {
    install(event);
    const reference: FinalizationReference = new RegisteredFinalizer(resource, event, callback);
    registry ??= new FinalizationRegistry(clear);
    // The resource is also the unregister token. Tokens are held weakly by a
    // FinalizationRegistry, so this does not defeat the WeakRef above.
    registry.register(resource, reference, resource);
    referencesFor(event).add(reference);
  }

  function register<T extends object>(
    resource: T,
    callback: ProcessFinalizationCallback<T, "exit">,
  ): void {
    emitExperimentalWarning("process.finalization.register");
    validateFinalizationResource(resource);
    add("exit", resource, callback);
  }

  function registerBeforeExit<T extends object>(
    resource: T,
    callback: ProcessFinalizationCallback<T, "beforeExit">,
  ): void {
    emitExperimentalWarning("process.finalization.registerBeforeExit");
    validateFinalizationResource(resource);
    add("beforeExit", resource, callback);
  }

  function unregister(resource: object): void {
    emitExperimentalWarning("process.finalization.unregister");
    if (registry === undefined) return;

    registry.unregister(resource);
    removeReferences("exit", resource);
    removeReferences("beforeExit", resource);
  }

  function removeReferences(event: ProcessFinalizationEvent, resource: object): void {
    const references = referencesFor(event);
    for (const reference of references) {
      const current = reference.deref();
      if (current === undefined || current === resource) references.delete(reference);
    }
    uninstall(event);
  }

  return { register, registerBeforeExit, unregister };
}

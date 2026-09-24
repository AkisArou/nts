// The host operations both noop entries share: instances are plain objects
// in memory, so tests can inspect what React committed.
//
// Upstream builds this config inside `createReactNoop` as closures over the
// renderer's state. Here the state lives at module level: each entry
// (`react-noop-renderer`, `react-noop-renderer/persistent`) bundles its own
// copy of this module together with its own reconciler, so the two never
// share state. ReactFiberConfigNoopMutation.ts and
// ReactFiberConfigNoopPersistent.ts add the mode-specific operations; one of
// them replaces react-reconciler's ReactFiberConfig.ts in each bundle.

import { isDevelopment } from "shared/Build.ts";
import { checkPropStringCoercion } from "shared/CheckStringCoercion.ts";
import { DefaultEventPriority, NoEventPriority, type EventPriority } from "react-reconciler/ReactEventPriorities.ts";
import * as Scheduler from "scheduler/unstable_mock";

export * from "./ReactFiberConfigNoopHydration.ts";
export * from "./ReactFiberConfigNoopScopes.ts";
export * from "./ReactFiberConfigNoopTestSelectors.ts";
export * from "./ReactFiberConfigNoopResources.ts";
export * from "./ReactFiberConfigNoopSingletons.ts";

export type HostContext = object;

export interface TextInstance {
  text: string;
  id: number;
  parent: number;
  hidden: boolean;
  context: HostContext;
}

export interface Instance {
  type: string;
  id: number;
  parent: number;
  children: (Instance | TextInstance)[];
  text: string | null;
  prop: unknown;
  hidden: boolean;
  context: HostContext;
  // Only `suspensey-thing` instances.
  src?: string;
  // The fiber, hidden from tests (see createInstance).
  fiber?: unknown;
}

export type PublicInstance = Instance;

export interface Container {
  rootID: string;
  children: (Instance | TextInstance)[];
  pendingChildren: (Instance | TextInstance)[];
}

// The props the noop host components understand. Anything else is ignored.
export type Props = {
  [key: string]: unknown;
  prop?: unknown;
  hidden?: unknown;
  children?: unknown;
  src?: unknown;
  onLoadStart?: unknown;
};

export type TransitionStatus = unknown;
export type FormInstance = Instance;
export type ChildSet = (Instance | TextInstance)[];
export type TimeoutHandle = ReturnType<typeof setTimeout>;
export type NoTimeout = -1;

// A commit waiting for "suspensey things" (stand-ins for images and
// stylesheets) to load: reference counted over the things it waits for.
interface SuspenseyCommitSubscription {
  pendingCount: number;
  commit: (() => void) | null;
}

export type SuspendedState = SuspenseyCommitSubscription;

interface SuspenseyThingRecord {
  status: "pending" | "fulfilled";
  subscriptions: SuspenseyCommitSubscription[] | null;
}

const NO_CONTEXT: HostContext = {};
const UPPERCASE_CONTEXT: HostContext = {};
if (isDevelopment) {
  Object.freeze(NO_CONTEXT);
}

// Renderer state.
let instanceCounter = 0;
let hostUpdateCounter = 0;
let hostCloneCounter = 0;
let suspenseyThingCache: Map<string, SuspenseyThingRecord> | null = null;
let currentUpdatePriority: EventPriority = NoEventPriority;
let currentEventPriority: EventPriority = DefaultEventPriority;

export function countHostUpdate(): void {
  hostUpdateCounter++;
}

export function countHostClone(): void {
  hostCloneCounter++;
}

export function resetHostCounters(): void {
  hostUpdateCounter = 0;
  hostCloneCounter = 0;
}

export function getHostCounters(): { hostUpdateCounter: number; hostCloneCounter: number } {
  return { hostUpdateCounter, hostCloneCounter };
}

export function getCurrentEventPriority(): EventPriority {
  return currentEventPriority;
}

export function setCurrentEventPriority(priority: EventPriority): void {
  currentEventPriority = priority;
}

export const rendererVersion = "19.3.0";
export const rendererPackageName = "react-noop";
export const extraDevToolsConfig = null;

export function getRootHostContext(): HostContext {
  return NO_CONTEXT;
}

export function getChildHostContext(parentHostContext: HostContext, type: string): HostContext {
  if (type === "offscreen") {
    return parentHostContext;
  }
  if (type === "uppercase") {
    return UPPERCASE_CONTEXT;
  }
  return NO_CONTEXT;
}

export function getPublicInstance(instance: Instance): PublicInstance {
  return instance;
}

export const HostTransitionContext = null;

export function shouldSetTextContent(type: string, props: Props): boolean {
  if (type === "errorInBeginPhase") {
    throw new Error("Error in host config.");
  }
  return typeof props.children === "string" || typeof props.children === "number" || typeof props.children === "bigint";
}

export function computeText(rawText: string, hostContext: HostContext): string {
  return hostContext === UPPERCASE_CONTEXT ? rawText.toUpperCase() : rawText;
}

// Hides bookkeeping fields from tests: they compare instances with `toEqual`,
// which only looks at enumerable properties.
// JS object model: non-enumerable properties are how upstream hides them.
export function hideFields(object: object, names: readonly string[]): void {
  for (const name of names) {
    Object.defineProperty(object, name, {
      value: (object as { [field: string]: unknown })[name],
      enumerable: false,
    });
  }
}

export function createInstance(
  type: string,
  props: Props,
  _rootContainerInstance: Container,
  hostContext: HostContext,
  internalInstanceHandle: object,
): Instance {
  if (type === "errorInCompletePhase") {
    throw new Error("Error in host config.");
  }
  if (isDevelopment && shouldSetTextContent(type, props)) {
    checkPropStringCoercion(props.children, "children");
  }
  const inst: Instance = {
    id: instanceCounter++,
    type,
    children: [],
    parent: -1,
    text: shouldSetTextContent(type, props) ? computeText((props.children as string) + "", hostContext) : null,
    prop: props.prop,
    hidden: !!props.hidden,
    context: hostContext,
  };
  if (type === "suspensey-thing" && typeof props.src === "string") {
    inst.src = props.src;
  }
  hideFields(inst, ["id", "parent", "text", "context"]);
  Object.defineProperty(inst, "fiber", { value: internalInstanceHandle, enumerable: false });
  return inst;
}

export function appendInitialChild(parentInstance: Instance, child: Instance | TextInstance): void {
  const prevParent = child.parent;
  if (prevParent !== -1 && prevParent !== parentInstance.id) {
    throw new Error("Reparenting is not allowed");
  }
  child.parent = parentInstance.id;
  parentInstance.children.push(child);
}

export function finalizeInitialChildren(): boolean {
  return false;
}

export function createTextInstance(
  text: string,
  _rootContainerInstance: Container,
  hostContext: HostContext,
): TextInstance {
  const inst: TextInstance = {
    text: hostContext === UPPERCASE_CONTEXT ? text.toUpperCase() : text,
    id: instanceCounter++,
    parent: -1,
    hidden: false,
    context: hostContext,
  };
  hideFields(inst, ["id", "parent", "context"]);
  return inst;
}

export function createFragmentInstance(): null {
  return null;
}

export function updateFragmentInstanceFiber(): void {}

export function commitNewChildToFragmentInstance(): void {}

export function deleteChildFromFragmentInstance(): void {}

export const scheduleTimeout = setTimeout;
export const cancelTimeout = clearTimeout;
export const noTimeout: NoTimeout = -1;

export const supportsMicrotasks = true;
export const scheduleMicrotask: (callback: () => void) => void =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : typeof Promise !== "undefined"
      ? (callback) => {
          Promise.resolve(null)
            .then(callback)
            .catch((error: unknown) => {
              setTimeout(() => {
                throw error;
              });
            });
        }
      : (callback) => {
          setTimeout(callback);
        };

export function prepareForCommit(): object | null {
  return null;
}

export function resetAfterCommit(): void {}

export function setCurrentUpdatePriority(newPriority: EventPriority): void {
  currentUpdatePriority = newPriority;
}

export function getCurrentUpdatePriority(): EventPriority {
  return currentUpdatePriority;
}

export function resolveUpdatePriority(): EventPriority {
  if (currentUpdatePriority !== NoEventPriority) {
    return currentUpdatePriority;
  }
  return currentEventPriority;
}

export function trackSchedulerEvent(): void {}

export function resolveEventType(): string | null {
  return null;
}

export function resolveEventTimeStamp(): number {
  return -1.1;
}

export function shouldAttemptEagerTransition(): boolean {
  return false;
}

export const isPrimaryRenderer = true;
export const warnsIfNotActing = true;

export function getInstanceFromNode(): never {
  throw new Error("Not yet implemented.");
}

export function beforeActiveInstanceBlur(): void {}

export function afterActiveInstanceBlur(): void {}

export function preparePortalMount(): void {}

export function detachDeletedInstance(): void {}

export function requestPostPaintCallback(callback: (time: number) => void): void {
  const endTime = Scheduler.unstable_now();
  callback(endTime);
}

// Whether this combination of type and props could ever need to suspend,
// which differs from whether it is ready now: a loaded thing can be purged
// from the cache later.
export function maySuspendCommit(type: string, props: Props): boolean {
  return type === "suspensey-thing" && typeof props.src === "string";
}

export function maySuspendCommitOnUpdate(type: string, oldProps: Props, newProps: Props): boolean {
  return type === "suspensey-thing" && typeof newProps.src === "string" && newProps.src !== oldProps.src;
}

export function maySuspendCommitInSyncRender(): boolean {
  return true;
}

// Preloads a suspensey thing and says whether it is ready to commit. If it
// is not, React may yield and ask again; a load in between avoids a fallback.
export function preloadInstance(_instance: Instance, type: string, props: Props): boolean {
  if (type !== "suspensey-thing" || typeof props.src !== "string") {
    throw new Error("Attempted to preload unexpected instance: " + type);
  }
  const src = props.src;
  if (suspenseyThingCache === null) {
    suspenseyThingCache = new Map();
  }
  const record = suspenseyThingCache.get(src);
  if (record === undefined) {
    suspenseyThingCache.set(src, { status: "pending", subscriptions: null });
    const onLoadStart = props.onLoadStart;
    if (typeof onLoadStart === "function") {
      (onLoadStart as () => void)();
    }
    return false;
  }
  return record.status === "fulfilled";
}

// A subscription for every suspensey thing that blocks one commit. Once they
// have all loaded, the commit can proceed.
export function startSuspendingCommit(): SuspendedState {
  return { pendingCount: 0, commit: null };
}

export function suspendInstance(state: SuspendedState, _instance: Instance, type: string, props: Props): void {
  const src = props.src;
  if (type === "suspensey-thing" && typeof src === "string") {
    const record = suspenseyThingCache!.get(src);
    if (record === undefined) {
      throw new Error("Could not find record for key.");
    }
    if (record.status === "pending") {
      state.pendingCount++;
      // resolveSuspenseyThing fires the commit once all the things loaded.
      if (record.subscriptions === null) {
        record.subscriptions = [];
      }
      record.subscriptions.push(state);
    }
  } else {
    throw new Error(
      "Did not expect this host component to be visited when suspending " +
        "the commit. Did you check the SuspendCommit flag?",
    );
  }
}

export function suspendOnActiveViewTransition(): void {
  // Not implemented.
}

export function waitForCommitToBeReady(
  state: SuspendedState,
  _timeoutOffset: number,
): ((commit: () => void) => () => void) | null {
  if (state.pendingCount > 0) {
    return (commit: () => void) => {
      state.commit = commit;
      return () => {
        state.commit = null;
      };
    };
  }
  return null;
}

export function getSuspendedCommitReason(): string | null {
  return null;
}

export const NotPendingTransition: TransitionStatus = null;

export function resetFormInstance(): void {}

export function bindToConsole(methodName: string, args: unknown[], _badgeName: string): () => unknown {
  const method = (console as unknown as { [name: string]: (...values: unknown[]) => unknown })[methodName]!;
  return method.bind(console, ...args);
}

// The suspensey-thing cache, driven by tests.

export function getSuspenseyThingStatus(src: string): string | null {
  if (suspenseyThingCache === null) {
    return null;
  }
  const record = suspenseyThingCache.get(src);
  return record === undefined ? null : record.status;
}

export function resolveSuspenseyThing(key: string): void {
  if (suspenseyThingCache === null) {
    suspenseyThingCache = new Map();
  }
  const record = suspenseyThingCache.get(key);
  if (record === undefined) {
    suspenseyThingCache.set(key, { status: "fulfilled", subscriptions: null });
    return;
  }
  if (record.status !== "pending") {
    return;
  }
  record.status = "fulfilled";
  const subscriptions = record.subscriptions;
  if (subscriptions === null) {
    return;
  }
  record.subscriptions = null;
  for (const subscription of subscriptions) {
    subscription.pendingCount--;
    if (subscription.pendingCount === 0) {
      const commit = subscription.commit;
      subscription.commit = null;
      if (commit === null) {
        throw new Error("Expected commit to be a function. This is a bug in React.");
      }
      commit();
    }
  }
}

export function resetSuspenseyThingCache(): void {
  suspenseyThingCache = null;
}

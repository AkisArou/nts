// A renderer of React with no render target: host instances are plain
// objects, so tests can observe what the reconciler committed, in isolation
// from any real host environment.
//
// This is the public API both entries share. The host operations live in
// ReactFiberConfigNoop*.ts, which the build forks in for the reconciler's
// ReactFiberConfig.ts; the renderer's state lives there too.

import { isDevelopment } from "shared/Build.ts";
import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from "shared/ReactSymbols.ts";
import { disableLegacyMode } from "shared/ReactFeatureFlags.ts";
import * as Scheduler from "scheduler/unstable_mock";
import {
  DiscreteEventPriority,
  IdleEventPriority,
  type EventPriority,
} from "react-reconciler/ReactEventPriorities.ts";
import * as NoopRenderer from "react-reconciler/ReactFiberReconciler.ts";
import type { ErrorInfo, Fiber, FiberRoot } from "react-reconciler/ReactInternalTypes.ts";
import { ConcurrentRoot, type RootTag } from "react-reconciler/ReactRootTags.ts";
import { ReactSharedInternals } from "react-reconciler/ReactSharedInternals.ts";
import {
  getCurrentEventPriority,
  getCurrentUpdatePriority,
  getHostCounters,
  getSuspenseyThingStatus,
  resetHostCounters,
  resetSuspenseyThingCache,
  resolveSuspenseyThing,
  setCurrentEventPriority,
  setCurrentUpdatePriority,
  type Container,
  type Instance,
  type TextInstance,
} from "./ReactFiberConfigNoop.ts";

export interface CreateRootOptions {
  unstable_transitionCallbacks?: unknown;
  onUncaughtError?: (error: unknown, errorInfo: ErrorInfo) => void;
  onCaughtError?: (error: unknown, errorInfo: ErrorInfo) => void;
  onDefaultTransitionIndicator?: () => void | (() => void);
}

export interface NoopRoot {
  _Scheduler: typeof Scheduler;
  render(children: unknown): void;
  getChildren(): (Instance | TextInstance)[] | null;
  getChildrenAsJSX(): unknown;
}

// An element built the way JSX builds one, for comparing the committed tree
// with expected JSX in tests.
function createJSXElementForTestComparison(type: unknown, props: object): object {
  if (isDevelopment) {
    const element = {
      type,
      $$typeof: REACT_ELEMENT_TYPE,
      key: null,
      props,
      _owner: null,
      _store: {},
    };
    // JS object model: as on a real development element, `ref` is hidden.
    Object.defineProperty(element, "ref", { enumerable: false, value: null });
    return element;
  }
  return { $$typeof: REACT_ELEMENT_TYPE, type, key: null, ref: null, props };
}

function isHostInstance(child: Instance | TextInstance): child is Instance {
  return Array.isArray((child as Partial<Instance>).children);
}

function childToJSX(child: Instance | TextInstance | (Instance | TextInstance)[] | null, text: string | null): unknown {
  if (text !== null) {
    return text;
  }
  if (child === null) {
    return null;
  }
  if (Array.isArray(child)) {
    if (child.length === 0) {
      return null;
    }
    if (child.length === 1) {
      return childToJSX(child[0]!, null);
    }
    const children = child.map((c) => childToJSX(c, null));
    if (children.every((c) => typeof c === "string" || typeof c === "number" || typeof c === "bigint")) {
      return children.join("");
    }
    return children;
  }
  if (isHostInstance(child)) {
    const instance = child;
    const children = childToJSX(instance.children, instance.text);
    const props: { [key: string]: unknown } = { prop: instance.prop };
    if (instance.hidden) {
      props["hidden"] = true;
    }
    if (instance.src) {
      props["src"] = instance.src;
    }
    if (children !== null) {
      props["children"] = children;
    }
    return createJSXElementForTestComparison(instance.type, props);
  }
  // A text instance.
  if (child.hidden) {
    return "";
  }
  return child.text;
}

function getChildren(root: Container | Instance | null | undefined): (Instance | TextInstance)[] | null {
  return root ? root.children : null;
}

function getChildrenAsJSX(root: Container | Instance | null | undefined): unknown {
  const children = childToJSX(getChildren(root), null);
  if (children === null) {
    return null;
  }
  if (Array.isArray(children)) {
    return createJSXElementForTestComparison(REACT_FRAGMENT_TYPE, { children });
  }
  return children;
}

function onRecoverableError(error: unknown): void {
  // The renderer is only used for testing.
  console.error(error);
}

function onDefaultTransitionIndicator(): void | (() => void) {}

// The structures dumpTree reads from a class component's update queue.
interface LoggedUpdate {
  next: LoggedUpdate | null;
  expirationTime?: unknown;
}
interface LoggedUpdateQueue {
  firstBaseUpdate: LoggedUpdate | null;
  shared: { pending: LoggedUpdate | null };
}

export function createReactNoop(useMutation: boolean) {
  const rootContainers = new Map<string, Container>();
  const roots = new Map<string, FiberRoot>();
  const DEFAULT_ROOT_ID = "<default>";
  let idCounter = 0;

  function flushSync<R>(fn: (() => R) | null | undefined): R | undefined {
    if (isDevelopment && NoopRenderer.isAlreadyRendering()) {
      console.error(
        "flushSync was called from inside a lifecycle method. React cannot " +
          "flush when React is already rendering. Consider moving this call to " +
          "a scheduler task or micro task.",
      );
    }
    if (!disableLegacyMode) {
      return NoopRenderer.flushSyncFromReconciler(fn ?? undefined);
    }
    const previousTransition = ReactSharedInternals.T;
    const previousEventPriority = getCurrentEventPriority();
    try {
      ReactSharedInternals.T = null;
      setCurrentEventPriority(DiscreteEventPriority);
      return fn ? fn() : undefined;
    } finally {
      ReactSharedInternals.T = previousTransition;
      setCurrentEventPriority(previousEventPriority);
      NoopRenderer.flushSyncWork();
    }
  }

  function createNoopContainer(): Container {
    return { rootID: "" + idCounter++, pendingChildren: [], children: [] };
  }

  const ReactNoop = {
    _Scheduler: Scheduler,

    getChildren(_rootID: string = DEFAULT_ROOT_ID): never {
      throw new Error(
        "No longer supported due to bad performance when used with `expect()`. " +
          "Use `ReactNoop.getChildrenAsJSX()` instead or, if you really need to, `dangerouslyGetChildren` after you carefully considered the warning in its JSDOC.",
      );
    },

    getPendingChildren(_rootID: string = DEFAULT_ROOT_ID): never {
      throw new Error(
        "No longer supported due to bad performance when used with `expect()`. " +
          "Use `ReactNoop.getPendingChildrenAsJSX()` instead or, if you really need to, `dangerouslyGetPendingChildren` after you carefully considered the warning in its JSDOC.",
      );
    },

    // Prefer getChildrenAsJSX: comparing these with `toEqual` walks the
    // fibers they reference, which is very slow on a mismatch.
    dangerouslyGetChildren(rootID: string = DEFAULT_ROOT_ID) {
      return getChildren(rootContainers.get(rootID));
    },

    dangerouslyGetPendingChildren(rootID: string = DEFAULT_ROOT_ID) {
      return getChildren(rootContainers.get(rootID));
    },

    getOrCreateRootContainer(rootID: string = DEFAULT_ROOT_ID, tag: RootTag): Container {
      let root = roots.get(rootID);
      if (root === undefined) {
        const container: Container = { rootID, pendingChildren: [], children: [] };
        rootContainers.set(rootID, container);
        const created: FiberRoot = NoopRenderer.createContainer(
          container,
          tag,
          null,
          false,
          null,
          "",
          NoopRenderer.defaultOnUncaughtError,
          NoopRenderer.defaultOnCaughtError,
          onRecoverableError,
          onDefaultTransitionIndicator,
          null,
        );
        roots.set(rootID, created);
        root = created;
      }
      return (root.current.stateNode as FiberRoot).containerInfo as Container;
    },

    createRoot(options?: CreateRootOptions): NoopRoot {
      const container = createNoopContainer();
      const fiberRoot = NoopRenderer.createContainer(
        container,
        ConcurrentRoot,
        null,
        false,
        null,
        "",
        options && options.onUncaughtError ? options.onUncaughtError : NoopRenderer.defaultOnUncaughtError,
        options && options.onCaughtError ? options.onCaughtError : NoopRenderer.defaultOnCaughtError,
        onRecoverableError,
        options && options.onDefaultTransitionIndicator
          ? options.onDefaultTransitionIndicator
          : onDefaultTransitionIndicator,
        null,
      );
      return {
        _Scheduler: Scheduler,
        render(children: unknown) {
          NoopRenderer.updateContainer(children, fiberRoot, null, null);
        },
        getChildren() {
          return getChildren(container);
        },
        getChildrenAsJSX() {
          return getChildrenAsJSX(container);
        },
      };
    },

    createLegacyRoot(): never {
      // disableLegacyMode is on in the stable channel.
      throw new Error("createLegacyRoot: Unsupported Legacy Mode API.");
    },

    getChildrenAsJSX(rootID: string = DEFAULT_ROOT_ID) {
      return getChildrenAsJSX(rootContainers.get(rootID));
    },

    getPendingChildrenAsJSX(rootID: string = DEFAULT_ROOT_ID) {
      return getChildrenAsJSX(rootContainers.get(rootID));
    },

    getSuspenseyThingStatus,
    resolveSuspenseyThing,
    resetSuspenseyThingCache,

    createPortal(children: unknown, container: Container, key: string | null = null) {
      return NoopRenderer.createPortal(children, container, null, key);
    },

    // A shortcut for testing a single root.
    render(element: unknown, callback?: (() => unknown) | null): void {
      ReactNoop.renderToRootWithID(element, DEFAULT_ROOT_ID, callback);
    },

    renderLegacySyncRoot(_element: unknown, _callback?: (() => unknown) | null): never {
      throw new Error("createLegacyRoot: Unsupported Legacy Mode API.");
    },

    renderToRootWithID(element: unknown, rootID: string, callback?: (() => unknown) | null): void {
      const container = ReactNoop.getOrCreateRootContainer(rootID, ConcurrentRoot);
      const root = roots.get(container.rootID)!;
      NoopRenderer.updateContainer(element, root, null, callback);
    },

    unmountRootWithID(rootID: string): void {
      const root = roots.get(rootID);
      if (root) {
        NoopRenderer.updateContainer(null, root, null, () => {
          roots.delete(rootID);
          rootContainers.delete(rootID);
        });
      }
    },

    findInstance(componentOrElement: unknown): Instance | TextInstance | null {
      if (componentOrElement == null) {
        return null;
      }
      // Duck typing, as upstream's: a host instance has a numeric id.
      const component = componentOrElement as { id?: unknown };
      if (typeof component.id === "number") {
        return componentOrElement as Instance | TextInstance;
      }
      if (isDevelopment) {
        return NoopRenderer.findHostInstanceWithWarning(componentOrElement as object, "findInstance") as Instance | null;
      }
      return NoopRenderer.findHostInstance(componentOrElement as object) as Instance | null;
    },

    flushNextYield(): unknown[] {
      Scheduler.unstable_flushNumberOfYields(1);
      return Scheduler.unstable_clearLog();
    },

    startTrackingHostCounters(): void {
      resetHostCounters();
    },

    stopTrackingHostCounters(): { hostUpdateCounter: number } | { hostCloneCounter: number } {
      const counters = getHostCounters();
      const result = useMutation
        ? { hostUpdateCounter: counters.hostUpdateCounter }
        : { hostCloneCounter: counters.hostCloneCounter };
      resetHostCounters();
      return result;
    },

    expire: Scheduler.unstable_advanceTime,

    // Upstream's returns whatever unstable_flushExpired does, which is nothing.
    flushExpired(): void {
      return Scheduler.unstable_flushExpired();
    },

    unstable_runWithPriority<T>(priority: EventPriority, fn: () => T): T {
      const previousPriority = getCurrentUpdatePriority();
      try {
        setCurrentUpdatePriority(priority);
        return fn();
      } finally {
        setCurrentUpdatePriority(previousPriority);
      }
    },

    batchedUpdates: NoopRenderer.batchedUpdates,
    deferredUpdates: NoopRenderer.deferredUpdates,
    discreteUpdates: NoopRenderer.discreteUpdates,

    idleUpdates<T>(fn: () => T): void {
      const prevEventPriority = getCurrentEventPriority();
      setCurrentEventPriority(IdleEventPriority);
      try {
        fn();
      } finally {
        setCurrentEventPriority(prevEventPriority);
      }
    },

    flushSync,
    flushPassiveEffects: NoopRenderer.flushPassiveEffects,

    // Logs the current state of the tree.
    dumpTree(rootID: string = DEFAULT_ROOT_ID): void {
      const root = roots.get(rootID);
      const rootContainer = rootContainers.get(rootID);
      if (!root || !rootContainer) {
        console.log("Nothing rendered yet.");
        return;
      }
      const bufferedLog: string[] = [];
      function log(...args: string[]): void {
        bufferedLog.push(...args, "\n");
      }
      function logHostInstances(children: (Instance | TextInstance)[], depth: number): void {
        for (const child of children) {
          const indent = "  ".repeat(depth);
          if (typeof child.text === "string") {
            log(indent + "- " + child.text);
          } else if (isHostInstance(child)) {
            log(indent + "- " + child.type + "#" + child.id);
            logHostInstances(child.children, depth + 1);
          }
        }
      }
      function logContainer(container: Container, depth: number): void {
        log("  ".repeat(depth) + "- [root#" + container.rootID + "]");
        logHostInstances(container.children, depth + 1);
      }
      // Upstream's version of this loop never advances; this one walks the
      // lists, which is what it meant to do.
      function logUpdateQueue(updateQueue: LoggedUpdateQueue, depth: number): void {
        log("  ".repeat(depth + 1) + "QUEUED UPDATES");
        for (let update = updateQueue.firstBaseUpdate; update !== null; update = update.next) {
          log("  ".repeat(depth + 1) + "~", "[" + String(update.expirationTime) + "]");
        }
        const lastPending = updateQueue.shared.pending;
        if (lastPending !== null) {
          const firstPending = lastPending.next;
          let pendingUpdate = firstPending;
          while (pendingUpdate !== null) {
            log("  ".repeat(depth + 1) + "~", "[" + String(pendingUpdate.expirationTime) + "]");
            pendingUpdate = pendingUpdate.next;
            if (pendingUpdate === firstPending) {
              break;
            }
          }
        }
      }
      function logFiber(fiber: Fiber, depth: number): void {
        const type = fiber.type as { name?: string; toString(): string } | null;
        log(
          "  ".repeat(depth) + "- " + (type ? type.name || type.toString() : "[root]"),
          "[" + String((fiber as { childExpirationTime?: unknown }).childExpirationTime) + (fiber.pendingProps ? "*" : "") + "]",
        );
        if (fiber.updateQueue) {
          logUpdateQueue(fiber.updateQueue as LoggedUpdateQueue, depth);
        }
        if (fiber.child) {
          logFiber(fiber.child, depth + 1);
        }
        if (fiber.sibling) {
          logFiber(fiber.sibling, depth);
        }
      }
      log("HOST INSTANCES:");
      logContainer(rootContainer, 0);
      log("FIBERS:");
      logFiber(root.current, 0);
      console.log(...bufferedLog);
    },

    getRoot(rootID: string = DEFAULT_ROOT_ID): FiberRoot | undefined {
      return roots.get(rootID);
    },
  };

  return ReactNoop;
}

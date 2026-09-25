// Child reconciliation: turning the children a component rendered into child
// fibers, reusing the current ones by key and type, and marking placements
// and deletions for the commit.

import { isDevelopment } from "shared/Build.ts";
import { disableLegacyMode, enableAsyncIterableChildren, enableFragmentRefs } from "shared/ReactFeatureFlags.ts";
import {
  ASYNC_ITERATOR,
  getIteratorFn,
  REACT_CONTEXT_TYPE,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_LAZY_TYPE,
  REACT_LEGACY_ELEMENT_TYPE,
  REACT_PORTAL_TYPE,
} from "shared/ReactSymbols.ts";
import type { LazyComponent, ReactDebugInfo, ReactElement, ReactKey, ReactPortal, Thenable, ReactContextBase } from "shared/ReactTypes.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";
import { runWithFiberInDEV } from "./ReactCurrentFiber.ts";
import {
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromPortal,
  createFiberFromText,
  createFiberFromThrow,
  createWorkInProgress,
  resetWorkInProgress,
} from "./ReactFiber.ts";
import { ChildDeletion, Forked, Placement, PlacementDEV } from "./ReactFiberFlags.ts";
import { isCompatibleFamilyForHotReloading } from "./ReactFiberHotReloading.ts";
import { getIsHydrating } from "./ReactFiberHydrationContext.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import { readContextDuringReconciliation } from "./ReactFiberNewContext.ts";
import type { SuspenseListRevealOrder } from "./ReactFiberSuspenseComponent.ts";
import type { ThenableState } from "./ReactFiberThenable.ts";
import {
  createThenableState,
  resolveLazy,
  SuspenseActionException,
  SuspenseException,
  trackUsedThenable,
} from "./ReactFiberThenable.ts";
import { pushTreeFork } from "./ReactFiberTreeContext.ts";
import type { Fiber, Ref } from "./ReactInternalTypes.ts";
import { ConcurrentMode, NoMode } from "./ReactTypeOfMode.ts";
import { Fragment, FunctionComponent, HostPortal, HostRoot, HostText } from "./ReactWorkTags.ts";

// A child as a component returns it: anything. Each path below narrows it.
type Child = unknown;

// The `$$typeof`-tagged objects a child can be.
interface TaggedChild {
  readonly $$typeof?: unknown;
  readonly _debugInfo?: ReactDebugInfo | null;
  readonly then?: unknown;
}

// A console task (console.createTask) that runs a callback in its context.
interface ConsoleTask {
  run<T>(callback: () => T): T;
}

// A Server Component's debug info entry.
interface ComponentDebugInfo {
  readonly name?: unknown;
  readonly stack?: unknown;
  readonly debugTask?: ConsoleTask | null;
}

// The portal's host state on a HostPortal fiber.
interface PortalStateNode {
  readonly containerInfo: unknown;
  readonly implementation: unknown;
}

// This tracks the thenables that are unwrapped during reconcilation.
let thenableState: ThenableState | null = null;
let thenableIndexCounter = 0;

// Server Components Meta Data
let currentDebugInfo: ReactDebugInfo | null = null;

function pushDebugInfo(debugInfo: ReactDebugInfo | null | undefined): ReactDebugInfo | null {
  if (!isDevelopment) {
    return null;
  }
  const previousDebugInfo = currentDebugInfo;
  if (debugInfo == null) {
    // Leave inplace
  } else if (previousDebugInfo === null) {
    currentDebugInfo = debugInfo;
  } else {
    // If we have two debugInfo, we need to create a new one. This makes the array no longer
    // live so we'll miss any future updates if we received more so ideally we should always
    // do this after both have fully resolved/unsuspended.
    currentDebugInfo = previousDebugInfo.concat(debugInfo);
  }
  return previousDebugInfo;
}

function readCurrentDebugInfo(): ReactDebugInfo | null {
  return currentDebugInfo;
}

function getCurrentDebugTask(): ConsoleTask | null {
  // Get the debug task of the parent Server Component if there is one.
  if (isDevelopment) {
    const debugInfo = currentDebugInfo;
    if (debugInfo != null) {
      for (let i = debugInfo.length - 1; i >= 0; i--) {
        const componentInfo = debugInfo[i] as ComponentDebugInfo;
        if (componentInfo.name != null) {
          const debugTask = componentInfo.debugTask;
          if (debugTask != null) {
            return debugTask;
          }
        }
      }
    }
  }
  return null;
}

let didWarnAboutMaps = false;
let didWarnAboutGenerators = false;
const ownerHasKeyUseWarning: { [componentName: string]: boolean } = {};
const ownerHasFunctionTypeWarning: { [componentName: string]: boolean } = {};
const ownerHasSymbolTypeWarning: { [componentName: string]: boolean } = {};

// Warn if there's no key explicitly set on dynamic arrays of children or
// object keys are not valid. This allows us to keep track of children between
// updates.
function warnForMissingKey(returnFiber: Fiber, workInProgress: Fiber, child: unknown): void {
  if (!isDevelopment) {
    return;
  }
  if (child === null || typeof child !== "object") {
    return;
  }
  const element = child as { _store?: { validated: number }; key?: unknown; _owner?: unknown };
  const store = element._store;
  if (!store || ((store.validated || element.key != null) && store.validated !== 2)) {
    return;
  }
  if (typeof store !== "object") {
    throw new Error(
      "React Component in warnForMissingKey should have a _store. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  store.validated = 1;

  const componentName = getComponentNameFromFiber(returnFiber);
  const componentKey = componentName || "null";
  if (ownerHasKeyUseWarning[componentKey]) {
    return;
  }
  ownerHasKeyUseWarning[componentKey] = true;

  const childOwner = element._owner as { tag?: unknown; name?: unknown } | null | undefined;
  const parentOwner = returnFiber._debugOwner;

  let currentComponentErrorInfo = "";
  if (parentOwner && typeof parentOwner.tag === "number") {
    const name = getComponentNameFromFiber(parentOwner);
    if (name) {
      currentComponentErrorInfo = "\n\nCheck the render method of `" + name + "`.";
    }
  }
  if (!currentComponentErrorInfo) {
    if (componentName) {
      currentComponentErrorInfo = `\n\nCheck the top-level render call using <${componentName}>.`;
    }
  }

  // Usually the current owner is the offender, but if it accepts children as a
  // property, it may be the creator of the child that's responsible for
  // assigning it a key.
  let childOwnerAppendix = "";
  if (childOwner != null && parentOwner !== childOwner) {
    let ownerName: string | null = null;
    if (typeof childOwner.tag === "number") {
      ownerName = getComponentNameFromFiber(childOwner as Fiber);
    } else if (typeof childOwner.name === "string") {
      ownerName = childOwner.name;
    }
    if (ownerName) {
      // Give the component that originally created this child.
      childOwnerAppendix = ` It was passed a child from ${ownerName}.`;
    }
  }

  runWithFiberInDEV(workInProgress, () => {
    console.error(
      'Each child in a list should have a unique "key" prop.' +
        "%s%s See https://react.dev/link/warning-keys for more information.",
      currentComponentErrorInfo,
      childOwnerAppendix,
    );
  });
}

// Given a fragment, validate that it can only be provided with fragment props
// We do this here instead of BeginWork because the Fragment fiber doesn't have
// the whole props object, only the children and is shared with arrays.
function validateFragmentProps(element: ReactElement, fiberIn: Fiber | null, returnFiber: Fiber): void {
  if (isDevelopment) {
    let fiber = fiberIn;
    const keys = Object.keys(element.props);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (key !== "children" && key !== "key" && (enableFragmentRefs ? key !== "ref" : true)) {
        if (fiber === null) {
          // For unkeyed root fragments without refs (enableFragmentRefs),
          // there's no Fiber. We create a fake one just for error stack handling.
          fiber = createFiberFromElement(element, returnFiber.mode, 0);
          fiber._debugInfo = currentDebugInfo;
          fiber.return = returnFiber;
        }
        runWithFiberInDEV(fiber, () => {
          if (enableFragmentRefs) {
            console.error(
              "Invalid prop `%s` supplied to `React.Fragment`. " +
                "React.Fragment can only have `key`, `ref`, and `children` props.",
              key,
            );
          } else {
            console.error(
              "Invalid prop `%s` supplied to `React.Fragment`. " +
                "React.Fragment can only have `key` and `children` props.",
              key,
            );
          }
        });
        break;
      }
    }
  }
}

function unwrapThenable<T>(thenable: Thenable<T>): T {
  const index = thenableIndexCounter;
  thenableIndexCounter += 1;
  if (thenableState === null) {
    thenableState = createThenableState();
  }
  return trackUsedThenable(thenableState, thenable, index, null);
}

function coerceRef(workInProgress: Fiber, element: ReactElement): void {
  // TODO: This is a temporary, intermediate step. Now that enableRefAsProp is on,
  // we should resolve the `ref` prop during the begin phase of the component
  // it's attached to (HostComponent, ClassComponent, etc).
  const refProp = element.props["ref"];
  // TODO: With enableRefAsProp now rolled out, we shouldn't use the `ref` field. We
  // should always read the ref from the prop.
  workInProgress.ref = refProp !== undefined ? (refProp as Ref) : null;
}

function throwOnInvalidObjectTypeImpl(_returnFiber: Fiber, newChild: object): never {
  if ((newChild as TaggedChild).$$typeof === REACT_LEGACY_ELEMENT_TYPE) {
    throw new Error(
      "A React Element from an older version of React was rendered. " +
        "This is not supported. It can happen if:\n" +
        '- Multiple copies of the "react" package is used.\n' +
        '- A library pre-bundled an old copy of "react" or "react/jsx-runtime".\n' +
        '- A compiler tries to "inline" JSX instead of using the runtime.',
    );
  }
  const childString: string = Object.prototype.toString.call(newChild);
  throw new Error(
    `Objects are not valid as a React child (found: ${
      childString === "[object Object]" ? "object with keys {" + Object.keys(newChild).join(", ") + "}" : childString
    }). ` +
      "If you meant to render a collection of children, use an array " +
      "instead.",
  );
}

function throwOnInvalidObjectType(returnFiber: Fiber, newChild: object): never {
  const debugTask = getCurrentDebugTask();
  if (isDevelopment && debugTask !== null) {
    debugTask.run(() => throwOnInvalidObjectTypeImpl(returnFiber, newChild));
  }
  throwOnInvalidObjectTypeImpl(returnFiber, newChild);
}

function warnOnFunctionTypeImpl(returnFiber: Fiber, invalidChild: Function): void {
  if (isDevelopment) {
    const parentName = getComponentNameFromFiber(returnFiber) || "Component";
    if (ownerHasFunctionTypeWarning[parentName]) {
      return;
    }
    ownerHasFunctionTypeWarning[parentName] = true;
    const named = invalidChild as { displayName?: string; name?: string };
    const name = named.displayName || named.name || "Component";
    if (returnFiber.tag === HostRoot) {
      console.error(
        "Functions are not valid as a React child. This may happen if " +
          "you return %s instead of <%s /> from render. " +
          "Or maybe you meant to call this function rather than return it.\n" +
          "  root.render(%s)",
        name,
        name,
        name,
      );
    } else {
      console.error(
        "Functions are not valid as a React child. This may happen if " +
          "you return %s instead of <%s /> from render. " +
          "Or maybe you meant to call this function rather than return it.\n" +
          "  <%s>{%s}</%s>",
        name,
        name,
        parentName,
        name,
        parentName,
      );
    }
  }
}

function warnOnFunctionType(returnFiber: Fiber, invalidChild: Function): void {
  const debugTask = getCurrentDebugTask();
  if (isDevelopment && debugTask !== null) {
    debugTask.run(() => warnOnFunctionTypeImpl(returnFiber, invalidChild));
  } else {
    warnOnFunctionTypeImpl(returnFiber, invalidChild);
  }
}

function warnOnSymbolTypeImpl(returnFiber: Fiber, invalidChild: symbol): void {
  if (isDevelopment) {
    const parentName = getComponentNameFromFiber(returnFiber) || "Component";
    if (ownerHasSymbolTypeWarning[parentName]) {
      return;
    }
    ownerHasSymbolTypeWarning[parentName] = true;
    const name = String(invalidChild);
    if (returnFiber.tag === HostRoot) {
      console.error("Symbols are not valid as a React child.\n" + "  root.render(%s)", name);
    } else {
      console.error("Symbols are not valid as a React child.\n" + "  <%s>%s</%s>", parentName, name, parentName);
    }
  }
}

function warnOnSymbolType(returnFiber: Fiber, invalidChild: symbol): void {
  const debugTask = getCurrentDebugTask();
  if (isDevelopment && debugTask !== null) {
    debugTask.run(() => warnOnSymbolTypeImpl(returnFiber, invalidChild));
  } else {
    warnOnSymbolTypeImpl(returnFiber, invalidChild);
  }
}

// Development warnings for a child that renders nothing because it is a
// function or a symbol.
function warnOnInvalidPrimitive(returnFiber: Fiber, newChild: Child): void {
  if (isDevelopment) {
    if (typeof newChild === "function") {
      warnOnFunctionType(returnFiber, newChild);
    }
    if (typeof newChild === "symbol") {
      warnOnSymbolType(returnFiber, newChild);
    }
  }
}

function isTextChild(newChild: Child): newChild is string | number | bigint {
  return (typeof newChild === "string" && newChild !== "") || typeof newChild === "number" || typeof newChild === "bigint";
}

function hasAsyncIterator(newChild: object): boolean {
  return (
    enableAsyncIterableChildren &&
    typeof (newChild as { [ASYNC_ITERATOR]?: unknown })[ASYNC_ITERATOR] === "function"
  );
}

function isLazyChild(value: unknown): value is LazyComponent<unknown, unknown> {
  return typeof value === "object" && value !== null && (value as TaggedChild).$$typeof === REACT_LAZY_TYPE;
}

// A key into the map of remaining children: its key, or its index when it has
// none.
type ChildKey = string | number;

export type ChildReconciler = (
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChild: Child,
  lanes: Lanes,
) => Fiber | null;

// One reconciler per mode: tracking side effects (an update) or not (a
// mount, where the whole subtree is inserted by its parent's placement).
class ChildReconcilerImpl {
  readonly shouldTrackSideEffects: boolean;

  constructor(shouldTrackSideEffects: boolean) {
    this.shouldTrackSideEffects = shouldTrackSideEffects;
  }

  deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!this.shouldTrackSideEffects) {
      // Noop.
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(childToDelete);
    }
  }

  deleteRemainingChildren(returnFiber: Fiber, currentFirstChild: Fiber | null): Fiber | null {
    if (!this.shouldTrackSideEffects) {
      // Noop.
      return null;
    }
    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      this.deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }

  mapRemainingChildren(currentFirstChild: Fiber): Map<ChildKey, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<ChildKey, Fiber> = new Map<ChildKey, Fiber>();
    let existingChild: Fiber | null = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key === null) {
        existingChildren.set(existingChild.index, existingChild);
      } else {
        existingChildren.set(existingChild.key, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  useFiber(fiber: Fiber, pendingProps: unknown): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }

  placeChild(newFiber: Fiber, lastPlacedIndex: number, newIndex: number): number {
    newFiber.index = newIndex;
    if (!this.shouldTrackSideEffects) {
      // During hydration, the useId algorithm needs to know which fibers are
      // part of a list of children (arrays, iterators).
      newFiber.flags |= Forked;
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // This is a move. The fiber already existed, so this is not a new
        // mount; don't set PlacementDEV, which would cause StrictMode to
        // re-run the effects in its subtree as if it had remounted.
        newFiber.flags |= Placement;
        return lastPlacedIndex;
      }
      // This item can stay in place.
      return oldIndex;
    }
    // This is an insertion.
    newFiber.flags |= Placement | PlacementDEV;
    return lastPlacedIndex;
  }

  placeSingleChild(newFiber: Fiber): Fiber {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    if (this.shouldTrackSideEffects && newFiber.alternate === null) {
      newFiber.flags |= Placement | PlacementDEV;
    }
    return newFiber;
  }

  updateTextNode(returnFiber: Fiber, current: Fiber | null, textContent: string, lanes: Lanes): Fiber {
    if (current === null || current.tag !== HostText) {
      // Insert
      const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      created.return = returnFiber;
      if (isDevelopment) {
        // We treat the parent as the owner for stack purposes.
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      return created;
    }
    // Update
    const existing = this.useFiber(current, textContent);
    existing.return = returnFiber;
    if (isDevelopment) {
      existing._debugInfo = currentDebugInfo;
    }
    return existing;
  }

  updateElement(returnFiber: Fiber, current: Fiber | null, element: ReactElement, lanes: Lanes): Fiber {
    const elementType = element.type;
    if (elementType === REACT_FRAGMENT_TYPE) {
      const updated = this.updateFragment(returnFiber, current, element.props["children"], lanes, element.key);
      if (enableFragmentRefs) {
        coerceRef(updated, element);
      }
      validateFragmentProps(element, updated, returnFiber);
      return updated;
    }
    if (current !== null) {
      if (
        current.elementType === elementType ||
        // Keep this check inline so it only runs on the false path:
        (isDevelopment ? isCompatibleFamilyForHotReloading(current, element) : false) ||
        // Lazy types should reconcile their resolved type.
        // We need to do this after the Hot Reloading check above,
        // because hot reloading has different semantics than prod because
        // it doesn't resuspend. So we can't let the call below suspend.
        (isLazyChild(elementType) && resolveLazy(elementType) === current.type)
      ) {
        // Move based on index
        const existing = this.useFiber(current, element.props);
        coerceRef(existing, element);
        existing.return = returnFiber;
        if (isDevelopment) {
          existing._debugOwner = element._owner as Fiber | null;
          existing._debugInfo = currentDebugInfo;
        }
        return existing;
      }
    }
    // Insert
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    coerceRef(created, element);
    created.return = returnFiber;
    if (isDevelopment) {
      created._debugInfo = currentDebugInfo;
    }
    return created;
  }

  updatePortal(returnFiber: Fiber, current: Fiber | null, portal: ReactPortal, lanes: Lanes): Fiber {
    if (
      current === null ||
      current.tag !== HostPortal ||
      (current.stateNode as PortalStateNode).containerInfo !== portal.containerInfo ||
      (current.stateNode as PortalStateNode).implementation !== portal.implementation
    ) {
      // Insert
      const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
      created.return = returnFiber;
      if (isDevelopment) {
        created._debugInfo = currentDebugInfo;
      }
      return created;
    }
    // Update
    const existing = this.useFiber(current, portal.children || []);
    existing.return = returnFiber;
    if (isDevelopment) {
      existing._debugInfo = currentDebugInfo;
    }
    return existing;
  }

  updateFragment(returnFiber: Fiber, current: Fiber | null, fragment: Child, lanes: Lanes, key: ReactKey): Fiber {
    if (current === null || current.tag !== Fragment) {
      // Insert
      const created = createFiberFromFragment(fragment, returnFiber.mode, lanes, key);
      created.return = returnFiber;
      if (isDevelopment) {
        // We treat the parent as the owner for stack purposes.
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      return created;
    }
    // Update
    const existing = this.useFiber(current, fragment);
    existing.return = returnFiber;
    if (isDevelopment) {
      existing._debugInfo = currentDebugInfo;
    }
    return existing;
  }

  createChild(returnFiber: Fiber, newChild: Child, lanes: Lanes): Fiber | null {
    if (isTextChild(newChild)) {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText("" + newChild, returnFiber.mode, lanes);
      created.return = returnFiber;
      if (isDevelopment) {
        // We treat the parent as the owner for stack purposes.
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      return created;
    }

    if (typeof newChild === "object" && newChild !== null) {
      const tagged = newChild as TaggedChild;
      switch (tagged.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const element = newChild as ReactElement;
          const created = createFiberFromElement(element, returnFiber.mode, lanes);
          coerceRef(created, element);
          created.return = returnFiber;
          if (isDevelopment) {
            const prevDebugInfo = pushDebugInfo(element._debugInfo);
            created._debugInfo = currentDebugInfo;
            currentDebugInfo = prevDebugInfo;
          }
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(newChild as ReactPortal, returnFiber.mode, lanes);
          created.return = returnFiber;
          if (isDevelopment) {
            created._debugInfo = currentDebugInfo;
          }
          return created;
        }
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
          const resolvedChild = resolveLazy(newChild as LazyComponent<unknown, unknown>);
          const created = this.createChild(returnFiber, resolvedChild, lanes);
          currentDebugInfo = prevDebugInfo;
          return created;
        }
      }

      if (Array.isArray(newChild) || getIteratorFn(newChild) || hasAsyncIterator(newChild)) {
        const created = createFiberFromFragment(newChild, returnFiber.mode, lanes, null);
        created.return = returnFiber;
        if (isDevelopment) {
          // We treat the parent as the owner for stack purposes.
          created._debugOwner = returnFiber;
          created._debugTask = returnFiber._debugTask;
          // Make sure to not push again when handling the Fragment child.
          const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
          created._debugInfo = currentDebugInfo;
          currentDebugInfo = prevDebugInfo;
        }
        return created;
      }

      // Usable node types
      //
      // Unwrap the inner value and recursively call this function again.
      if (typeof tagged.then === "function") {
        const thenable = newChild as Thenable<unknown>;
        const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
        const created = this.createChild(returnFiber, unwrapThenable(thenable), lanes);
        currentDebugInfo = prevDebugInfo;
        return created;
      }

      if (tagged.$$typeof === REACT_CONTEXT_TYPE) {
        const context = newChild as ReactContextBase;
        return this.createChild(returnFiber, readContextDuringReconciliation(returnFiber, context, lanes), lanes);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    warnOnInvalidPrimitive(returnFiber, newChild);
    return null;
  }

  updateSlot(returnFiber: Fiber, oldFiber: Fiber | null, newChild: Child, lanes: Lanes): Fiber | null {
    // Update the fiber if the keys match, otherwise return null.
    const key = oldFiber !== null ? oldFiber.key : null;

    if (isTextChild(newChild)) {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        return null;
      }
      return this.updateTextNode(returnFiber, oldFiber, "" + newChild, lanes);
    }

    if (typeof newChild === "object" && newChild !== null) {
      const tagged = newChild as TaggedChild;
      switch (tagged.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const element = newChild as ReactElement;
          if (element.key === key) {
            const prevDebugInfo = pushDebugInfo(element._debugInfo);
            const updated = this.updateElement(returnFiber, oldFiber, element, lanes);
            currentDebugInfo = prevDebugInfo;
            return updated;
          }
          return null;
        }
        case REACT_PORTAL_TYPE: {
          const portal = newChild as ReactPortal;
          if (portal.key === key) {
            return this.updatePortal(returnFiber, oldFiber, portal, lanes);
          }
          return null;
        }
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
          const resolvedChild = resolveLazy(newChild as LazyComponent<unknown, unknown>);
          const updated = this.updateSlot(returnFiber, oldFiber, resolvedChild, lanes);
          currentDebugInfo = prevDebugInfo;
          return updated;
        }
      }

      if (Array.isArray(newChild) || getIteratorFn(newChild) || hasAsyncIterator(newChild)) {
        if (key !== null) {
          return null;
        }
        const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
        const updated = this.updateFragment(returnFiber, oldFiber, newChild, lanes, null);
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      // Usable node types
      //
      // Unwrap the inner value and recursively call this function again.
      if (typeof tagged.then === "function") {
        const thenable = newChild as Thenable<unknown>;
        const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
        const updated = this.updateSlot(returnFiber, oldFiber, unwrapThenable(thenable), lanes);
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      if (tagged.$$typeof === REACT_CONTEXT_TYPE) {
        const context = newChild as ReactContextBase;
        return this.updateSlot(returnFiber, oldFiber, readContextDuringReconciliation(returnFiber, context, lanes), lanes);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    warnOnInvalidPrimitive(returnFiber, newChild);
    return null;
  }

  updateFromMap(
    existingChildren: Map<ChildKey, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: Child,
    lanes: Lanes,
  ): Fiber | null {
    if (isTextChild(newChild)) {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      const matchedFiber = existingChildren.get(newIdx) || null;
      return this.updateTextNode(returnFiber, matchedFiber, "" + newChild, lanes);
    }

    if (typeof newChild === "object" && newChild !== null) {
      const tagged = newChild as TaggedChild;
      switch (tagged.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const element = newChild as ReactElement;
          const matchedFiber = existingChildren.get(element.key === null ? newIdx : element.key) || null;
          const prevDebugInfo = pushDebugInfo(element._debugInfo);
          const updated = this.updateElement(returnFiber, matchedFiber, element, lanes);
          currentDebugInfo = prevDebugInfo;
          return updated;
        }
        case REACT_PORTAL_TYPE: {
          const portal = newChild as ReactPortal;
          const matchedFiber = existingChildren.get(portal.key === null ? newIdx : portal.key) || null;
          return this.updatePortal(returnFiber, matchedFiber, portal, lanes);
        }
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
          const resolvedChild = resolveLazy(newChild as LazyComponent<unknown, unknown>);
          const updated = this.updateFromMap(existingChildren, returnFiber, newIdx, resolvedChild, lanes);
          currentDebugInfo = prevDebugInfo;
          return updated;
        }
      }

      if (Array.isArray(newChild) || getIteratorFn(newChild) || hasAsyncIterator(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
        const updated = this.updateFragment(returnFiber, matchedFiber, newChild, lanes, null);
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      // Usable node types
      //
      // Unwrap the inner value and recursively call this function again.
      if (typeof tagged.then === "function") {
        const thenable = newChild as Thenable<unknown>;
        const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
        const updated = this.updateFromMap(existingChildren, returnFiber, newIdx, unwrapThenable(thenable), lanes);
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      if (tagged.$$typeof === REACT_CONTEXT_TYPE) {
        const context = newChild as ReactContextBase;
        return this.updateFromMap(
          existingChildren,
          returnFiber,
          newIdx,
          readContextDuringReconciliation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    warnOnInvalidPrimitive(returnFiber, newChild);
    return null;
  }

  // Warns if there is a duplicate or missing key
  warnOnInvalidKey(
    returnFiber: Fiber,
    workInProgress: Fiber,
    child: unknown,
    knownKeysIn: Set<string> | null,
  ): Set<string> | null {
    let knownKeys = knownKeysIn;
    if (isDevelopment) {
      if (typeof child !== "object" || child === null) {
        return knownKeys;
      }
      switch ((child as TaggedChild).$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE: {
          warnForMissingKey(returnFiber, workInProgress, child);
          const key = (child as { key?: unknown }).key;
          if (typeof key !== "string") {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set<string>();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          runWithFiberInDEV(workInProgress, () => {
            console.error(
              "Encountered two children with the same key, `%s`. " +
                "Keys should be unique so that components maintain their identity " +
                "across updates. Non-unique keys may cause children to be " +
                "duplicated and/or omitted — the behavior is unsupported and " +
                "could change in a future version.",
              key,
            );
          });
          break;
        }
        case REACT_LAZY_TYPE: {
          const resolvedChild = resolveLazy(child as LazyComponent<unknown, unknown>);
          this.warnOnInvalidKey(returnFiber, workInProgress, resolvedChild, knownKeys);
          break;
        }
        default:
          break;
      }
    }
    return knownKeys;
  }

  reconcileChildrenArray(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: readonly Child[],
    lanes: Lanes,
  ): Fiber | null {
    // This algorithm can't optimize by searching from both ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.

    let knownKeys: Set<string> | null = null;

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber: Fiber | null = null;
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = this.updateSlot(returnFiber, oldFiber, newChildren[newIdx], lanes);
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }

      if (isDevelopment) {
        knownKeys = this.warnOnInvalidKey(returnFiber, newFiber, newChildren[newIdx], knownKeys);
      }

      if (this.shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          this.deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = this.placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      this.deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = this.createChild(returnFiber, newChildren[newIdx], lanes);
        if (newFiber === null) {
          continue;
        }
        if (isDevelopment) {
          knownKeys = this.warnOnInvalidKey(returnFiber, newFiber, newChildren[newIdx], knownKeys);
        }
        lastPlacedIndex = this.placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = this.mapRemainingChildren(oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber = this.updateFromMap(existingChildren, returnFiber, newIdx, newChildren[newIdx], lanes);
      if (newFiber !== null) {
        if (isDevelopment) {
          knownKeys = this.warnOnInvalidKey(returnFiber, newFiber, newChildren[newIdx], knownKeys);
        }
        if (this.shouldTrackSideEffects) {
          const currentFiber = newFiber.alternate;
          if (currentFiber !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(currentFiber.key === null ? newIdx : currentFiber.key);
          }
        }
        lastPlacedIndex = this.placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (this.shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach((child) => this.deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  reconcileChildrenIteratable(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: object,
    lanes: Lanes,
  ): Fiber | null {
    // This is the same implementation as reconcileChildrenArray(),
    // but using the iterator instead.
    const iteratorFn = getIteratorFn(newChildrenIterable);
    if (typeof iteratorFn !== "function") {
      throw new Error(
        "An object is not an iterable. This error is likely caused by a bug in " + "React. Please file an issue.",
      );
    }

    const newChildren = iteratorFn.call(newChildrenIterable);

    if (isDevelopment) {
      if (newChildren === newChildrenIterable) {
        // We don't support rendering Generators as props because it's a mutation.
        // See https://github.com/facebook/react/issues/12995
        // We do support generators if they were created by a GeneratorFunction component
        // as its direct child since we can recreate those by rerendering the component
        // as needed.
        const isGeneratorComponent =
          returnFiber.tag === FunctionComponent &&
          Object.prototype.toString.call(returnFiber.type) === "[object GeneratorFunction]" &&
          Object.prototype.toString.call(newChildren) === "[object Generator]";
        if (!isGeneratorComponent) {
          if (!didWarnAboutGenerators) {
            console.error(
              "Using Iterators as children is unsupported and will likely yield " +
                "unexpected results because enumerating a generator mutates it. " +
                "You may convert it to an array with `Array.from()` or the " +
                "`[...spread]` operator before rendering. You can also use an " +
                "Iterable that can iterate multiple times over the same items.",
            );
          }
          didWarnAboutGenerators = true;
        }
      } else if ((newChildrenIterable as { entries?: unknown }).entries === iteratorFn) {
        // Warn about using Maps as children
        if (!didWarnAboutMaps) {
          console.error("Using Maps as children is not supported. " + "Use an array of keyed ReactElements instead.");
          didWarnAboutMaps = true;
        }
      }
    }

    return this.reconcileChildrenIterator(returnFiber, currentFirstChild, newChildren, lanes);
  }

  reconcileChildrenAsyncIteratable(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: AsyncIterable<unknown>,
    lanes: Lanes,
  ): Fiber | null {
    const newChildren = newChildrenIterable[Symbol.asyncIterator]();

    if (isDevelopment) {
      if ((newChildren as unknown) === newChildrenIterable) {
        // We don't support rendering AsyncGenerators as props because it's a mutation.
        // We do support generators if they were created by a AsyncGeneratorFunction component
        // as its direct child since we can recreate those by rerendering the component
        // as needed.
        const isGeneratorComponent =
          returnFiber.tag === FunctionComponent &&
          Object.prototype.toString.call(returnFiber.type) === "[object AsyncGeneratorFunction]" &&
          Object.prototype.toString.call(newChildren) === "[object AsyncGenerator]";
        if (!isGeneratorComponent) {
          if (!didWarnAboutGenerators) {
            console.error(
              "Using AsyncIterators as children is unsupported and will likely yield " +
                "unexpected results because enumerating a generator mutates it. " +
                "You can use an AsyncIterable that can iterate multiple times over " +
                "the same items.",
            );
          }
          didWarnAboutGenerators = true;
        }
      }
    }

    if (newChildren == null) {
      throw new Error("An iterable object provided no iterator.");
    }

    // To save bytes, we reuse the logic by creating a synchronous Iterable and
    // reusing that code path.
    const iterator: Iterator<unknown> = {
      next(): IteratorResult<unknown> {
        return unwrapThenable(newChildren.next() as Thenable<IteratorResult<unknown>>);
      },
    };

    return this.reconcileChildrenIterator(returnFiber, currentFirstChild, iterator, lanes);
  }

  reconcileChildrenIterator(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Iterator<unknown> | null | undefined,
    lanes: Lanes,
  ): Fiber | null {
    if (newChildren == null) {
      throw new Error("An iterable object provided no iterator.");
    }

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber: Fiber | null = null;

    let knownKeys: Set<string> | null = null;

    let step = newChildren.next();
    for (; oldFiber !== null && !step.done; newIdx++, step = newChildren.next()) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = this.updateSlot(returnFiber, oldFiber, step.value, lanes);
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }

      if (isDevelopment) {
        knownKeys = this.warnOnInvalidKey(returnFiber, newFiber, step.value, knownKeys);
      }

      if (this.shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          this.deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = this.placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // We've reached the end of the new children. We can delete the rest.
      this.deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = this.createChild(returnFiber, step.value, lanes);
        if (newFiber === null) {
          continue;
        }
        if (isDevelopment) {
          knownKeys = this.warnOnInvalidKey(returnFiber, newFiber, step.value, knownKeys);
        }
        lastPlacedIndex = this.placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = this.mapRemainingChildren(oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = this.updateFromMap(existingChildren, returnFiber, newIdx, step.value, lanes);
      if (newFiber !== null) {
        if (isDevelopment) {
          knownKeys = this.warnOnInvalidKey(returnFiber, newFiber, step.value, knownKeys);
        }
        if (this.shouldTrackSideEffects) {
          const currentFiber = newFiber.alternate;
          if (currentFiber !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(currentFiber.key === null ? newIdx : currentFiber.key);
          }
        }
        lastPlacedIndex = this.placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (this.shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach((child) => this.deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ): Fiber {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      this.deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      const existing = this.useFiber(currentFirstChild, textContent);
      existing.return = returnFiber;
      return existing;
    }
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    this.deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.return = returnFiber;
    if (isDevelopment) {
      // We treat the parent as the owner for stack purposes.
      created._debugOwner = returnFiber;
      created._debugTask = returnFiber._debugTask;
      created._debugInfo = currentDebugInfo;
    }
    return created;
  }

  reconcileSingleElement(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const key = element.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        const elementType = element.type;
        if (elementType === REACT_FRAGMENT_TYPE) {
          if (child.tag === Fragment) {
            this.deleteRemainingChildren(returnFiber, child.sibling);
            const existing = this.useFiber(child, element.props["children"]);
            if (enableFragmentRefs) {
              coerceRef(existing, element);
            }
            existing.return = returnFiber;
            if (isDevelopment) {
              existing._debugOwner = element._owner as Fiber | null;
              existing._debugInfo = currentDebugInfo;
            }
            validateFragmentProps(element, existing, returnFiber);
            return existing;
          }
        } else {
          if (
            child.elementType === elementType ||
            // Keep this check inline so it only runs on the false path:
            (isDevelopment ? isCompatibleFamilyForHotReloading(child, element) : false) ||
            // Lazy types should reconcile their resolved type.
            // We need to do this after the Hot Reloading check above,
            // because hot reloading has different semantics than prod because
            // it doesn't resuspend. So we can't let the call below suspend.
            (isLazyChild(elementType) && resolveLazy(elementType) === child.type)
          ) {
            this.deleteRemainingChildren(returnFiber, child.sibling);
            const existing = this.useFiber(child, element.props);
            coerceRef(existing, element);
            existing.return = returnFiber;
            if (isDevelopment) {
              existing._debugOwner = element._owner as Fiber | null;
              existing._debugInfo = currentDebugInfo;
            }
            return existing;
          }
        }
        // Didn't match.
        this.deleteRemainingChildren(returnFiber, child);
        break;
      } else {
        this.deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    if (element.type === REACT_FRAGMENT_TYPE) {
      const created = createFiberFromFragment(element.props["children"], returnFiber.mode, lanes, element.key);
      if (enableFragmentRefs) {
        coerceRef(created, element);
      }
      created.return = returnFiber;
      if (isDevelopment) {
        // We treat the parent as the owner for stack purposes.
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      validateFragmentProps(element, created, returnFiber);
      return created;
    }
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    coerceRef(created, element);
    created.return = returnFiber;
    if (isDevelopment) {
      created._debugInfo = currentDebugInfo;
    }
    return created;
  }

  reconcileSinglePortal(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        if (
          child.tag === HostPortal &&
          (child.stateNode as PortalStateNode).containerInfo === portal.containerInfo &&
          (child.stateNode as PortalStateNode).implementation === portal.implementation
        ) {
          this.deleteRemainingChildren(returnFiber, child.sibling);
          const existing = this.useFiber(child, portal.children || []);
          existing.return = returnFiber;
          return existing;
        }
        this.deleteRemainingChildren(returnFiber, child);
        break;
      } else {
        this.deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.
  reconcileChildFibersImpl(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildIn: Child,
    lanes: Lanes,
  ): Fiber | null {
    // This function is only recursive for Usables/Lazy and not nested arrays.
    // That's so that using a Lazy wrapper is unobservable to the Fragment
    // convention.
    // If the top level item is an array, we treat it as a set of children,
    // not as a fragment. Nested arrays on the other hand will be treated as
    // fragment nodes. Recursion happens at the normal flow.

    // Handle top level unkeyed fragments without refs (enableFragmentRefs)
    // as if they were arrays. This leads to an ambiguity between <>{[...]}</> and <>...</>.
    // We treat the ambiguous cases above the same.
    // We don't use recursion here because a fragment inside a fragment
    // is no longer considered "top level" for these purposes.
    let newChild = newChildIn;
    if (typeof newChild === "object" && newChild !== null) {
      const maybeFragment = newChild as ReactElement;
      const isUnkeyedUnrefedTopLevelFragment =
        maybeFragment.type === REACT_FRAGMENT_TYPE &&
        maybeFragment.key === null &&
        (enableFragmentRefs ? maybeFragment.props["ref"] === undefined : true);
      if (isUnkeyedUnrefedTopLevelFragment) {
        validateFragmentProps(maybeFragment, null, returnFiber);
        newChild = maybeFragment.props["children"];
      }
    }

    // Handle object types
    if (typeof newChild === "object" && newChild !== null) {
      const tagged = newChild as TaggedChild;
      switch (tagged.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const element = newChild as ReactElement;
          const prevDebugInfo = pushDebugInfo(element._debugInfo);
          const firstChild = this.placeSingleChild(
            this.reconcileSingleElement(returnFiber, currentFirstChild, element, lanes),
          );
          currentDebugInfo = prevDebugInfo;
          return firstChild;
        }
        case REACT_PORTAL_TYPE:
          return this.placeSingleChild(
            this.reconcileSinglePortal(returnFiber, currentFirstChild, newChild as ReactPortal, lanes),
          );
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
          const result = resolveLazy(newChild as LazyComponent<unknown, unknown>);
          const firstChild = this.reconcileChildFibersImpl(returnFiber, currentFirstChild, result, lanes);
          currentDebugInfo = prevDebugInfo;
          return firstChild;
        }
      }

      if (Array.isArray(newChild)) {
        // We created a Fragment for this child with the debug info.
        // No need to push again.
        return this.reconcileChildrenArray(returnFiber, currentFirstChild, newChild, lanes);
      }

      if (getIteratorFn(newChild)) {
        // We created a Fragment for this child with the debug info.
        // No need to push again.
        return this.reconcileChildrenIteratable(returnFiber, currentFirstChild, newChild, lanes);
      }

      if (hasAsyncIterator(newChild)) {
        // We created a Fragment for this child with the debug info.
        // No need to push again.
        return this.reconcileChildrenAsyncIteratable(
          returnFiber,
          currentFirstChild,
          newChild as AsyncIterable<unknown>,
          lanes,
        );
      }

      // Usables are a valid React node type. When React encounters a Usable in
      // a child position, it unwraps it using the same algorithm as `use`. For
      // example, for promises, React will throw an exception to unwind the
      // stack, then replay the component once the promise resolves.
      //
      // A difference from `use` is that React will keep unwrapping the value
      // until it reaches a non-Usable type.
      //
      // e.g. Usable<Usable<Usable<T>>> should resolve to T
      //
      // The structure is a bit unfortunate. Ideally, we shouldn't need to
      // replay the entire begin phase of the parent fiber in order to reconcile
      // the children again. This would require a somewhat significant refactor,
      // because reconcilation happens deep within the begin phase, and
      // depending on the type of work, not always at the end. We should
      // consider as an future improvement.
      if (typeof tagged.then === "function") {
        const thenable = newChild as Thenable<unknown>;
        const prevDebugInfo = pushDebugInfo(tagged._debugInfo);
        const firstChild = this.reconcileChildFibersImpl(returnFiber, currentFirstChild, unwrapThenable(thenable), lanes);
        currentDebugInfo = prevDebugInfo;
        return firstChild;
      }

      if (tagged.$$typeof === REACT_CONTEXT_TYPE) {
        const context = newChild as ReactContextBase;
        return this.reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          readContextDuringReconciliation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (isTextChild(newChild)) {
      return this.placeSingleChild(this.reconcileSingleTextNode(returnFiber, currentFirstChild, "" + newChild, lanes));
    }

    warnOnInvalidPrimitive(returnFiber, newChild);

    // Remaining cases are all treated as empty.
    return this.deleteRemainingChildren(returnFiber, currentFirstChild);
  }

  reconcileChildFibers(returnFiber: Fiber, currentFirstChild: Fiber | null, newChild: Child, lanes: Lanes): Fiber | null {
    const prevDebugInfo = currentDebugInfo;
    currentDebugInfo = null;
    try {
      // This indirection only exists so we can reset `thenableState` at the end.
      // It should get inlined by Closure.
      thenableIndexCounter = 0;
      const firstChildFiber = this.reconcileChildFibersImpl(returnFiber, currentFirstChild, newChild, lanes);
      thenableState = null;
      // Don't bother to reset `thenableIndexCounter` to 0 because it always gets
      // set at the beginning.
      return firstChildFiber;
    } catch (x) {
      if (
        x === SuspenseException ||
        x === SuspenseActionException ||
        (!disableLegacyMode &&
          (returnFiber.mode & ConcurrentMode) === NoMode &&
          typeof x === "object" &&
          x !== null &&
          typeof (x as { then?: unknown }).then === "function")
      ) {
        // Suspense exceptions need to read the current suspended state before
        // yielding and replay it using the same sequence so this trick doesn't
        // work here.
        // Suspending in legacy mode actually mounts so if we let the child
        // mount then we delete its state in an update.
        throw x;
      }
      // Something errored during reconciliation but it's conceptually a child that
      // errored and not the current component itself so we create a virtual child
      // that throws in its begin phase. That way the current component can handle
      // the error or suspending if needed.
      const throwFiber = createFiberFromThrow(x, returnFiber.mode, lanes);
      throwFiber.return = returnFiber;
      if (isDevelopment) {
        // Read through a function: control flow would otherwise keep the
        // `null` assigned on entry, not seeing that reconciliation set it.
        const debugInfo = readCurrentDebugInfo();
        throwFiber._debugInfo = debugInfo;
        // Conceptually the error's owner should ideally be captured when the
        // Error constructor is called but we don't override them to capture our
        // `owner`. So instead, we use the nearest parent as the owner/task of the
        // error. This is usually the same thing when it's thrown from the same
        // async component but not if you await a promise started from a different
        // component/task.
        // In newer Chrome, Error constructor does capture the Task which is what
        // is logged by reportError. In that case this debugTask isn't used.
        throwFiber._debugOwner = returnFiber._debugOwner;
        throwFiber._debugTask = returnFiber._debugTask;
        if (debugInfo != null) {
          for (let i = debugInfo.length - 1; i >= 0; i--) {
            const info = debugInfo[i] as ComponentDebugInfo;
            if (typeof info.stack === "string") {
              // Upstream also makes this Server Component the owner, which
              // needs Fiber._debugOwner to admit a ReactComponentInfo; only
              // the task is carried until it does.
              throwFiber._debugTask = info.debugTask;
              break;
            }
          }
        }
      }
      return throwFiber;
    } finally {
      currentDebugInfo = prevDebugInfo;
    }
  }
}

const updatingReconciler = new ChildReconcilerImpl(true);
const mountingReconciler = new ChildReconcilerImpl(false);

export const reconcileChildFibers: ChildReconciler = (returnFiber, currentFirstChild, newChild, lanes) =>
  updatingReconciler.reconcileChildFibers(returnFiber, currentFirstChild, newChild, lanes);
export const mountChildFibers: ChildReconciler = (returnFiber, currentFirstChild, newChild, lanes) =>
  mountingReconciler.reconcileChildFibers(returnFiber, currentFirstChild, newChild, lanes);

export function resetChildReconcilerOnUnwind(): void {
  // On unwind, clear any pending thenables that were used.
  thenableState = null;
  thenableIndexCounter = 0;
}

export function cloneChildFibers(current: Fiber | null, workInProgress: Fiber): void {
  if (current !== null && workInProgress.child !== current.child) {
    throw new Error("Resuming work not yet implemented.");
  }

  if (workInProgress.child === null) {
    return;
  }

  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  workInProgress.child = newChild;

  newChild.return = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(currentChild, currentChild.pendingProps);
    newChild.return = workInProgress;
  }
  newChild.sibling = null;
}

// Reset a workInProgress child set to prepare it for a second pass.
export function resetChildFibers(workInProgress: Fiber, lanes: Lanes): void {
  let child = workInProgress.child;
  while (child !== null) {
    resetWorkInProgress(child, lanes);
    child = child.sibling;
  }
}

function validateSuspenseListNestedChild(childSlot: unknown, index: number): boolean {
  if (isDevelopment) {
    const isAnArray = Array.isArray(childSlot);
    const isIterable = !isAnArray && typeof getIteratorFn(childSlot) === "function";
    const isAsyncIterable = typeof childSlot === "object" && childSlot !== null && hasAsyncIterator(childSlot);
    if (isAnArray || isIterable || isAsyncIterable) {
      const type = isAnArray ? "array" : isAsyncIterable ? "async iterable" : "iterable";
      console.error(
        "A nested %s was passed to row #%s in <SuspenseList />. Wrap it in " +
          "an additional SuspenseList to configure its revealOrder: " +
          "<SuspenseList revealOrder=...> ... " +
          "<SuspenseList revealOrder=...>{%s}</SuspenseList> ... " +
          "</SuspenseList>",
        type,
        index,
        type,
      );
      return false;
    }
  }
  return true;
}

export function validateSuspenseListChildren(children: unknown, revealOrder: SuspenseListRevealOrder): void {
  if (isDevelopment) {
    if (
      (revealOrder == null ||
        revealOrder === "forwards" ||
        revealOrder === "backwards" ||
        revealOrder === "unstable_legacy-backwards") &&
      children !== undefined &&
      children !== null &&
      children !== false
    ) {
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          if (!validateSuspenseListNestedChild(children[i], i)) {
            return;
          }
        }
      } else {
        const iteratorFn = getIteratorFn(children);
        if (typeof iteratorFn === "function") {
          const childrenIterator = iteratorFn.call(children);
          if (childrenIterator) {
            let step = childrenIterator.next();
            let i = 0;
            for (; !step.done; step = childrenIterator.next()) {
              if (!validateSuspenseListNestedChild(step.value, i)) {
                return;
              }
              i++;
            }
          }
        } else if (typeof children === "object" && hasAsyncIterator(children)) {
          // TODO: Technically we should warn for nested arrays inside the
          // async iterable but it would require unwrapping the array.
          // However, this mistake is not as easy to make so it's ok not to warn.
        } else if (
          enableAsyncIterableChildren &&
          (children as { $$typeof?: unknown }).$$typeof === REACT_ELEMENT_TYPE &&
          typeof (children as ReactElement).type === "function" &&
          (Object.prototype.toString.call((children as ReactElement).type) === "[object GeneratorFunction]" ||
            Object.prototype.toString.call((children as ReactElement).type) === "[object AsyncGeneratorFunction]")
        ) {
          console.error(
            'A generator Component was passed to a <SuspenseList revealOrder="%s" />. ' +
              "This is not supported as a way to generate lists. Instead, pass an " +
              "iterable as the children.",
            revealOrder,
          );
        } else {
          console.error(
            'A single row was passed to a <SuspenseList revealOrder="%s" />. ' +
              "This is not useful since it needs multiple rows. " +
              "Did you mean to pass multiple children or an array?",
            revealOrder,
          );
        }
      }
    }
  }
}

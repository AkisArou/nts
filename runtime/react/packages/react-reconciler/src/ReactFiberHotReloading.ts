// React Refresh support, development only: the refresh runtime installs a
// handler through the DevTools hook that resolves a component type to its
// "family", so an edited component keeps its state.

import { isDevelopment } from "shared/Build.ts";
import { REACT_FORWARD_REF_TYPE, REACT_LAZY_TYPE, REACT_MEMO_TYPE } from "shared/ReactSymbols.ts";
import type { ReactElement } from "shared/ReactTypes.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import { flushPendingEffects, flushSyncWork, scheduleUpdateOnFiber } from "./ReactFiberWorkLoop.ts";
import { enqueueConcurrentRenderForLane } from "./ReactFiberConcurrentUpdates.ts";
import { updateContainerSync } from "./ReactFiberReconciler.ts";
import { emptyContextObject } from "./ReactFiberLegacyContext.ts";
import { SyncLane } from "./ReactFiberLane.ts";
import { ClassComponent, ForwardRef, FunctionComponent, MemoComponent, SimpleMemoComponent } from "./ReactWorkTags.ts";

export interface Family {
  current: unknown;
}

export interface RefreshUpdate {
  staleFamilies: Set<Family>;
  updatedFamilies: Set<Family>;
}

// Resolves type to a family.
type RefreshHandler = (type: unknown) => Family | undefined;

// Used by React Refresh runtime through DevTools Global Hook.
export type SetRefreshHandler = (handler: RefreshHandler | null) => void;
export type ScheduleRefresh = (root: FiberRoot, update: RefreshUpdate) => void;
export type ScheduleRoot = (root: FiberRoot, element: unknown) => void;

let resolveFamily: RefreshHandler | null = null;
let failedBoundaries: WeakSet<Fiber> | null = null;

export const setRefreshHandler = (handler: RefreshHandler | null): void => {
  if (isDevelopment) {
    resolveFamily = handler;
  }
};

export function resolveTypeForHotReloading(type: unknown): unknown {
  if (isDevelopment) {
    if (resolveFamily === null) {
      // Hot reloading is disabled.
      return type;
    }
    const family = resolveFamily(type);
    if (family === undefined) {
      return type;
    }
    // Use the latest known implementation.
    return family.current;
  }
  return type;
}

function typeofOf(value: unknown): unknown {
  return typeof value === "object" && value !== null ? (value as { $$typeof?: unknown }).$$typeof : null;
}

export function isCompatibleFamilyForHotReloading(fiber: Fiber, element: ReactElement): boolean {
  if (!isDevelopment) {
    return false;
  }
  if (resolveFamily === null) {
    // Hot reloading is disabled.
    return false;
  }
  const resolve = resolveFamily;
  const prevType = fiber.elementType;
  const nextType = element.type;

  // If we got here, we know types aren't === equal.
  let needsCompareFamilies = false;
  const $$typeofNextType = typeofOf(nextType);

  switch (fiber.tag) {
    case ClassComponent: {
      if (typeof nextType === "function") {
        needsCompareFamilies = true;
      }
      break;
    }
    case FunctionComponent: {
      if (typeof nextType === "function") {
        needsCompareFamilies = true;
      } else if ($$typeofNextType === REACT_LAZY_TYPE) {
        // We don't know the inner type yet.
        // We're going to assume that the lazy inner type is stable,
        // and so it is sufficient to avoid reconciling it away.
        // We're not going to unwrap or actually use the new lazy type.
        needsCompareFamilies = true;
      }
      break;
    }
    case ForwardRef: {
      if ($$typeofNextType === REACT_FORWARD_REF_TYPE || $$typeofNextType === REACT_LAZY_TYPE) {
        needsCompareFamilies = true;
      }
      break;
    }
    case MemoComponent:
    case SimpleMemoComponent: {
      if ($$typeofNextType === REACT_MEMO_TYPE || $$typeofNextType === REACT_LAZY_TYPE) {
        needsCompareFamilies = true;
      }
      break;
    }
    default:
      return false;
  }

  // Check if both types have a family and it's the same one.
  if (needsCompareFamilies) {
    // Note: memo() and forwardRef() we'll compare outer rather than inner type.
    // This means both of them need to be registered to preserve state.
    // If we unwrapped and compared the inner types for wrappers instead,
    // then we would risk falsely saying two separate memo(Foo)
    // calls are equivalent because they wrap the same Foo function.
    const prevFamily = resolve(prevType);
    if (prevFamily !== undefined && prevFamily === resolve(nextType)) {
      return true;
    }
  }
  return false;
}

export function markFailedErrorBoundaryForHotReloading(fiber: Fiber): void {
  if (isDevelopment) {
    if (resolveFamily === null) {
      // Hot reloading is disabled.
      return;
    }
    if (typeof WeakSet !== "function") {
      return;
    }
    if (failedBoundaries === null) {
      failedBoundaries = new WeakSet();
    }
    failedBoundaries.add(fiber);
  }
}

export const scheduleRefresh: ScheduleRefresh = (root: FiberRoot, update: RefreshUpdate): void => {
  if (isDevelopment) {
    if (resolveFamily === null) {
      // Hot reloading is disabled.
      return;
    }
    const { staleFamilies, updatedFamilies } = update;
    flushPendingEffects();
    scheduleFibersWithFamiliesRecursively(root.current, updatedFamilies, staleFamilies);
    flushSyncWork();
  }
};

export const scheduleRoot: ScheduleRoot = (root: FiberRoot, element: unknown): void => {
  if (isDevelopment) {
    if (root.context !== emptyContextObject) {
      // Super edge case: root has a legacy _renderSubtree context
      // but we don't know the parentComponent so we can't pass it.
      // Just ignore. We'll delete this with _renderSubtree code path later.
      return;
    }
    updateContainerSync(element, root, null, null);
    flushSyncWork();
  }
};

function scheduleFibersWithFamiliesRecursively(
  start: Fiber,
  updatedFamilies: Set<Family>,
  staleFamilies: Set<Family>,
): void {
  if (!isDevelopment) {
    return;
  }
  let fiber = start;
  for (;;) {
    const { alternate, child, sibling, tag, type, elementType } = fiber;

    let candidateType: unknown = null;
    // Wrapper fibers (memo, forwardRef) resolve their family through the
    // inner implementation, but an edit that changes the kind of the type
    // (e.g. memo to a plain function) is only recorded on the family of the
    // outer type. Check the outer type too so such edits trigger a remount.
    let outerCandidateType: unknown = null;
    switch (tag) {
      case FunctionComponent:
      case ClassComponent:
        candidateType = type;
        break;
      case SimpleMemoComponent:
        candidateType = type;
        outerCandidateType = elementType;
        break;
      case MemoComponent:
        // Edits to the inner implementation are handled by the inner fiber.
        outerCandidateType = elementType;
        break;
      case ForwardRef:
        candidateType = (type as { render: unknown }).render;
        outerCandidateType = elementType;
        break;
      default:
        break;
    }

    if (resolveFamily === null) {
      throw new Error("Expected resolveFamily to be set during hot reload.");
    }
    const resolve = resolveFamily;

    let needsRender = false;
    let needsRemount = false;
    if (candidateType !== null) {
      const family = resolve(candidateType);
      if (family !== undefined) {
        if (staleFamilies.has(family)) {
          needsRemount = true;
        } else if (updatedFamilies.has(family)) {
          if (tag === ClassComponent) {
            needsRemount = true;
          } else {
            needsRender = true;
          }
        }
      }
    }
    if (!needsRemount && outerCandidateType !== null) {
      const outerFamily = resolve(outerCandidateType);
      if (outerFamily !== undefined && staleFamilies.has(outerFamily)) {
        needsRemount = true;
      } else if (typeofOf(outerCandidateType) === REACT_LAZY_TYPE) {
        const payload = (outerCandidateType as { _payload: { _status: number; _result: { default?: unknown } } })._payload;
        if (payload._status === 1 /* Resolved; see ReactLazy */) {
          const middleFamily = resolve(payload._result.default);
          if (middleFamily !== undefined && staleFamilies.has(middleFamily)) {
            needsRemount = true;
          }
        }
      }
    }
    if (failedBoundaries !== null) {
      if (failedBoundaries.has(fiber) || (alternate !== null && failedBoundaries.has(alternate))) {
        needsRemount = true;
      }
    }

    if (needsRemount) {
      fiber._debugNeedsRemount = true;
    }
    if (needsRemount || needsRender) {
      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
    }
    if (child !== null && !needsRemount) {
      scheduleFibersWithFamiliesRecursively(child, updatedFamilies, staleFamilies);
    }

    if (sibling === null) {
      break;
    }
    fiber = sibling;
  }
}

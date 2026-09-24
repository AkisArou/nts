// Unwinding: popping the contexts a fiber pushed when its work is abandoned,
// either because something below it threw (unwindWork, which may also turn
// the fiber into the boundary that captures) or because the render was
// interrupted (unwindInterruptedWork).

import { enableProfilerTimer, enableTransitionTracing } from "shared/ReactFeatureFlags.ts";
import type { ReactContext } from "shared/ReactTypes.ts";
import type { ActivityState } from "./ReactFiberActivityComponent.ts";
import type { Cache } from "./ReactFiberCacheComponent.ts";
import { popCacheProvider } from "./ReactFiberCacheComponent.ts";
import { DidCapture, NoFlags, ShouldCapture, Update } from "./ReactFiberFlags.ts";
import { popHiddenContext } from "./ReactFiberHiddenContext.ts";
import { popHostContainer, popHostContext } from "./ReactFiberHostContext.ts";
import { resetHydrationState } from "./ReactFiberHydrationContext.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from "./ReactFiberLegacyContext.ts";
import { popProvider } from "./ReactFiberNewContext.ts";
import type { SuspenseListRenderState, SuspenseState } from "./ReactFiberSuspenseComponent.ts";
import { popSuspenseHandler, popSuspenseListContext } from "./ReactFiberSuspenseContext.ts";
import type { TracingMarkerInstance } from "./ReactFiberTracingMarkerComponent.ts";
import { popMarkerInstance, popRootMarkerInstance } from "./ReactFiberTracingMarkerComponent.ts";
import { popRootTransition, popTransition } from "./ReactFiberTransition.ts";
import { popTreeContext } from "./ReactFiberTreeContext.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import { transferActualDuration } from "./ReactProfilerTimer.ts";
import { NoMode, ProfileMode } from "./ReactTypeOfMode.ts";
import {
  ActivityComponent,
  CacheComponent,
  ClassComponent,
  ContextProvider,
  HostComponent,
  HostHoistable,
  HostPortal,
  HostRoot,
  HostSingleton,
  LegacyHiddenComponent,
  OffscreenComponent,
  SuspenseComponent,
  SuspenseListComponent,
  TracingMarkerComponent,
} from "./ReactWorkTags.ts";

// The cache a HostRoot or CacheComponent fiber holds in its state.
function cacheOf(fiber: Fiber): Cache {
  return (fiber.memoizedState as { cache: Cache }).cache;
}

// Turns a ShouldCapture flag into DidCapture: this fiber is the boundary
// that re-renders. Returns whether it captured.
function captureIfShould(workInProgress: Fiber): boolean {
  const flags = workInProgress.flags;
  if (flags & ShouldCapture) {
    workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
    // Captured a suspense effect. Re-render the boundary.
    if (enableProfilerTimer && (workInProgress.mode & ProfileMode) !== NoMode) {
      transferActualDuration(workInProgress);
    }
    return true;
  }
  return false;
}

function unwindWork(current: Fiber | null, workInProgress: Fiber, renderLanes: Lanes): Fiber | null {
  // Note: This intentionally doesn't check if we're hydrating because comparing
  // to the current tree provider fiber is just as fast and less error-prone.
  // Ideally we would have a special version of the work loop only
  // for hydration.
  popTreeContext(workInProgress);
  switch (workInProgress.tag) {
    case ClassComponent: {
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      return captureIfShould(workInProgress) ? workInProgress : null;
    }
    case HostRoot: {
      const root = workInProgress.stateNode as FiberRoot;
      popCacheProvider(workInProgress, cacheOf(workInProgress));

      if (enableTransitionTracing) {
        popRootMarkerInstance(workInProgress);
      }

      popRootTransition(workInProgress, root, renderLanes);
      popHostContainer(workInProgress);
      popTopLevelLegacyContextObject(workInProgress);
      const flags = workInProgress.flags;
      if ((flags & ShouldCapture) !== NoFlags && (flags & DidCapture) === NoFlags) {
        // There was an error during render that wasn't captured by a suspense
        // boundary. Do a second pass on the root to unmount the children.
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        return workInProgress;
      }
      // We unwound to the root without completing it. Exit.
      return null;
    }
    case HostHoistable:
    case HostSingleton:
    case HostComponent: {
      // TODO: popHydrationState
      popHostContext(workInProgress);
      return null;
    }
    case ActivityComponent: {
      const activityState = workInProgress.memoizedState as ActivityState | null;
      if (activityState !== null) {
        popSuspenseHandler(workInProgress);
        if (workInProgress.alternate === null) {
          throw new Error(
            "Threw in newly mounted dehydrated component. This is likely a bug in " + "React. Please file an issue.",
          );
        }
        resetHydrationState();
      }
      return captureIfShould(workInProgress) ? workInProgress : null;
    }
    case SuspenseComponent: {
      popSuspenseHandler(workInProgress);
      const suspenseState = workInProgress.memoizedState as SuspenseState | null;
      if (suspenseState !== null && suspenseState.dehydrated !== null) {
        if (workInProgress.alternate === null) {
          throw new Error(
            "Threw in newly mounted dehydrated component. This is likely a bug in " + "React. Please file an issue.",
          );
        }
        resetHydrationState();
      }
      return captureIfShould(workInProgress) ? workInProgress : null;
    }
    case SuspenseListComponent: {
      popSuspenseListContext(workInProgress);
      // SuspenseList doesn't normally catch anything. It should've been
      // caught by a nested boundary. If not, it should bubble through.
      const flags = workInProgress.flags;
      if (flags & ShouldCapture) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        // If we caught something on the SuspenseList itself it's because
        // we want to ignore something. Re-enter the cycle and handle it
        // in the complete phase.
        const renderState = workInProgress.memoizedState as SuspenseListRenderState | null;
        if (renderState !== null) {
          // Cut off any remaining tail work and don't commit the rendering one.
          // This assumes that we have already confirmed that none of these are
          // already mounted.
          renderState.rendering = null;
          renderState.tail = null;
        }
        // Schedule the commit phase to attach retry listeners.
        workInProgress.flags |= Update;
        return workInProgress;
      }
      return null;
    }
    case HostPortal:
      popHostContainer(workInProgress);
      return null;
    case ContextProvider: {
      const context = workInProgress.type as ReactContext<unknown>;
      popProvider(context, workInProgress);
      return null;
    }
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      popSuspenseHandler(workInProgress);
      popHiddenContext(workInProgress);
      popTransition(workInProgress, current);
      return captureIfShould(workInProgress) ? workInProgress : null;
    }
    case CacheComponent:
      popCacheProvider(workInProgress, cacheOf(workInProgress));
      return null;
    case TracingMarkerComponent:
      if (enableTransitionTracing) {
        if (workInProgress.stateNode !== null) {
          popMarkerInstance(workInProgress);
        }
      }
      return null;
    default:
      return null;
  }
}

function unwindInterruptedWork(current: Fiber | null, interruptedWork: Fiber, renderLanes: Lanes): void {
  // Note: This intentionally doesn't check if we're hydrating because comparing
  // to the current tree provider fiber is just as fast and less error-prone.
  // Ideally we would have a special version of the work loop only
  // for hydration.
  popTreeContext(interruptedWork);
  switch (interruptedWork.tag) {
    case ClassComponent: {
      const childContextTypes = (interruptedWork.type as { childContextTypes?: unknown }).childContextTypes;
      if (childContextTypes !== null && childContextTypes !== undefined) {
        popLegacyContext(interruptedWork);
      }
      break;
    }
    case HostRoot: {
      const root = interruptedWork.stateNode as FiberRoot;
      popCacheProvider(interruptedWork, cacheOf(interruptedWork));

      if (enableTransitionTracing) {
        popRootMarkerInstance(interruptedWork);
      }

      popRootTransition(interruptedWork, root, renderLanes);
      popHostContainer(interruptedWork);
      popTopLevelLegacyContextObject(interruptedWork);
      break;
    }
    case HostHoistable:
    case HostSingleton:
    case HostComponent: {
      popHostContext(interruptedWork);
      break;
    }
    case HostPortal:
      popHostContainer(interruptedWork);
      break;
    case ActivityComponent: {
      if (interruptedWork.memoizedState !== null) {
        popSuspenseHandler(interruptedWork);
      }
      break;
    }
    case SuspenseComponent:
      popSuspenseHandler(interruptedWork);
      break;
    case SuspenseListComponent:
      popSuspenseListContext(interruptedWork);
      break;
    case ContextProvider: {
      const context = interruptedWork.type as ReactContext<unknown>;
      popProvider(context, interruptedWork);
      break;
    }
    case OffscreenComponent:
    case LegacyHiddenComponent:
      popSuspenseHandler(interruptedWork);
      popHiddenContext(interruptedWork);
      popTransition(interruptedWork, current);
      break;
    case CacheComponent:
      popCacheProvider(interruptedWork, cacheOf(interruptedWork));
      break;
    case TracingMarkerComponent:
      if (enableTransitionTracing) {
        const instance = interruptedWork.stateNode as TracingMarkerInstance | null;
        if (instance !== null) {
          popMarkerInstance(interruptedWork);
        }
      }
      break;
    default:
      break;
  }
}

export { unwindInterruptedWork, unwindWork };

// The commit phase: the traversals that apply a finished work-in-progress
// tree to the host and run its effects, in the order React guarantees.
//
// Each phase is a recursive traversal of the finished tree that skips
// subtrees without the relevant flags:
//   - before mutation: class snapshots, clearing the container, view
//     transition names;
//   - mutation: deletions (with their unmount effects), placements, host
//     updates, insertion effects, layout-effect destroys, ref detaches,
//     hiding and unhiding Offscreen subtrees;
//   - layout: layout effects, class lifecycles, ref attaches;
//   - passive (later, asynchronously): passive effect destroys, then creates.
//
// Port of upstream's ReactFiberCommitWork.js (stable channel).

import type {
  Container,
  FormInstance,
  FragmentInstanceType,
  HoistableRoot,
  Instance,
  Props,
  SuspendedState,
  SuspenseInstance,
  TextInstance,
} from "react-reconciler/ReactFiberConfig.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import {
  includesLoadingIndicatorLanes,
  includesOnlySuspenseyCommitEligibleLanes,
  includesOnlyViewTransitionEligibleLanes,
} from "./ReactFiberLane.ts";
import type { ActivityState } from "./ReactFiberActivityComponent.ts";
import type { RetryQueue, SuspenseState } from "./ReactFiberSuspenseComponent.ts";
import type { FunctionComponentUpdateQueue } from "./ReactFiberHooks.ts";
import type { Transition, Wakeable } from "shared/ReactTypes.ts";
import type { OffscreenInstance, OffscreenQueue, OffscreenState } from "./ReactFiberOffscreenComponent.ts";
import type { Cache } from "./ReactFiberCacheComponent.ts";
import type { RootState } from "./ReactFiberRoot.ts";
import type { ViewTransitionProps, ViewTransitionState } from "./ReactFiberViewTransitionComponent.ts";
import type { Flags } from "./ReactFiberFlags.ts";

import { isDevelopment } from "shared/Build.ts";
import {
  alwaysThrottleRetries,
  disableLegacyMode,
  enableComponentPerformanceTrack,
  enableDefaultTransitionIndicator,
  enableEffectEventMutationPhase,
  enableFragmentRefs,
  enableFragmentRefsTextNodes,
  enableProfilerCommitHooks,
  enableProfilerTimer,
  enableUpdaterTracking,
  enableViewTransition,
} from "shared/ReactFeatureFlags.ts";
import {
  ActivityComponent,
  CacheComponent,
  ClassComponent,
  DehydratedFragment,
  ForwardRef,
  Fragment,
  FunctionComponent,
  HostComponent,
  HostHoistable,
  HostPortal,
  HostRoot,
  HostSingleton,
  HostText,
  IncompleteClassComponent,
  LegacyHiddenComponent,
  MemoComponent,
  OffscreenComponent,
  Profiler,
  ScopeComponent,
  SimpleMemoComponent,
  SuspenseComponent,
  SuspenseListComponent,
  TracingMarkerComponent,
  ViewTransitionComponent,
} from "./ReactWorkTags.ts";
import {
  AffectedParentLayout,
  BeforeAndAfterMutationTransitionMask,
  BeforeMutationMask,
  Callback,
  ChildDeletion,
  Cloned,
  ContentReset,
  DidCapture,
  ForceClientRender,
  FormReset,
  Hydrate,
  Hydrating,
  LayoutMask,
  MaySuspendCommit,
  MutationMask,
  NoFlags,
  Passive,
  PassiveMask,
  PassiveTransitionMask,
  PerformedWork,
  Placement,
  PortalStatic,
  Ref,
  ShouldSuspendCommit,
  Snapshot,
  Update,
  ViewTransitionNamedStatic,
  Visibility,
} from "./ReactFiberFlags.ts";
import {
  bubbleNestedEffectDurations,
  commitStartTime,
  componentEffectDuration,
  componentEffectEndTime,
  componentEffectErrors,
  componentEffectSpawnedUpdate,
  componentEffectStartTime,
  popComponentEffectDidSpawnUpdate,
  popComponentEffectDuration,
  popComponentEffectErrors,
  popComponentEffectStart,
  popNestedEffectDurations,
  pushComponentEffectDidSpawnUpdate,
  pushComponentEffectDuration,
  pushComponentEffectErrors,
  pushComponentEffectStart,
  pushNestedEffectDurations,
  resetComponentEffectTimers,
} from "./ReactProfilerTimer.ts";
import {
  logComponentDisappeared,
  logComponentEffect,
  logComponentErrored,
  logComponentMount,
  logComponentReappeared,
  logComponentRender,
  logComponentUnmount,
  popDeepEquality,
  pushDeepEquality,
} from "./ReactFiberPerformanceTrack.ts";
import { ConcurrentMode, NoMode, ProfileMode } from "./ReactTypeOfMode.ts";
import { deferHiddenCallbacks, type UpdateQueue } from "./ReactFiberClassUpdateQueue.ts";
import {
  acquireResource,
  clearContainer,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  createContainerChildSet,
  createHoistableInstance,
  detachDeletedInstance,
  getHoistableRoot,
  hydrateHoistable,
  isSingletonScope,
  maySuspendCommitInSyncRender,
  mountHoistable,
  prepareForCommit,
  prepareToCommitHoistables,
  registerSuspenseInstanceRetry,
  releaseResource,
  resetFormInstance,
  cancelRootViewTransitionName,
  cancelViewTransitionName,
  restoreRootViewTransitionName,
  supportsHydration,
  supportsMutation,
  supportsPersistence,
  supportsResources,
  supportsSingletons,
  suspendInstance,
  suspendResource,
  unmountHoistable,
  updateFragmentInstanceFiber,
} from "react-reconciler/ReactFiberConfig.ts";
import {
  markCommitTimeOfFallback,
  resolveRetryWakeable,
  restorePendingUpdaters,
  retryDehydratedSuspenseBoundary,
  scheduleViewTransitionEvent,
} from "./ReactFiberWorkLoop.ts";
import {
  HasEffect as HookHasEffect,
  Insertion as HookInsertion,
  Layout as HookLayout,
  Passive as HookPassive,
} from "./ReactHookEffectTags.ts";
import { isDevToolsPresent, onCommitUnmount } from "./ReactFiberDevToolsHook.ts";
import { releaseCache, retainCache } from "./ReactFiberCacheComponent.ts";
import { OffscreenPassiveEffectsConnected, OffscreenVisible } from "./ReactFiberOffscreenComponent.ts";
import { getViewTransitionClassName } from "./ReactFiberViewTransitionComponent.ts";
import {
  commitClassCallbacks,
  commitClassDidMount,
  commitClassHiddenCallbacks,
  commitClassLayoutLifecycles,
  commitClassSnapshot,
  commitHookEffectListMount,
  commitHookEffectListUnmount,
  commitHookLayoutEffects,
  commitHookLayoutUnmountEffects,
  commitHookPassiveMountEffects,
  commitHookPassiveUnmountEffects,
  commitProfilerPostCommit,
  commitProfilerUpdate,
  commitRootCallbacks,
  safelyAttachRef,
  safelyCallComponentWillUnmount,
  safelyDetachRef,
  type CommitClassInstance,
} from "./ReactFiberCommitEffects.ts";
import {
  commitHostHydratedActivity,
  commitHostHydratedContainer,
  commitHostHydratedInstance,
  commitHostHydratedSuspense,
  commitHostMount,
  commitHostPlacement,
  commitHostPortalContainerChildren,
  commitHostRemoveChild,
  commitHostRemoveChildFromContainer,
  commitHostResetTextContent,
  commitHostRootContainerChildren,
  commitHostSingletonAcquisition,
  commitHostSingletonRelease,
  commitHostTextUpdate,
  commitHostUpdate,
  commitShowHideHostInstance,
  commitShowHideHostTextInstance,
  commitShowHideSuspenseBoundary,
  type PortalStateNode,
} from "./ReactFiberCommitHostEffects.ts";
import {
  commitFragmentInstanceDeletionEffects,
  commitFragmentInstanceInsertionEffects,
} from "./ReactFiberFragmentInstance.ts";
import {
  commitBeforeUpdateViewTransition,
  commitEnterViewTransitions,
  commitExitViewTransitions,
  commitNestedViewTransitions,
  measureNestedViewTransitions,
  measureUpdateViewTransition,
  popViewTransitionCancelableScope,
  pushViewTransitionCancelableScope,
  resetAppearingViewTransitions,
  restoreEnterOrExitViewTransitions,
  restoreNestedViewTransitions,
  restoreUpdateViewTransition,
  trackAppearingViewTransition,
  trackEnterViewTransitions,
  viewTransitionCancelableChildren,
} from "./ReactFiberCommitViewTransitions.ts";
import {
  popMutationContext,
  pushMutationContext,
  pushRootMutationContext,
  rootMutationContext,
  viewTransitionMutationContext,
} from "./ReactFiberMutationTracking.ts";
import { trackNamedViewTransition, untrackNamedViewTransition } from "./ReactFiberDuplicateViewTransitions.ts";
import { markIndicatorHandled } from "./ReactFiberRootScheduler.ts";

// enableTransitionTracing, enableScopeAPI, enableSuspenseCallback,
// enableCreateEventHandleAPI and enableLegacyHidden are off in the stable
// channel: the code that only runs under them is not ported, and each place
// it was is marked with the flag's name.

type LayoutEffectTraversalFlags = number;

const NoLayoutEffectTraversalFlags = 0b00;
const IncludeWorkInProgressEffects = 0b01;
const IncludeHostSingletons = 0b10;

// A Profiler's stateNode: the effect durations it accumulates for its
// onCommit and onPostCommit callbacks.
interface ProfilerStateNode {
  effectDuration: number;
  passiveEffectDuration: number;
}

// Used during the commit phase to track the state of the Offscreen component
// stack. Allows us to avoid traversing the return path to find the nearest
// Offscreen ancestor.
let offscreenSubtreeIsHidden = false;
let offscreenSubtreeWasHidden = false;
// Track whether there's a hidden offscreen above with no HostComponent
// between. If so, it overrides the hiddenness of the HostComponent below.
let offscreenDirectParentIsHidden = false;

// Used to track if a form needs to be reset at the end of the mutation phase.
let needsFormReset = false;

let nextEffect: Fiber | null = null;

// Used for Profiling builds to track updaters.
let inProgressLanes: Lanes | null = null;
let inProgressRoot: FiberRoot | null = null;

export let shouldFireAfterActiveInstanceBlur = false;

// Used during the commit phase to track whether a parent ViewTransition
// component might have been affected by any mutations / relayouts below.
let viewTransitionContextChanged = false;
let inUpdateViewTransition = false;
let rootViewTransitionAffected = false;
let rootViewTransitionNameCanceled = false;

function isHydratingParent(current: Fiber, finishedWork: Fiber): boolean {
  if (finishedWork.tag === ActivityComponent) {
    const prevState = current.memoizedState as ActivityState | null;
    const nextState = finishedWork.memoizedState as ActivityState | null;
    return prevState !== null && nextState === null;
  } else if (finishedWork.tag === SuspenseComponent) {
    const prevState = current.memoizedState as SuspenseState | null;
    const nextState = finishedWork.memoizedState as SuspenseState | null;
    return prevState !== null && prevState.dehydrated !== null && (nextState === null || nextState.dehydrated === null);
  } else if (finishedWork.tag === HostRoot) {
    return (current.memoizedState as RootState).isDehydrated && (finishedWork.flags & ForceClientRender) === NoFlags;
  } else {
    return false;
  }
}

export function commitBeforeMutationEffects(root: FiberRoot, firstChild: Fiber, committedLanes: Lanes): void {
  // prepareForCommit returns the focused instance handle, which only
  // enableCreateEventHandleAPI reads.
  prepareForCommit(root.containerInfo);
  shouldFireAfterActiveInstanceBlur = false;

  const isViewTransitionEligible = enableViewTransition && includesOnlyViewTransitionEligibleLanes(committedLanes);

  nextEffect = firstChild;
  commitBeforeMutationEffects_begin(isViewTransitionEligible);

  // We've found any matched pairs and can now reset.
  resetAppearingViewTransitions();
}

function commitBeforeMutationEffects_begin(isViewTransitionEligible: boolean): void {
  // If this commit is eligible for a View Transition we look into all mutated
  // subtrees.
  // TODO: We could optimize this by marking these with the Snapshot subtree
  // flag in the render phase.
  const subtreeMask = isViewTransitionEligible ? BeforeAndAfterMutationTransitionMask : BeforeMutationMask;
  while (nextEffect !== null) {
    const fiber: Fiber = nextEffect;

    // This phase is only used for beforeActiveInstanceBlur
    // (enableCreateEventHandleAPI) and view transitions.
    if (isViewTransitionEligible) {
      // TODO: Should wrap this in flags check, too, as optimization
      const deletions = fiber.deletions;
      if (deletions !== null) {
        for (let i = 0; i < deletions.length; i++) {
          const deletion = deletions[i]!;
          commitBeforeMutationEffectsDeletion(deletion, isViewTransitionEligible);
        }
      }
    }

    if (enableViewTransition && fiber.alternate === null && (fiber.flags & Placement) !== NoFlags) {
      // Skip before mutation effects of the children because we don't want
      // to trigger updates of any nested view transitions and we shouldn't
      // have any other before mutation effects since snapshot effects are
      // only applied to updates. TODO: Model this using only flags.
      if (isViewTransitionEligible) {
        trackEnterViewTransitions(fiber);
      }
      commitBeforeMutationEffects_complete(isViewTransitionEligible);
      continue;
    }

    // TODO: This should really unify with the switch in
    // commitBeforeMutationEffectsOnFiber recursively.
    if (enableViewTransition && fiber.tag === OffscreenComponent) {
      const isModernRoot = disableLegacyMode || (fiber.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const current = fiber.alternate;
        const isHidden = fiber.memoizedState !== null;
        if (isHidden) {
          if (current !== null && current.memoizedState === null && isViewTransitionEligible) {
            // Was previously mounted as visible but is now hidden.
            commitExitViewTransitions(current);
          }
          // Skip before mutation effects of the children because they're
          // hidden.
          commitBeforeMutationEffects_complete(isViewTransitionEligible);
          continue;
        } else if (current !== null && current.memoizedState !== null) {
          // Was previously mounted as hidden but is now visible.
          // Skip before mutation effects of the children because we don't
          // want to trigger updates of any nested view transitions and we
          // shouldn't have any other before mutation effects since snapshot
          // effects are only applied to updates.
          if (isViewTransitionEligible) {
            trackEnterViewTransitions(fiber);
          }
          commitBeforeMutationEffects_complete(isViewTransitionEligible);
          continue;
        }
      }
    }

    const child = fiber.child;
    if ((fiber.subtreeFlags & subtreeMask) !== NoFlags && child !== null) {
      child.return = fiber;
      nextEffect = child;
    } else {
      if (isViewTransitionEligible) {
        // We are inside an updated subtree. Any mutations that affected the
        // parent HostInstance's layout or set of children (such as reorders)
        // might have also affected the positioning or size of the inner
        // ViewTransitions. Therefore we need to find them inside.
        commitNestedViewTransitions(fiber);
      }
      commitBeforeMutationEffects_complete(isViewTransitionEligible);
    }
  }
}

function commitBeforeMutationEffects_complete(isViewTransitionEligible: boolean): void {
  while (nextEffect !== null) {
    const fiber: Fiber = nextEffect;
    commitBeforeMutationEffectsOnFiber(fiber, isViewTransitionEligible);

    const sibling = fiber.sibling;
    if (sibling !== null) {
      sibling.return = fiber.return;
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

function commitBeforeMutationEffectsOnFiber(finishedWork: Fiber, isViewTransitionEligible: boolean): void {
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  // enableCreateEventHandleAPI: the beforeActiveInstanceBlur check is not
  // ported.

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (!enableEffectEventMutationPhase && (flags & Update) !== NoFlags) {
        const updateQueue = finishedWork.updateQueue as FunctionComponentUpdateQueue | null;
        const eventPayloads = updateQueue !== null ? updateQueue.events : null;
        if (eventPayloads !== null) {
          for (let ii = 0; ii < eventPayloads.length; ii++) {
            const { ref, nextImpl } = eventPayloads[ii]!;
            ref.impl = nextImpl;
          }
        }
      }
      break;
    }
    case ClassComponent: {
      if ((flags & Snapshot) !== NoFlags) {
        if (current !== null) {
          commitClassSnapshot(finishedWork, current);
        }
      }
      break;
    }
    case HostRoot: {
      if ((flags & Snapshot) !== NoFlags) {
        if (supportsMutation) {
          const root = finishedWork.stateNode as FiberRoot;
          clearContainer(root.containerInfo);
        }
      }
      break;
    }
    case HostComponent:
    case HostHoistable:
    case HostSingleton:
    case HostText:
    case HostPortal:
    case IncompleteClassComponent:
      // Nothing to do for these component types
      break;
    case ViewTransitionComponent:
      if (enableViewTransition) {
        if (isViewTransitionEligible) {
          if (current === null) {
            // This is a new mount. We should have handled this as part of the
            // Placement effect or it is deeper inside a entering transition.
          } else {
            // Something may have mutated within this subtree. This might need
            // to cause a cross-fade of this parent. We first assign old names
            // to the previous tree in the before mutation phase in case we
            // need to.
            // TODO: This walks the tree that we might continue walking anyway.
            // We should just stash the parent ViewTransitionComponent and
            // continue walking the tree until we find HostComponent but to do
            // that we need to use a stack which requires refactoring this
            // phase.
            commitBeforeUpdateViewTransition(current, finishedWork);
          }
        }
        break;
      }
      // Upstream falls through to the default case.
      throwIfUnexpectedSnapshot(flags);
      break;
    default: {
      throwIfUnexpectedSnapshot(flags);
    }
  }
}

function throwIfUnexpectedSnapshot(flags: Flags): void {
  if ((flags & Snapshot) !== NoFlags) {
    throw new Error(
      "This unit of work tag should not have side-effects. This error is " +
        "likely caused by a bug in React. Please file an issue.",
    );
  }
}

function commitBeforeMutationEffectsDeletion(deletion: Fiber, isViewTransitionEligible: boolean): void {
  // enableCreateEventHandleAPI: the beforeActiveInstanceBlur check is not
  // ported.
  if (isViewTransitionEligible) {
    commitExitViewTransitions(deletion);
  }
}

function commitLayoutEffectOnFiber(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  committedLanes: Lanes,
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  // When updating this function, also update reappearLayoutEffects, which
  // does most of the same things when an offscreen tree goes from hidden ->
  // visible.
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      if (flags & Update) {
        commitHookLayoutEffects(finishedWork, HookLayout | HookHasEffect);
      }
      break;
    }
    case ClassComponent: {
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      if (flags & Update) {
        commitClassLayoutLifecycles(finishedWork, current);
      }

      if (flags & Callback) {
        commitClassCallbacks(finishedWork);
      }

      if (flags & Ref) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      if (flags & Callback) {
        commitRootCallbacks(finishedWork);
      }
      if (enableProfilerTimer && enableProfilerCommitHooks) {
        finishedRoot.effectDuration += popNestedEffectDurations(prevProfilerEffectDuration);
      }
      break;
    }
    case HostSingleton:
    case HostHoistable:
    case HostComponent: {
      if (finishedWork.tag === HostSingleton && supportsSingletons) {
        // We acquire the singleton instance first so it has appropriate
        // styles before other layout effects run. This isn't perfect because
        // an early sibling of the singleton may have an effect that can
        // observe the singleton before it is acquired.
        // @TODO move this to the mutation phase. The reason it isn't there
        // yet is it seemingly requires an extra traversal because we need to
        // move the disappear effect into a phase before the appear phase
        if (current === null && flags & Update) {
          // Unlike in the reappear path we only acquire on new mount
          commitHostSingletonAcquisition(finishedWork);
        }
      }
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);

      // Renderers may schedule work to be done after host components are
      // mounted (eg DOM renderer may schedule auto-focus for inputs and form
      // controls). These effects should only be committed when components
      // are first mounted, aka when there is no current/alternate.
      if (current === null) {
        if (flags & Update) {
          commitHostMount(finishedWork);
        } else if (flags & Hydrate) {
          commitHostHydratedInstance(finishedWork);
        }
      }

      if (flags & Ref) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      break;
    }
    case Profiler: {
      // TODO: Should this fire inside an offscreen tree? Or should it wait to
      // fire when the tree becomes visible again.
      if (flags & Update) {
        const prevProfilerEffectDuration = pushNestedEffectDurations();

        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);

        const profilerInstance = finishedWork.stateNode as ProfilerStateNode;

        if (enableProfilerTimer && enableProfilerCommitHooks) {
          // Propagate layout effect durations to the next nearest Profiler
          // ancestor. Do not reset these values until the next render so
          // DevTools has a chance to read them first.
          profilerInstance.effectDuration += bubbleNestedEffectDurations(prevProfilerEffectDuration);
        }

        commitProfilerUpdate(finishedWork, current, commitStartTime, profilerInstance.effectDuration);
      } else {
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      }
      break;
    }
    case ActivityComponent: {
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      if (flags & Update) {
        commitActivityHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      if (flags & Update) {
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      }
      if (flags & Callback) {
        // This Boundary is in fallback and has a dehydrated Suspense
        // instance. We could in theory assume the dehydrated state but we
        // recheck it for certainty.
        const finishedState = finishedWork.memoizedState as SuspenseState | null;
        if (finishedState !== null) {
          const dehydrated = finishedState.dehydrated;
          if (dehydrated !== null) {
            // Register a callback to retry this boundary once the server has
            // sent the result.
            const retry = () => retryDehydratedSuspenseBoundary(finishedWork);
            registerSuspenseInstanceRetry(dehydrated, retry);
          }
        }
      }
      break;
    }
    case OffscreenComponent: {
      const isModernRoot = disableLegacyMode || (finishedWork.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const isHidden = finishedWork.memoizedState !== null;
        const newOffscreenSubtreeIsHidden = isHidden || offscreenSubtreeIsHidden;
        if (newOffscreenSubtreeIsHidden) {
          // The Offscreen tree is hidden. Skip over its layout effects.
        } else {
          // The Offscreen tree is visible.

          const wasHidden = current !== null && current.memoizedState !== null;
          const newOffscreenSubtreeWasHidden = wasHidden || offscreenSubtreeWasHidden;
          const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
          const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
          offscreenSubtreeIsHidden = newOffscreenSubtreeIsHidden;
          offscreenSubtreeWasHidden = newOffscreenSubtreeWasHidden;

          if (offscreenSubtreeWasHidden && !prevOffscreenSubtreeWasHidden) {
            // This is the root of a reappearing boundary. As we continue
            // traversing the layout effects, we must also re-mount layout
            // effects that were unmounted when the Offscreen subtree was
            // hidden. So this is a superset of the normal commitLayoutEffects.
            let layoutEffectTraversalFlags: LayoutEffectTraversalFlags;
            if (supportsSingletons) {
              layoutEffectTraversalFlags = IncludeHostSingletons;
            } else {
              layoutEffectTraversalFlags = NoLayoutEffectTraversalFlags;
            }
            if ((finishedWork.subtreeFlags & LayoutMask) !== NoFlags) {
              layoutEffectTraversalFlags |= IncludeWorkInProgressEffects;
            }
            recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
            if (
              enableProfilerTimer &&
              enableProfilerCommitHooks &&
              enableComponentPerformanceTrack &&
              (finishedWork.mode & ProfileMode) !== NoMode &&
              componentEffectStartTime >= 0 &&
              componentEffectEndTime >= 0 &&
              componentEffectEndTime - componentEffectStartTime > 0.05
            ) {
              logComponentReappeared(finishedWork, componentEffectStartTime, componentEffectEndTime);
            }
          } else {
            recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
          }
          offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
          offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        }
      } else {
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (isDevelopment) {
          if (flags & ViewTransitionNamedStatic) {
            trackNamedViewTransition(finishedWork);
          }
        }
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
        if (flags & Ref) {
          safelyAttachRef(finishedWork, finishedWork.return);
        }
        break;
      }
      break;
    }
    case Fragment:
      if (enableFragmentRefs) {
        if (flags & Ref) {
          safelyAttachRef(finishedWork, finishedWork.return);
        }
      }
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      break;
    default: {
      recursivelyTraverseLayoutEffects(finishedRoot, finishedWork, committedLanes);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0
  ) {
    if (componentEffectSpawnedUpdate || componentEffectDuration > 0.05) {
      logComponentEffect(
        finishedWork,
        componentEffectStartTime,
        componentEffectEndTime,
        componentEffectDuration,
        componentEffectErrors,
      );
    }
    if (
      // Insertion
      finishedWork.alternate === null &&
      finishedWork.return !== null &&
      finishedWork.return.alternate !== null &&
      componentEffectEndTime - componentEffectStartTime > 0.05
    ) {
      const isHydration = isHydratingParent(finishedWork.return.alternate, finishedWork.return);
      if (!isHydration) {
        logComponentMount(finishedWork, componentEffectStartTime, componentEffectEndTime);
      }
    }
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

// enableTransitionTracing: abortRootTransitions,
// abortTracingMarkerTransitions, abortParentMarkerTransitionsForDeletedFiber
// and commitTransitionProgress are not ported.

function hideOrUnhideAllChildren(parentFiber: Fiber, isHidden: boolean): void {
  if (!supportsMutation) {
    return;
  }
  // Finds the nearest host component children and updates their visibility
  // to either hidden or visible.
  let child = parentFiber.child;
  while (child !== null) {
    hideOrUnhideAllChildrenOnFiber(child, isHidden);
    child = child.sibling;
  }
}

function hideOrUnhideAllChildrenOnFiber(fiber: Fiber, isHidden: boolean): void {
  if (!supportsMutation) {
    return;
  }
  switch (fiber.tag) {
    case HostComponent:
    case HostHoistable: {
      // Found the nearest host component. Hide it.
      commitShowHideHostInstance(fiber, isHidden);
      // Typically, only the nearest host nodes need to be hidden, since that
      // has the effect of also hiding everything inside of them.
      //
      // However, there's a special case for portals, because portals do not
      // exist in the regular host tree hierarchy; we can't assume that just
      // because a portal's HostComponent parent in the React tree will also
      // be a parent in the actual host tree.
      //
      // So, if any portals exist within the tree, regardless of how deeply
      // nested they are, we need to repeat this algorithm for its children.
      hideOrUnhideNearestPortals(fiber, isHidden);
      return;
    }
    case HostText: {
      commitShowHideHostTextInstance(fiber, isHidden);
      return;
    }
    case DehydratedFragment: {
      commitShowHideSuspenseBoundary(fiber, isHidden);
      return;
    }
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      const offscreenState = fiber.memoizedState as OffscreenState | null;
      if (offscreenState !== null) {
        // Found a nested Offscreen component that is hidden.
        // Don't search any deeper. This tree should remain hidden.
      } else {
        hideOrUnhideAllChildren(fiber, isHidden);
      }
      return;
    }
    default: {
      hideOrUnhideAllChildren(fiber, isHidden);
      return;
    }
  }
}

function hideOrUnhideNearestPortals(parentFiber: Fiber, isHidden: boolean): void {
  if (!supportsMutation) {
    return;
  }
  if (parentFiber.subtreeFlags & PortalStatic) {
    let child = parentFiber.child;
    while (child !== null) {
      hideOrUnhideNearestPortalsOnFiber(child, isHidden);
      child = child.sibling;
    }
  }
}

function hideOrUnhideNearestPortalsOnFiber(fiber: Fiber, isHidden: boolean): void {
  if (!supportsMutation) {
    return;
  }
  switch (fiber.tag) {
    case HostPortal: {
      // Found a portal. Switch back to the normal hide/unhide algorithm to
      // toggle the visibility of its children.
      hideOrUnhideAllChildrenOnFiber(fiber, isHidden);
      return;
    }
    case OffscreenComponent: {
      const offscreenState = fiber.memoizedState as OffscreenState | null;
      if (offscreenState !== null) {
        // Found a nested Offscreen component that is hidden. Don't search
        // any deeper. This tree should remain hidden.
      } else {
        hideOrUnhideNearestPortals(fiber, isHidden);
      }
      return;
    }
    default: {
      hideOrUnhideNearestPortals(fiber, isHidden);
      return;
    }
  }
}

function detachFiberMutation(fiber: Fiber): void {
  // Cut off the return pointer to disconnect it from the tree. This enables
  // us to detect and warn against state updates on an unmounted component.
  // It also prevents events from bubbling from within disconnected
  // components.
  //
  // Ideally, we should also clear the child pointer of the parent alternate
  // to let this get GC:ed but we don't know which for sure which parent is
  // the current one so we'll settle for GC:ing the subtree of this child.
  // This child itself will be GC:ed when the parent updates the next time.
  //
  // Note that we can't clear child or sibling pointers yet. They're needed
  // for passive effects and for findDOMNode. We defer those fields, and all
  // other cleanup, to the passive phase (see detachFiberAfterEffects).
  //
  // Don't reset the alternate yet, either. We need that so we can detach the
  // alternate's fields in the passive phase. Clearing the return pointer is
  // sufficient for findDOMNode semantics.
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.return = null;
  }
  fiber.return = null;
}

function detachFiberAfterEffects(fiber: Fiber): void {
  const alternate = fiber.alternate;
  if (alternate !== null) {
    fiber.alternate = null;
    detachFiberAfterEffects(alternate);
  }

  // Clear cyclical Fiber fields. This level alone is designed to roughly
  // approximate the planned Fiber refactor. In that world, `setState` will
  // be bound to a special "instance" object instead of a Fiber. The Instance
  // object will not have any of these fields. It will only be connected to
  // the fiber tree via a single link at the root. So if this level alone is
  // sufficient to fix memory issues, that bodes well for our plans.
  fiber.child = null;
  fiber.deletions = null;
  fiber.sibling = null;

  // The `stateNode` is cyclical because on host nodes it points to the host
  // tree, which has its own pointers to children, parents, and siblings.
  // The other host nodes also point back to fibers, so we should detach that
  // one, too.
  if (fiber.tag === HostComponent) {
    const hostInstance = fiber.stateNode as Instance | null;
    if (hostInstance !== null) {
      detachDeletedInstance(hostInstance);
    }
  }
  fiber.stateNode = null;

  if (isDevelopment) {
    fiber._debugOwner = null;
  }

  // Theoretically, nothing in here should be necessary, because we already
  // disconnected the fiber from the tree. So even if something leaks this
  // particular fiber, it won't leak anything else.
  fiber.return = null;
  fiber.dependencies = null;
  fiber.memoizedProps = null;
  fiber.memoizedState = null;
  fiber.pendingProps = null;
  fiber.stateNode = null;
  // TODO: Move to `commitPassiveUnmountInsideDeletedTreeOnFiber` instead.
  fiber.updateQueue = null;
}

// These are tracked on the stack as we recursively traverse a deleted
// subtree.
// TODO: Update these during the whole mutation phase, not just during a
// deletion.
let hostParent: Instance | Container | null = null;
let hostParentIsContainer = false;

// The host parent of a deletion: a host instance, or the container of a root
// or portal.
function containerInfoOf(fiber: Fiber): Container {
  return (fiber.stateNode as { containerInfo: Container }).containerInfo;
}

function commitDeletionEffects(root: FiberRoot, returnFiber: Fiber, deletedFiber: Fiber): void {
  const prevEffectStart = pushComponentEffectStart();

  if (supportsMutation) {
    // We only have the top Fiber that was deleted but we need to recurse
    // down its children to find all the terminal nodes.

    // Recursively delete all host nodes from the parent, detach refs, clean
    // up mounted layout effects, and call componentWillUnmount.

    // We only need to remove the topmost host child in each branch. But then
    // we still need to keep traversing to unmount effects, refs, and cWU.
    // TODO: We could split this into two separate traversals functions,
    // where the second one doesn't include any removeChild logic. This is
    // maybe the same function as "disappearLayoutEffects" (or whatever that
    // turns into after the layout phase is refactored to use recursion).

    // Before starting, find the nearest host parent on the stack so we know
    // which instance/container to remove the children from.
    // TODO: Instead of searching up the fiber return path on every deletion,
    // we can track the nearest host component on the JS stack as we traverse
    // the tree during the commit phase. This would make insertions faster,
    // too.
    let parent: Fiber | null = returnFiber;
    findParent: while (parent !== null) {
      switch (parent.tag) {
        case HostSingleton:
        case HostComponent: {
          if (parent.tag === HostSingleton && supportsSingletons) {
            if (isSingletonScope(parent.type as string)) {
              hostParent = parent.stateNode as Instance;
              hostParentIsContainer = false;
              break findParent;
            }
            break;
          }
          // A HostComponent, or a HostSingleton when the renderer does not
          // support singletons (upstream falls through).
          hostParent = parent.stateNode as Instance;
          hostParentIsContainer = false;
          break findParent;
        }
        case HostRoot:
        case HostPortal: {
          hostParent = containerInfoOf(parent);
          hostParentIsContainer = true;
          break findParent;
        }
      }
      parent = parent.return;
    }
    if (hostParent === null) {
      throw new Error(
        "Expected to find a host parent. This error is likely caused by " + "a bug in React. Please file an issue.",
      );
    }

    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
    hostParent = null;
    hostParentIsContainer = false;
  } else {
    // Detach refs and call componentWillUnmount() on the whole subtree.
    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (deletedFiber.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    componentEffectEndTime - componentEffectStartTime > 0.05
  ) {
    logComponentUnmount(deletedFiber, componentEffectStartTime, componentEffectEndTime);
  }
  popComponentEffectStart(prevEffectStart);

  detachFiberMutation(deletedFiber);
}

function recursivelyTraverseDeletionEffects(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  parent: Fiber,
): void {
  // TODO: Use a static flag to skip trees that don't have unmount effects
  let child = parent.child;
  while (child !== null) {
    commitDeletionEffectsOnFiber(finishedRoot, nearestMountedAncestor, child);
    child = child.sibling;
  }
}

function commitDeletionEffectsOnFiber(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  deletedFiber: Fiber,
): void {
  // TODO: Delete this Hook once new DevTools ships everywhere. No longer
  // needed.
  onCommitUnmount(deletedFiber);

  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();

  // The cases in this outer switch modify the stack before they traverse
  // into their subtree. There are simpler cases in the inner switch that
  // don't modify the stack.
  switch (deletedFiber.tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
    case HostText: {
      commitHostDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
    case DehydratedFragment: {
      // enableSuspenseCallback: the onDeleted hydration callback is not
      // ported.

      // Dehydrated fragments don't have any children

      // Delete the dehydrated suspense boundary and all of its content.
      if (supportsMutation) {
        if (hostParent !== null) {
          if (hostParentIsContainer) {
            clearSuspenseBoundaryFromContainer(hostParent as Container, deletedFiber.stateNode as SuspenseInstance);
          } else {
            clearSuspenseBoundary(hostParent as Instance, deletedFiber.stateNode as SuspenseInstance);
          }
        }
      }
      break;
    }
    case HostPortal: {
      if (supportsMutation) {
        // When we go into a portal, it becomes the parent to remove from.
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = containerInfoOf(deletedFiber);
        hostParentIsContainer = true;
        recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;
      } else {
        if (supportsPersistence) {
          commitHostPortalContainerChildren(
            deletedFiber.stateNode as PortalStateNode,
            deletedFiber,
            createContainerChildSet(),
          );
        }

        recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      }
      break;
    }
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // TODO: Use a commitHookInsertionUnmountEffects wrapper to record
      // timings.
      commitHookEffectListUnmount(HookInsertion, deletedFiber, nearestMountedAncestor);
      if (!offscreenSubtreeWasHidden) {
        commitHookLayoutUnmountEffects(deletedFiber, nearestMountedAncestor, HookLayout);
      }
      recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
    case ClassComponent: {
      if (!offscreenSubtreeWasHidden) {
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
        const instance = deletedFiber.stateNode as CommitClassInstance;
        if (typeof instance.componentWillUnmount === "function") {
          safelyCallComponentWillUnmount(deletedFiber, nearestMountedAncestor, instance);
        }
      }
      recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
    case ScopeComponent: {
      // enableScopeAPI: detaching the scope's ref is not ported.
      recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
    case OffscreenComponent: {
      if (disableLegacyMode || deletedFiber.mode & ConcurrentMode) {
        // If this offscreen component is hidden, we already unmounted it.
        // Before deleting the children, track that it's already unmounted so
        // that we don't attempt to unmount the effects again.
        // TODO: If the tree is hidden, in most cases we should be able to
        // skip over the nested children entirely. An exception is we haven't
        // yet found the topmost host node to delete, which we already track
        // on the stack. But the other case is portals, which need to be
        // detached no matter how deeply they are nested. We should use a
        // subtree flag to track whether a subtree includes a nested portal.
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || deletedFiber.memoizedState !== null;

        recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
      } else {
        recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (isDevelopment) {
          if (deletedFiber.flags & ViewTransitionNamedStatic) {
            untrackNamedViewTransition(deletedFiber);
          }
        }
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
        recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
        break;
      }
      // Upstream falls through to the Fragment case.
      commitFragmentDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
    case Fragment: {
      commitFragmentDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
    default: {
      recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (deletedFiber.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      deletedFiber,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

// The host cases of commitDeletionEffectsOnFiber. Upstream writes them as one
// switch whose cases fall through in this order: HostHoistable (when
// resources are not supported) into HostSingleton (when singletons are not
// supported) into HostComponent into HostText.
function commitHostDeletionEffects(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  deletedFiber: Fiber,
): void {
  const tag = deletedFiber.tag;
  if (tag === HostHoistable && supportsResources) {
    if (!offscreenSubtreeWasHidden) {
      safelyDetachRef(deletedFiber, nearestMountedAncestor);
    }
    recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
    if (deletedFiber.memoizedState) {
      releaseResource(deletedFiber.memoizedState);
    } else if (deletedFiber.stateNode) {
      // A Hoistable Instance lives in document.head only when its enclosing
      // Activity is visible. If the Activity is hidden (or has been hidden
      // since mount), the instance was either never inserted or was detached
      // by the disappear traversal. Skip in those cases.
      if (!offscreenSubtreeWasHidden) {
        unmountHoistable(deletedFiber.stateNode as Instance);
      }
    }
    return;
  }
  if ((tag === HostHoistable || tag === HostSingleton) && supportsSingletons) {
    if (!offscreenSubtreeWasHidden) {
      safelyDetachRef(deletedFiber, nearestMountedAncestor);
    }
    if (enableFragmentRefs) {
      commitFragmentInstanceDeletionEffects(deletedFiber);
    }

    const prevHostParent = hostParent;
    const prevHostParentIsContainer = hostParentIsContainer;
    if (isSingletonScope(deletedFiber.type as string)) {
      hostParent = deletedFiber.stateNode as Instance;
      hostParentIsContainer = false;
    }
    recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);

    // Normally this is called in passive unmount effect phase however with
    // HostSingleton we warn if you acquire one that is already associated to
    // a different fiber. To increase our chances of avoiding this,
    // specifically if you keyed a HostSingleton so there will be a delete
    // followed by a Placement we treat detach eagerly here
    commitHostSingletonRelease(deletedFiber);

    hostParent = prevHostParent;
    hostParentIsContainer = prevHostParentIsContainer;
    return;
  }
  if (tag !== HostText) {
    // HostComponent, or a hoistable or singleton the renderer does not
    // support.
    if (!offscreenSubtreeWasHidden) {
      safelyDetachRef(deletedFiber, nearestMountedAncestor);
    }
    if (enableFragmentRefs) {
      commitFragmentInstanceDeletionEffects(deletedFiber);
    }
    // Intentional fallthrough to the HostText branch.
  }
  if (
    enableFragmentRefs &&
    enableFragmentRefsTextNodes &&
    // HostComponent falls through into this case.
    tag === HostText
  ) {
    commitFragmentInstanceDeletionEffects(deletedFiber);
  }
  // We only need to remove the nearest host child. Set the host parent to
  // `null` on the stack to indicate that nested children don't need to be
  // removed.
  if (supportsMutation) {
    const prevHostParent = hostParent;
    const prevHostParentIsContainer = hostParentIsContainer;
    hostParent = null;
    recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
    hostParent = prevHostParent;
    hostParentIsContainer = prevHostParentIsContainer;

    if (hostParent !== null) {
      // Now that all the child effects have unmounted, we can remove the
      // node from the tree.
      if (hostParentIsContainer) {
        commitHostRemoveChildFromContainer(
          deletedFiber,
          nearestMountedAncestor,
          hostParent as Container,
          deletedFiber.stateNode as Instance | TextInstance,
        );
      } else {
        commitHostRemoveChild(
          deletedFiber,
          nearestMountedAncestor,
          hostParent as Instance,
          deletedFiber.stateNode as Instance | TextInstance,
        );
      }
    }
  } else {
    recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
  }
}

function commitFragmentDeletionEffects(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  deletedFiber: Fiber,
): void {
  if (enableFragmentRefs) {
    if (!offscreenSubtreeWasHidden) {
      safelyDetachRef(deletedFiber, nearestMountedAncestor);
    }
  }
  recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
}

// enableSuspenseCallback: commitSuspenseCallback is not ported.

function commitActivityHydrationCallbacks(_finishedRoot: FiberRoot, finishedWork: Fiber): void {
  if (!supportsHydration) {
    return;
  }
  const newState = finishedWork.memoizedState as ActivityState | null;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState = current.memoizedState as ActivityState | null;
      if (prevState !== null) {
        const activityInstance = prevState.dehydrated;
        commitHostHydratedActivity(activityInstance, finishedWork);
        // enableSuspenseCallback: the onHydrated callback is not ported.
      }
    }
  }
}

function commitSuspenseHydrationCallbacks(_finishedRoot: FiberRoot, finishedWork: Fiber): void {
  if (!supportsHydration) {
    return;
  }
  const newState = finishedWork.memoizedState as SuspenseState | null;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState = current.memoizedState as SuspenseState | null;
      if (prevState !== null) {
        const suspenseInstance = prevState.dehydrated;
        if (suspenseInstance !== null) {
          commitHostHydratedSuspense(suspenseInstance, finishedWork);
          // enableSuspenseCallback: the onHydrated callback is not ported.
        }
      }
    }
  }
}

type RetryCache = WeakSet<Wakeable> | Set<Wakeable>;

function getRetryCache(finishedWork: Fiber): RetryCache {
  // TODO: Unify the interface for the retry cache so we don't have to switch
  // on the tag like this.
  switch (finishedWork.tag) {
    case ActivityComponent:
    case SuspenseComponent:
    case SuspenseListComponent: {
      let retryCache = finishedWork.stateNode as RetryCache | null;
      if (retryCache === null) {
        retryCache = new WeakSet();
        finishedWork.stateNode = retryCache;
      }
      return retryCache;
    }
    case OffscreenComponent: {
      const instance = finishedWork.stateNode as OffscreenInstance;
      let retryCache: RetryCache | null = instance._retryCache;
      if (retryCache === null) {
        retryCache = instance._retryCache = new WeakSet();
      }
      return retryCache;
    }
    default: {
      throw new Error(`Unexpected Suspense handler tag (${finishedWork.tag}). This is a ` + "bug in React.");
    }
  }
}

function attachSuspenseRetryListeners(finishedWork: Fiber, wakeables: RetryQueue): void {
  // If this boundary just timed out, then it will have a set of wakeables.
  // For each wakeable, attach a listener so that when it resolves, React
  // attempts to re-render the boundary in the primary (pre-timeout) state.
  const retryCache = getRetryCache(finishedWork);
  wakeables.forEach((wakeable) => {
    // Memoize using the boundary fiber to prevent redundant listeners.
    if (!retryCache.has(wakeable)) {
      retryCache.add(wakeable);

      if (enableUpdaterTracking) {
        if (isDevToolsPresent) {
          if (inProgressLanes !== null && inProgressRoot !== null) {
            // If we have pending work still, associate the original updaters
            // with it.
            restorePendingUpdaters(inProgressRoot, inProgressLanes);
          } else {
            throw Error("Expected finished root and lanes to be set. This is a bug in React.");
          }
        }
      }

      const retry = () => resolveRetryWakeable(finishedWork, wakeable);
      wakeable.then(retry, retry);
    }
  });
}

export function commitMutationEffects(root: FiberRoot, finishedWork: Fiber, committedLanes: Lanes): void {
  inProgressLanes = committedLanes;
  inProgressRoot = root;

  rootViewTransitionAffected = false;
  inUpdateViewTransition = false;

  resetComponentEffectTimers();

  commitMutationEffectsOnFiber(finishedWork, root, committedLanes);

  inProgressLanes = null;
  inProgressRoot = null;
}

function recursivelyTraverseMutationEffects(root: FiberRoot, parentFiber: Fiber, lanes: Lanes): void {
  // Deletions effects can be scheduled on any fiber type. They need to
  // happen before the children effects have fired.
  const deletions = parentFiber.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i]!;
      commitDeletionEffects(root, parentFiber, childToDelete);
    }
  }

  if (parentFiber.subtreeFlags & (MutationMask | Cloned)) {
    let child = parentFiber.child;
    while (child !== null) {
      commitMutationEffectsOnFiber(child, root, lanes);
      child = child.sibling;
    }
  }
}

let currentHoistableRoot: HoistableRoot | null = null;

function commitMutationEffectsOnFiber(finishedWork: Fiber, root: FiberRoot, lanes: Lanes): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  // The effect flag should be checked *after* we refine the type of fiber,
  // because the fiber tag is more specific. An exception is any flag related
  // to reconciliation, because those can be set on all fiber types.
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // Mutate event effect callbacks on the way down, before mutation
      // effects. This ensures that parent event effects are mutated before
      // child effects. This isn't a supported use case, so we can
      // re-consider it, but this was the behavior we originally shipped.
      if (enableEffectEventMutationPhase) {
        if (flags & Update) {
          const updateQueue = finishedWork.updateQueue as FunctionComponentUpdateQueue | null;
          const eventPayloads = updateQueue !== null ? updateQueue.events : null;
          if (eventPayloads !== null) {
            for (let ii = 0; ii < eventPayloads.length; ii++) {
              const { ref, nextImpl } = eventPayloads[ii]!;
              ref.impl = nextImpl;
            }
          }
        }
      }
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Update) {
        commitHookEffectListUnmount(HookInsertion | HookHasEffect, finishedWork, finishedWork.return);
        // TODO: Use a commitHookInsertionUnmountEffects wrapper to record
        // timings.
        commitHookEffectListMount(HookInsertion | HookHasEffect, finishedWork);
        commitHookLayoutUnmountEffects(finishedWork, finishedWork.return, HookLayout | HookHasEffect);
      }
      break;
    }
    case ClassComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Ref) {
        if (!offscreenSubtreeWasHidden && current !== null) {
          safelyDetachRef(current, current.return);
        }
      }

      if (flags & Callback && offscreenSubtreeIsHidden) {
        const updateQueue = finishedWork.updateQueue as UpdateQueue<unknown> | null;
        if (updateQueue !== null) {
          deferHiddenCallbacks(updateQueue);
        }
      }
      break;
    }
    case HostHoistable: {
      // Upstream falls through to the HostSingleton case, then to
      // HostComponent, when the renderer lacks resources and singletons.
      if (supportsResources) {
        commitHostHoistableMutationEffects(finishedWork, root, lanes, current, flags);
      } else if (supportsSingletons) {
        commitHostSingletonMutationEffects(finishedWork, root, lanes, current, flags);
      } else {
        commitHostComponentMutationEffects(finishedWork, root, lanes, current, flags);
      }
      break;
    }
    case HostSingleton: {
      if (supportsSingletons) {
        commitHostSingletonMutationEffects(finishedWork, root, lanes, current, flags);
      } else {
        commitHostComponentMutationEffects(finishedWork, root, lanes, current, flags);
      }
      break;
    }
    case HostComponent: {
      commitHostComponentMutationEffects(finishedWork, root, lanes, current, flags);
      break;
    }
    case HostText: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Update) {
        if (supportsMutation) {
          if (finishedWork.stateNode === null) {
            throw new Error(
              "This should have a text node initialized. This error is likely " +
                "caused by a bug in React. Please file an issue.",
            );
          }

          const newText = finishedWork.memoizedProps as string;
          // For hydration we reuse the update path but we treat the oldProps
          // as the newProps. The updatePayload will contain the real change
          // in this case.
          const oldText = current !== null ? (current.memoizedProps as string) : newText;

          commitHostTextUpdate(finishedWork, newText, oldText);
        }
      }
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      pushRootMutationContext();
      if (supportsResources) {
        prepareToCommitHoistables();

        const previousHoistableRoot = currentHoistableRoot;
        currentHoistableRoot = getHoistableRoot(root.containerInfo);

        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        currentHoistableRoot = previousHoistableRoot;

        commitReconciliationEffects(finishedWork, lanes);
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
      }

      if (flags & Update) {
        if (supportsMutation && supportsHydration) {
          if (current !== null) {
            const prevRootState = current.memoizedState as RootState;
            if (prevRootState.isDehydrated) {
              commitHostHydratedContainer(root, finishedWork);
            }
          }
        }
        if (supportsPersistence) {
          commitHostRootContainerChildren(root, finishedWork);
        }
      }

      if (needsFormReset) {
        // A form component requested to be reset during this commit. We do
        // this after all mutations in the rest of the tree so that
        // `defaultValue` will already be updated. This way you can update
        // `defaultValue` using data sent by the server as a result of the
        // form submission.
        //
        // Theoretically we could check finishedWork.subtreeFlags & FormReset,
        // but the FormReset bit is overloaded with other flags used by other
        // fiber types. So this extra variable lets us skip traversing the
        // tree except when a form was actually submitted.
        needsFormReset = false;
        recursivelyResetForms(finishedWork);
      }

      if (enableProfilerTimer && enableProfilerCommitHooks) {
        root.effectDuration += popNestedEffectDurations(prevProfilerEffectDuration);
      }

      popMutationContext(false);

      if (enableDefaultTransitionIndicator && rootMutationContext && includesLoadingIndicatorLanes(lanes)) {
        // This root had a mutation. Mark this root as having rendered a
        // manual loading state.
        markIndicatorHandled(root);
      }

      break;
    }
    case HostPortal: {
      // For the purposes of visibility toggling, the direct children of a
      // portal are considered "children" of the nearest hidden
      // OffscreenComponent, regardless of whether there are any host
      // components in between them. This is because portals are not part of
      // the regular host tree hierarchy; we can't assume that just because a
      // portal's HostComponent parent in the React tree will also be a parent
      // in the actual host tree. So we must hide all of them.
      const prevOffscreenDirectParentIsHidden = offscreenDirectParentIsHidden;
      offscreenDirectParentIsHidden = offscreenSubtreeIsHidden;
      const prevMutationContext = pushMutationContext();
      if (supportsResources) {
        const previousHoistableRoot = currentHoistableRoot;
        currentHoistableRoot = getHoistableRoot(containerInfoOf(finishedWork));
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
        currentHoistableRoot = previousHoistableRoot;
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
      }
      if (viewTransitionMutationContext && inUpdateViewTransition) {
        // A Portal doesn't necessarily exist within the context of this
        // subtree. Ideally we would track which React ViewTransition component
        // nests the container but that's costly. Instead, we treat each Portal
        // as if it's a new React root. Therefore any leaked mutation means
        // that the root should animate.
        rootViewTransitionAffected = true;
      }
      popMutationContext(prevMutationContext);
      offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden;

      if (flags & Update) {
        if (supportsPersistence) {
          const portal = finishedWork.stateNode as PortalStateNode;
          commitHostPortalContainerChildren(portal, finishedWork, portal.pendingChildren);
        }
      }
      break;
    }
    case Profiler: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (enableProfilerTimer && enableProfilerCommitHooks) {
        const profilerInstance = finishedWork.stateNode as ProfilerStateNode;
        // Propagate layout effect durations to the next nearest Profiler
        // ancestor. Do not reset these values until the next render so
        // DevTools has a chance to read them first.
        profilerInstance.effectDuration += bubbleNestedEffectDurations(prevProfilerEffectDuration);
      }
      break;
    }
    case ActivityComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);
      if (flags & Update) {
        const retryQueue = finishedWork.updateQueue as RetryQueue | null;
        if (retryQueue !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, retryQueue);
        }
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      // TODO: We should mark a flag on the Suspense fiber itself, rather than
      // relying on the Offscreen fiber having a flag also being marked. The
      // reason is that this offscreen fiber might not be part of the
      // work-in-progress tree! It could have been reused from a previous
      // render. This doesn't lead to incorrect behavior because we don't rely
      // on the flag check alone; we also compare the states explicitly below.
      // But for modeling purposes, we _should_ be able to rely on the flag
      // check alone. So this is a bit fragile.
      //
      // Also, all this logic could/should move to the passive phase so it
      // doesn't block paint.
      const offscreenFiber = finishedWork.child as Fiber;
      if (offscreenFiber.flags & Visibility) {
        // Throttle the appearance and disappearance of Suspense fallbacks.
        const isShowingFallback = (finishedWork.memoizedState as SuspenseState | null) !== null;
        const wasShowingFallback = current !== null && (current.memoizedState as SuspenseState | null) !== null;

        if (alwaysThrottleRetries) {
          if (isShowingFallback !== wasShowingFallback) {
            // A fallback is either appearing or disappearing.
            markCommitTimeOfFallback();
          }
        } else {
          if (isShowingFallback && !wasShowingFallback) {
            // Old behavior. Only mark when a fallback appears, not when it
            // disappears.
            markCommitTimeOfFallback();
          }
        }
      }

      if (flags & Update) {
        // enableSuspenseCallback: commitSuspenseCallback is not ported.
        const retryQueue = finishedWork.updateQueue as RetryQueue | null;
        if (retryQueue !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, retryQueue);
        }
      }
      break;
    }
    case OffscreenComponent: {
      const newState = finishedWork.memoizedState as OffscreenState | null;
      const isHidden = newState !== null;
      const wasHidden = current !== null && current.memoizedState !== null;

      if (disableLegacyMode || finishedWork.mode & ConcurrentMode) {
        // Before committing the children, track on the stack whether this
        // offscreen subtree was already hidden, so that we don't unmount the
        // effects again.
        const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        const prevOffscreenDirectParentIsHidden = offscreenDirectParentIsHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden || isHidden;
        offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden || isHidden;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || wasHidden;
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;

        if (
          // If this was the root of the reappear.
          wasHidden &&
          !isHidden &&
          !prevOffscreenSubtreeIsHidden &&
          !prevOffscreenSubtreeWasHidden &&
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (finishedWork.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          logComponentReappeared(finishedWork, componentEffectStartTime, componentEffectEndTime);
        }
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      }

      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Visibility) {
        const offscreenInstance = finishedWork.stateNode as OffscreenInstance;

        // Track the current state on the Offscreen instance so we can read
        // it during an event
        if (isHidden) {
          offscreenInstance._visibility &= ~OffscreenVisible;
        } else {
          offscreenInstance._visibility |= OffscreenVisible;
        }

        const isUpdate = current !== null;
        if (isHidden) {
          // Only trigger disappear layout effects if:
          //   - This is an update, not first mount.
          //   - This Offscreen was not hidden before.
          //   - Ancestor Offscreen was not hidden in previous commit or in
          //     this commit
          if (isUpdate && !wasHidden && !offscreenSubtreeIsHidden && !offscreenSubtreeWasHidden) {
            if (disableLegacyMode || (finishedWork.mode & ConcurrentMode) !== NoMode) {
              // Disappear the layout effects of all the children
              let layoutEffectTraversalFlags: LayoutEffectTraversalFlags;
              if (supportsSingletons) {
                layoutEffectTraversalFlags = IncludeHostSingletons;
              } else {
                layoutEffectTraversalFlags = NoLayoutEffectTraversalFlags;
              }
              const newOffscreenSubtreeIsHidden = isHidden || offscreenSubtreeIsHidden;
              const newOffscreenSubtreeWasHidden = wasHidden || offscreenSubtreeWasHidden;
              const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
              const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
              offscreenSubtreeIsHidden = newOffscreenSubtreeIsHidden;
              offscreenSubtreeWasHidden = newOffscreenSubtreeWasHidden;
              recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);

              if (
                enableProfilerTimer &&
                enableProfilerCommitHooks &&
                enableComponentPerformanceTrack &&
                (finishedWork.mode & ProfileMode) !== NoMode &&
                componentEffectStartTime >= 0 &&
                componentEffectEndTime >= 0 &&
                componentEffectEndTime - componentEffectStartTime > 0.05
              ) {
                logComponentDisappeared(finishedWork, componentEffectStartTime, componentEffectEndTime);
              }
              offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
              offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
            }
          }
        }

        if (supportsMutation) {
          // If it's trying to unhide but the parent is still hidden, then we
          // should not unhide.
          if (isHidden || !offscreenDirectParentIsHidden) {
            hideOrUnhideAllChildren(finishedWork, isHidden);
          }
        }
      }

      // TODO: Move to passive phase
      if (flags & Update) {
        const offscreenQueue = finishedWork.updateQueue as OffscreenQueue | null;
        if (offscreenQueue !== null) {
          const retryQueue = offscreenQueue.retryQueue;
          if (retryQueue !== null) {
            offscreenQueue.retryQueue = null;
            attachSuspenseRetryListeners(finishedWork, retryQueue);
          }
        }
      }
      break;
    }
    case SuspenseListComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Update) {
        const retryQueue = finishedWork.updateQueue as Set<Wakeable> | null;
        if (retryQueue !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, retryQueue);
        }
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (flags & Ref) {
          if (!offscreenSubtreeWasHidden && current !== null) {
            safelyDetachRef(current, current.return);
          }
        }
        const prevMutationContext = pushMutationContext();
        const prevUpdate = inUpdateViewTransition;
        const isViewTransitionEligible = enableViewTransition && includesOnlyViewTransitionEligibleLanes(lanes);
        const props = finishedWork.memoizedProps as ViewTransitionProps;
        inUpdateViewTransition =
          isViewTransitionEligible && getViewTransitionClassName(props.default, props.update) !== "none";
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
        if (isViewTransitionEligible) {
          if (current === null) {
            // This is a new mount. We should have handled this as part of the
            // Placement effect or it is deeper inside a entering transition.
          } else if (viewTransitionMutationContext) {
            // Something mutated in this tree so we need to animate this
            // regardless what the measurements say. We use the Update flag to
            // track this. If diffing was done in the render phase, like we
            // used, this could have been done in the render already.
            finishedWork.flags |= Update;
          }
        }
        inUpdateViewTransition = prevUpdate;
        popMutationContext(prevMutationContext);
        break;
      }
      break;
    }
    case ScopeComponent: {
      // enableScopeAPI: scope mutation effects are not ported.
      break;
    }
    case Fragment:
      if (enableFragmentRefs) {
        if (flags & Ref) {
          if (!offscreenSubtreeWasHidden && current !== null) {
            safelyDetachRef(current, current.return);
          }
        }
        if (current) {
          const fragmentInstance: unknown = current.stateNode;
          if (fragmentInstance !== null) {
            updateFragmentInstanceFiber(finishedWork, current.stateNode as FragmentInstanceType);
          }
        }
      }
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);
      break;
    default: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0
  ) {
    if (componentEffectSpawnedUpdate || componentEffectDuration > 0.05) {
      logComponentEffect(
        finishedWork,
        componentEffectStartTime,
        componentEffectEndTime,
        componentEffectDuration,
        componentEffectErrors,
      );
    }
    if (
      // Insertion
      finishedWork.alternate === null &&
      finishedWork.return !== null &&
      finishedWork.return.alternate !== null &&
      componentEffectEndTime - componentEffectStartTime > 0.05
    ) {
      const isHydration = isHydratingParent(finishedWork.return.alternate, finishedWork.return);
      if (!isHydration) {
        logComponentMount(finishedWork, componentEffectStartTime, componentEffectEndTime);
      }
    }
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

// The HostHoistable case of commitMutationEffectsOnFiber, for a renderer that
// supports resources.
function commitHostHoistableMutationEffects(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
  current: Fiber | null,
  flags: Flags,
): void {
  // We cast because we always set the root at the React root and so it
  // cannot be null while we are processing mutation effects
  const hoistableRoot = currentHoistableRoot as HoistableRoot;
  recursivelyTraverseMutationEffects(root, finishedWork, lanes);
  commitReconciliationEffects(finishedWork, lanes);

  if (flags & Ref) {
    if (!offscreenSubtreeWasHidden && current !== null) {
      safelyDetachRef(current, current.return);
    }
  }

  if (flags & Update) {
    const currentResource = current !== null ? current.memoizedState : null;
    const newResource = finishedWork.memoizedState;
    const type = finishedWork.type as string;
    const props = finishedWork.memoizedProps as Props;
    if (current === null) {
      // We are mounting a new HostHoistable Fiber. We fork the mount behavior
      // based on whether this instance is a Hoistable Instance or a Hoistable
      // Resource
      if (newResource === null) {
        if (finishedWork.stateNode === null) {
          // Initial mount. The instance has not been created yet, which
          // happens during hydration (createHoistableInstance is normally
          // called in beginWork's updateHostHoistable, but is skipped when
          // hydrating).
          if (offscreenSubtreeIsHidden) {
            // We're inside a hidden Activity boundary. Create the instance
            // off-document so we don't leak metadata into the head. It will
            // be mounted by the reappear path when the Activity becomes
            // visible.
            finishedWork.stateNode = createHoistableInstance(type, props, root.containerInfo, finishedWork);
          } else {
            finishedWork.stateNode = hydrateHoistable(hoistableRoot, type, props, finishedWork);
          }
        } else if (!offscreenSubtreeIsHidden) {
          // The instance was created in beginWork. Only mount it into the
          // document if we're not inside a hidden Activity boundary.
          mountHoistable(hoistableRoot, type, finishedWork.stateNode as Instance);
        }
      } else {
        finishedWork.stateNode = acquireResource(hoistableRoot, newResource, props);
      }
    } else if (currentResource !== newResource) {
      // We are moving to or from Hoistable Resource, or between different
      // Hoistable Resources
      if (currentResource === null) {
        // Transitioning from Instance to Resource. Only unmount when the
        // Instance is currently mounted in the document; hidden Activity
        // boundaries keep instances off-document or detach them before this
        // update is processed.
        const instance = current.stateNode as Instance | null;
        if (instance !== null && !offscreenSubtreeWasHidden) {
          unmountHoistable(instance);
        }
      } else {
        releaseResource(currentResource);
      }
      if (newResource === null) {
        // Transitioning to an Instance. Only mount if visible; hidden
        // Activity boundaries will mount via the reappear path.
        if (!offscreenSubtreeIsHidden) {
          mountHoistable(hoistableRoot, type, finishedWork.stateNode as Instance);
        }
      } else {
        acquireResource(hoistableRoot, newResource, props);
      }
    } else if (newResource === null && finishedWork.stateNode !== null) {
      commitHostUpdate(finishedWork, props, current.memoizedProps as Props);
    }
  }
}

// The HostSingleton case of commitMutationEffectsOnFiber, for a renderer
// that supports singletons.
function commitHostSingletonMutationEffects(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
  current: Fiber | null,
  flags: Flags,
): void {
  recursivelyTraverseMutationEffects(root, finishedWork, lanes);
  commitReconciliationEffects(finishedWork, lanes);
  if (flags & Ref) {
    if (!offscreenSubtreeWasHidden && current !== null) {
      safelyDetachRef(current, current.return);
    }
  }
  if (current !== null && flags & Update) {
    const newProps = finishedWork.memoizedProps as Props;
    const oldProps = current.memoizedProps as Props;
    commitHostUpdate(finishedWork, newProps, oldProps);
  }
}

// The HostComponent case of commitMutationEffectsOnFiber.
function commitHostComponentMutationEffects(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
  current: Fiber | null,
  flags: Flags,
): void {
  // We've hit a host component, so it's no longer a direct parent.
  const prevOffscreenDirectParentIsHidden = offscreenDirectParentIsHidden;
  offscreenDirectParentIsHidden = false;

  recursivelyTraverseMutationEffects(root, finishedWork, lanes);

  offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden;

  commitReconciliationEffects(finishedWork, lanes);

  if (flags & Ref) {
    if (!offscreenSubtreeWasHidden && current !== null) {
      safelyDetachRef(current, current.return);
    }
  }
  if (supportsMutation) {
    // TODO: ContentReset gets cleared by the children during the commit
    // phase. This is a refactor hazard because it means we must read flags
    // the flags after `commitReconciliationEffects` has already run; the
    // order matters. We should refactor so that ContentReset does not rely
    // on mutating the flag during commit. Like by setting a flag during the
    // render phase instead.
    if (finishedWork.flags & ContentReset) {
      commitHostResetTextContent(finishedWork);
    }

    if (flags & Update) {
      const instance = finishedWork.stateNode as Instance | null | undefined;
      if (instance != null) {
        // Commit the work prepared earlier.
        // For hydration we reuse the update path but we treat the oldProps
        // as the newProps. The updatePayload will contain the real change in
        // this case.
        const newProps = finishedWork.memoizedProps as Props;
        const oldProps = current !== null ? (current.memoizedProps as Props) : newProps;
        commitHostUpdate(finishedWork, newProps, oldProps);
      }
    }

    if (flags & FormReset) {
      needsFormReset = true;
      if (isDevelopment) {
        if (finishedWork.type !== "form") {
          // Paranoid coding. In case we accidentally start using the
          // FormReset bit for something else.
          console.error("Unexpected host component type. Expected a form. This is a " + "bug in React.");
        }
      }
    }
  } else {
    if (supportsPersistence) {
      if (finishedWork.alternate !== null) {
        // `finishedWork.alternate.stateNode` is pointing to a stale shadow
        // node at this point, retaining it and its subtree. To reclaim
        // memory, point `alternate.stateNode` to new shadow node. This
        // prevents shadow node from staying in memory longer than it needs
        // to. The correct behaviour of this is checked by test in React
        // Native: ShadowNodeReferenceCounter-itest.js#L150
        finishedWork.alternate.stateNode = finishedWork.stateNode;
      }
    }
  }
}

function commitReconciliationEffects(finishedWork: Fiber, _committedLanes: Lanes): void {
  // Placement effects (insertions, reorders) can be scheduled on any fiber
  // type. They needs to happen after the children effects have fired, but
  // before the effects on this fiber have fired.
  const flags = finishedWork.flags;
  if (flags & Placement) {
    commitHostPlacement(finishedWork);
    // Clear the "placement" from effect tag so that we know that this is
    // inserted, before any life-cycles like componentDidMount gets called.
    // TODO: findDOMNode doesn't rely on this any more but isMounted does and
    // isMounted is deprecated anyway so we should be able to kill this.
    finishedWork.flags &= ~Placement;
  }
  if (flags & Hydrating) {
    finishedWork.flags &= ~Hydrating;
  }
}

function recursivelyResetForms(parentFiber: Fiber): void {
  if (parentFiber.subtreeFlags & FormReset) {
    let child = parentFiber.child;
    while (child !== null) {
      resetFormOnFiber(child);
      child = child.sibling;
    }
  }
}

function resetFormOnFiber(fiber: Fiber): void {
  recursivelyResetForms(fiber);
  if (fiber.tag === HostComponent && fiber.flags & FormReset) {
    const formInstance = fiber.stateNode as FormInstance;
    resetFormInstance(formInstance);
  }
}

export function commitAfterMutationEffects(root: FiberRoot, finishedWork: Fiber, committedLanes: Lanes): void {
  if (!enableViewTransition) {
    // This phase is only used for view transitions.
    return;
  }
  commitAfterMutationEffectsOnFiber(finishedWork, root, committedLanes);
}

function recursivelyTraverseAfterMutationEffects(root: FiberRoot, parentFiber: Fiber, lanes: Lanes): void {
  // We need to visit the same nodes that we visited in the before mutation
  // phase.
  if (parentFiber.subtreeFlags & BeforeAndAfterMutationTransitionMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitAfterMutationEffectsOnFiber(child, root, lanes);
      child = child.sibling;
    }
  } else {
    // Nothing has changed in this subtree, but the parent may have still
    // affected its size and position. We need to measure this and if not,
    // restore it to not animate.
    measureNestedViewTransitions(parentFiber, false);
  }
}

function commitAfterMutationEffectsOnFiber(finishedWork: Fiber, root: FiberRoot, lanes: Lanes): void {
  const current = finishedWork.alternate;
  if (current === null) {
    // This is a newly inserted subtree. We can't use Placement flags to
    // detect this since they get removed in the mutation phase. Usually it's
    // not enough to just check current because that can also happen deeper
    // in the same tree. However, since we don't need to visit newly inserted
    // subtrees in AfterMutation we can just bail after we're done with the
    // first one. The first ViewTransition inside a newly mounted tree runs an
    // enter transition but other nested ones don't unless they have a named
    // pair.
    commitEnterViewTransitions(finishedWork, false);
    return;
  }

  switch (finishedWork.tag) {
    case HostRoot: {
      viewTransitionContextChanged = false;
      rootViewTransitionNameCanceled = false;
      pushViewTransitionCancelableScope();
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      if (!viewTransitionContextChanged && !rootViewTransitionAffected) {
        // If we didn't leak any resizing out to the root, we don't have to
        // transition the root itself. This means that we can now safely
        // cancel any cancellations that bubbled all the way up.
        const cancelableChildren = viewTransitionCancelableChildren;
        if (cancelableChildren !== null) {
          for (let i = 0; i < cancelableChildren.length; i += 3) {
            cancelViewTransitionName(
              cancelableChildren[i] as Instance,
              cancelableChildren[i + 1] as string,
              cancelableChildren[i + 2] as Props,
            );
          }
        }
        // We also cancel the root itself.
        cancelRootViewTransitionName(root.containerInfo);
        rootViewTransitionNameCanceled = true;
      }
      popViewTransitionCancelableScope(null);
      break;
    }
    case HostComponent: {
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      break;
    }
    case HostPortal: {
      const prevContextChanged = viewTransitionContextChanged;
      viewTransitionContextChanged = false;
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      if (viewTransitionContextChanged) {
        // A Portal doesn't necessarily exist within the context of this
        // subtree. Ideally we would track which React ViewTransition
        // component nests the container but that's costly. Instead, we treat
        // each Portal as if it's a new React root. Therefore any leaked
        // resize of a child could affect the root so the root should animate.
        // We only do this if the Portal is inside a ViewTransition and it is
        // not disabled with update="none". Otherwise the Portal is considered
        // not animating.
        rootViewTransitionAffected = true;
      }
      viewTransitionContextChanged = prevContextChanged;
      break;
    }
    case OffscreenComponent: {
      const isModernRoot = disableLegacyMode || (finishedWork.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const isHidden = finishedWork.memoizedState !== null;
        if (isHidden) {
          // The Offscreen tree is hidden. Skip over its after mutation
          // effects.
        } else {
          // The Offscreen tree is visible.
          const wasHidden = current.memoizedState !== null;
          if (wasHidden) {
            commitEnterViewTransitions(finishedWork, false);
            // If it was previous hidden then the children are treated as
            // enter not updates so we don't need to visit these children.
          } else {
            recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
          }
        }
      } else {
        recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      }
      break;
    }
    case ViewTransitionComponent: {
      const prevContextChanged = viewTransitionContextChanged;
      const prevCancelableChildren = pushViewTransitionCancelableScope();
      viewTransitionContextChanged = false;
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);

      if (viewTransitionContextChanged) {
        finishedWork.flags |= Update;
      }

      const inViewport = measureUpdateViewTransition(current, finishedWork, false);

      if ((finishedWork.flags & Update) === NoFlags || !inViewport) {
        // If this boundary didn't update, then we may be able to cancel its
        // children. We bubble them up to the parent set to be determined
        // later if we can cancel. Similarly, if old and new state was outside
        // the viewport, we can skip it even if it did update.
        if (prevCancelableChildren === null) {
          // Bubbling up this whole set to the parent.
        } else {
          // Merge with parent set.
          if (viewTransitionCancelableChildren !== null) {
            prevCancelableChildren.push(...viewTransitionCancelableChildren);
          }
          popViewTransitionCancelableScope(prevCancelableChildren);
        }
        // TODO: If this doesn't end up canceled, because a parent animates,
        // then we should probably issue an event since this instance is part
        // of it.
      } else {
        const props = finishedWork.memoizedProps as ViewTransitionProps;
        scheduleViewTransitionEvent(finishedWork, props.onUpdate);

        // If this boundary did update, we cannot cancel its children so those
        // are dropped.
        popViewTransitionCancelableScope(prevCancelableChildren);
      }

      if ((finishedWork.flags & AffectedParentLayout) !== NoFlags) {
        // This boundary changed size in a way that may have caused its parent
        // to relayout. We need to bubble this information up to the parent.
        viewTransitionContextChanged = true;
      } else {
        // Otherwise, we restore it to whatever the parent had found so far.
        viewTransitionContextChanged = prevContextChanged;
      }
      break;
    }
    default: {
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      break;
    }
  }
}

export function commitLayoutEffects(finishedWork: Fiber, root: FiberRoot, committedLanes: Lanes): void {
  inProgressLanes = committedLanes;
  inProgressRoot = root;

  resetComponentEffectTimers();

  const current = finishedWork.alternate;
  commitLayoutEffectOnFiber(root, current, finishedWork, committedLanes);

  inProgressLanes = null;
  inProgressRoot = null;
}

function recursivelyTraverseLayoutEffects(root: FiberRoot, parentFiber: Fiber, lanes: Lanes): void {
  if (parentFiber.subtreeFlags & LayoutMask) {
    let child = parentFiber.child;
    while (child !== null) {
      const current = child.alternate;
      commitLayoutEffectOnFiber(root, current, child, lanes);
      child = child.sibling;
    }
  }
}

export function disappearLayoutEffectsForDEVValidation(finishedWork: Fiber): void {
  if (isDevelopment) {
    disappearLayoutEffects(finishedWork, NoLayoutEffectTraversalFlags);
  }
}

function disappearLayoutEffects(finishedWork: Fiber, layoutEffectTraversalFlags: LayoutEffectTraversalFlags): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // TODO (Offscreen) Check: flags & LayoutStatic
      commitHookLayoutUnmountEffects(finishedWork, finishedWork.return, HookLayout);
      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
    case ClassComponent: {
      // TODO (Offscreen) Check: flags & RefStatic
      safelyDetachRef(finishedWork, finishedWork.return);

      const instance = finishedWork.stateNode as CommitClassInstance;
      if (typeof instance.componentWillUnmount === "function") {
        safelyCallComponentWillUnmount(finishedWork, finishedWork.return, instance);
      }

      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
    case HostSingleton:
    case HostComponent: {
      if (finishedWork.tag === HostSingleton && supportsSingletons) {
        const includeHostSingletons =
          (layoutEffectTraversalFlags & IncludeHostSingletons) !== NoLayoutEffectTraversalFlags;
        if (includeHostSingletons) {
          // TODO (Offscreen) Check: flags & RefStatic
          commitHostSingletonRelease(finishedWork);
        }
      }
      // TODO (Offscreen) Check: flags & RefStatic
      safelyDetachRef(finishedWork, finishedWork.return);

      if (enableFragmentRefs) {
        commitFragmentInstanceDeletionEffects(finishedWork);
      }

      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
    case HostText: {
      if (enableFragmentRefs && enableFragmentRefsTextNodes) {
        commitFragmentInstanceDeletionEffects(finishedWork);
      }
      break;
    }
    case HostHoistable: {
      // TODO (Offscreen) Check: flags & RefStatic
      safelyDetachRef(finishedWork, finishedWork.return);

      if (supportsResources) {
        // We only act on Hoistable Instances (memoizedState === null).
        // Resources (memoizedState !== null) are ref-counted and
        // intentionally remain in the document across Activity visibility
        // transitions; they are released only on actual deletion.
        const instance = finishedWork.stateNode as Instance | null;
        if (finishedWork.memoizedState === null && instance !== null && !offscreenSubtreeWasHidden) {
          unmountHoistable(instance);
        }
      }

      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
    case OffscreenComponent: {
      const isHidden = finishedWork.memoizedState !== null;
      if (isHidden) {
        // Nested Offscreen tree is already hidden. Don't disappear its
        // effects.
      } else {
        recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (isDevelopment) {
          if (finishedWork.flags & ViewTransitionNamedStatic) {
            untrackNamedViewTransition(finishedWork);
          }
        }
        safelyDetachRef(finishedWork, finishedWork.return);
      }
      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
    case Fragment: {
      if (enableFragmentRefs) {
        safelyDetachRef(finishedWork, finishedWork.return);
      }
      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
    default: {
      recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

function recursivelyTraverseDisappearLayoutEffects(
  parentFiber: Fiber,
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
): void {
  // TODO (Offscreen) Check: subtreeflags & (RefStatic | LayoutStatic)
  let child = parentFiber.child;
  while (child !== null) {
    disappearLayoutEffects(child, layoutEffectTraversalFlags);
    child = child.sibling;
  }
}

export function reappearLayoutEffectsForDEVValidation(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
): void {
  if (isDevelopment) {
    reappearLayoutEffects(finishedRoot, current, finishedWork, NoLayoutEffectTraversalFlags);
  }
}

function reappearLayoutEffects(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  // This function visits both newly finished work and nodes that were
  // re-used from a previously committed tree. We cannot check non-static
  // flags if the node was reused.
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  // Turn on layout effects in a tree that previously disappeared.
  const flags = finishedWork.flags;
  const includeWorkInProgressEffects =
    (layoutEffectTraversalFlags & IncludeWorkInProgressEffects) !== NoLayoutEffectTraversalFlags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
      // TODO: Check flags & LayoutStatic
      commitHookLayoutEffects(finishedWork, HookLayout);
      break;
    }
    case ClassComponent: {
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);

      commitClassDidMount(finishedWork);

      commitClassHiddenCallbacks(finishedWork);

      // If this is newly finished work, check for setState callbacks
      if (includeWorkInProgressEffects && flags & Callback) {
        commitClassCallbacks(finishedWork);
      }

      // TODO: Check flags & RefStatic
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    // Unlike commitLayoutEffectsOnFiber, we don't need to handle HostRoot
    // because this function only visits nodes that are inside an Offscreen
    // fiber.
    case HostSingleton:
    case HostComponent: {
      if (finishedWork.tag === HostSingleton && supportsSingletons) {
        const includeHostSingletons =
          (layoutEffectTraversalFlags & IncludeHostSingletons) !== NoLayoutEffectTraversalFlags;
        if (includeHostSingletons) {
          // We acquire the singleton instance first so it has appropriate
          // styles before other layout effects run. This isn't perfect
          // because an early sibling of the singleton may have an effect that
          // can observe the singleton before it is acquired.
          // @TODO move this to the mutation phase. The reason it isn't there
          // yet is it seemingly requires an extra traversal because we need
          // to move the disappear effect into a phase before the appear phase
          commitHostSingletonAcquisition(finishedWork);
        }
      }
      if (enableFragmentRefs) {
        commitFragmentInstanceInsertionEffects(finishedWork);
      }
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);

      // Renderers may schedule work to be done after host components are
      // mounted (eg DOM renderer may schedule auto-focus for inputs and form
      // controls). These effects should only be committed when components
      // are first mounted, aka when there is no current/alternate.
      if (includeWorkInProgressEffects && current === null && flags & Update) {
        commitHostMount(finishedWork);
      }

      // TODO: Check flags & Ref
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    case HostText: {
      if (enableFragmentRefs && enableFragmentRefsTextNodes) {
        commitFragmentInstanceInsertionEffects(finishedWork);
      }
      break;
    }
    case HostHoistable: {
      if (supportsResources) {
        // The reappear traversal runs whenever an Activity transitions from
        // hidden to visible. We piggy-back on it (rather than adding a
        // separate recursive traversal) to insert hoistable metadata such as
        // <title> and <meta> into the document.
        //
        // We only act on Hoistable Instances (memoizedState === null).
        // Resources stay mounted across Activity visibility transitions.
        //
        // The parentNode guard makes this idempotent and safe under
        // StrictMode dev double-invoke: if the instance is already attached
        // we skip.
        //
        // Note: this runs in the layout phase. A useLayoutEffect on an
        // earlier sibling can therefore observe document.title before the
        // hoistable is re-attached. Moving this to the mutation phase would
        // require an additional unconditional traversal of the Activity
        // subtree (the mutation traversal is gated by subtreeFlags and would
        // skip an unchanged hoistable). This is the same tradeoff as for
        // HostSingleton.
        const instance = finishedWork.stateNode as { ownerDocument: Container } | null;
        if (finishedWork.memoizedState === null && instance !== null && !offscreenSubtreeIsHidden) {
          // currentHoistableRoot is only maintained during the mutation
          // phase. Derive the hoistable root from the instance's owner
          // document so this works in the layout phase too. Hoistable
          // Instances are hoisted to document.head, which always lives in
          // ownerDocument.
          mountHoistable(getHoistableRoot(instance.ownerDocument), finishedWork.type as string, instance);
        }
      }
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);

      if (includeWorkInProgressEffects && current === null && flags & Update) {
        commitHostMount(finishedWork);
      }

      // TODO: Check flags & Ref
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    case Profiler: {
      // TODO: Figure out how Profiler updates should work with Offscreen
      if (includeWorkInProgressEffects && flags & Update) {
        const prevProfilerEffectDuration = pushNestedEffectDurations();

        recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);

        const profilerInstance = finishedWork.stateNode as ProfilerStateNode;

        if (enableProfilerTimer && enableProfilerCommitHooks) {
          // Propagate layout effect durations to the next nearest Profiler
          // ancestor. Do not reset these values until the next render so
          // DevTools has a chance to read them first.
          profilerInstance.effectDuration += bubbleNestedEffectDurations(prevProfilerEffectDuration);
        }

        commitProfilerUpdate(finishedWork, current, commitStartTime, profilerInstance.effectDuration);
      } else {
        recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
      }
      break;
    }
    case ActivityComponent: {
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);

      if (includeWorkInProgressEffects && flags & Update) {
        // TODO: Delete this feature.
        commitActivityHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);

      if (includeWorkInProgressEffects && flags & Update) {
        // TODO: Delete this feature.
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case OffscreenComponent: {
      const offscreenState = finishedWork.memoizedState as OffscreenState | null;
      const isHidden = offscreenState !== null;
      if (isHidden) {
        // Nested Offscreen tree is still hidden. Don't re-appear its effects.
      } else {
        recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
      }
      // TODO: Check flags & Ref
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
        if (isDevelopment) {
          if (flags & ViewTransitionNamedStatic) {
            trackNamedViewTransition(finishedWork);
          }
        }
        safelyAttachRef(finishedWork, finishedWork.return);
        break;
      }
      break;
    }
    case Fragment: {
      if (enableFragmentRefs) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
      break;
    }
    default: {
      recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

function recursivelyTraverseReappearLayoutEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
): void {
  // This function visits both newly finished work and nodes that were
  // re-used from a previously committed tree. We cannot check non-static
  // flags if the node was reused.
  const childLayoutEffectTraversalFlags =
    (parentFiber.subtreeFlags & LayoutMask) !== NoFlags
      ? layoutEffectTraversalFlags
      : layoutEffectTraversalFlags & ~IncludeWorkInProgressEffects;

  // TODO (Offscreen) Check: flags & (RefStatic | LayoutStatic)
  let child = parentFiber.child;
  while (child !== null) {
    const current = child.alternate;
    reappearLayoutEffects(finishedRoot, current, child, childLayoutEffectTraversalFlags);
    child = child.sibling;
  }
}

// The cache a CacheComponent or HostRoot holds in its memoizedState.
interface CacheState {
  cache: Cache;
}

function commitOffscreenPassiveMountEffects(
  current: Fiber | null,
  finishedWork: Fiber,
  _instance: OffscreenInstance,
): void {
  let previousCache: Cache | null = null;
  const currentState = current !== null ? (current.memoizedState as OffscreenState | null) : null;
  if (currentState !== null && currentState.cachePool !== null) {
    previousCache = currentState.cachePool.pool;
  }
  let nextCache: Cache | null = null;
  const nextState = finishedWork.memoizedState as OffscreenState | null;
  if (nextState !== null && nextState.cachePool !== null) {
    nextCache = nextState.cachePool.pool;
  }
  // Retain/release the cache used for pending (suspended) nodes.
  // Note that this is only reached in the non-suspended/visible case: when
  // the content is suspended/hidden, the retain/release occurs via the
  // parent Suspense component (see case above).
  if (nextCache !== previousCache) {
    if (nextCache != null) {
      retainCache(nextCache);
    }
    if (previousCache != null) {
      releaseCache(previousCache);
    }
  }

  // enableTransitionTracing: tracking the boundary's transitions and
  // markers is not ported.
}

function commitCachePassiveMountEffect(_current: Fiber | null, finishedWork: Fiber): void {
  let previousCache: Cache | null = null;
  if (finishedWork.alternate !== null) {
    previousCache = (finishedWork.alternate.memoizedState as CacheState).cache;
  }
  const nextCache = (finishedWork.memoizedState as CacheState).cache;
  // Retain/release the cache. In theory the cache component could be
  // "borrowing" a cache instance owned by some parent, in which case we could
  // avoid retaining/releasing. But it is non-trivial to determine when that
  // is the case, so we always retain/release.
  if (nextCache !== previousCache) {
    retainCache(nextCache);
    if (previousCache != null) {
      releaseCache(previousCache);
    }
  }
}

// enableTransitionTracing: commitTracingMarkerPassiveMountEffect is not
// ported.

export function commitPassiveMountEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  renderEndTime: number, // Profiling-only
): void {
  resetComponentEffectTimers();

  commitPassiveMountOnFiber(
    root,
    finishedWork,
    committedLanes,
    committedTransitions,
    enableProfilerTimer && enableComponentPerformanceTrack ? renderEndTime : 0,
  );
}

function recursivelyTraversePassiveMountEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  endTime: number, // Profiling-only. The start time of the next Fiber or root completion.
): void {
  const isViewTransitionEligible = enableViewTransition && includesOnlyViewTransitionEligibleLanes(committedLanes);
  // TODO: We could optimize this by marking these with the Passive subtree
  // flag in the render phase.
  const subtreeMask = isViewTransitionEligible ? PassiveTransitionMask : PassiveMask;
  if (
    parentFiber.subtreeFlags & subtreeMask ||
    // If this subtree rendered with profiling this commit, we need to visit
    // it to log it.
    (enableProfilerTimer &&
      enableComponentPerformanceTrack &&
      parentFiber.actualDuration !== 0 &&
      (parentFiber.alternate === null || parentFiber.alternate.child !== parentFiber.child))
  ) {
    let child = parentFiber.child;
    while (child !== null) {
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const nextSibling: Fiber | null = child.sibling;
        commitPassiveMountOnFiber(
          root,
          child,
          committedLanes,
          committedTransitions,
          nextSibling !== null ? nextSibling.actualStartTime : endTime,
        );
        child = nextSibling;
      } else {
        commitPassiveMountOnFiber(root, child, committedLanes, committedTransitions, 0);
        child = child.sibling;
      }
    }
  } else if (isViewTransitionEligible) {
    // We are inside an updated subtree. Any mutations that affected the
    // parent HostInstance's layout or set of children (such as reorders)
    // might have also affected the positioning or size of the inner
    // ViewTransitions. Therefore we need to restore those too.
    restoreNestedViewTransitions(parentFiber);
  }
}

let inHydratedSubtree = false;

// Whether a boundary that was dehydrated hydrated (or was abandoned), for
// the performance track. `wasDehydrated` is the boundary's previous state.
function trackHydratedSubtree(
  finishedWork: Fiber,
  endTime: number,
  wasDehydrated: boolean,
  hydrationErrors: Parameters<typeof logComponentErrored>[3] | null,
): void {
  if (wasDehydrated) {
    // This was dehydrated but is no longer dehydrated. We may have now either
    // hydrated it or client rendered it.
    const deletions = finishedWork.deletions;
    if (deletions !== null && deletions.length > 0 && deletions[0]!.tag === DehydratedFragment) {
      // This was an abandoned hydration that deleted the dehydrated fragment.
      // That means we are not hydrating this Suspense boundary.
      inHydratedSubtree = false;
      // If there were no hydration errors, that suggests that this was an
      // intentional client rendered boundary.
      if (hydrationErrors !== null) {
        const startTime = finishedWork.actualStartTime;
        logComponentErrored(finishedWork, startTime, endTime, hydrationErrors);
      }
    } else {
      // If any children committed they were hydrated.
      inHydratedSubtree = true;
    }
  } else {
    inHydratedSubtree = false;
  }
}

function commitPassiveMountOnFiber(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  endTime: number, // Profiling-only. The start time of the next Fiber or root completion.
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  const prevDeepEquality = pushDeepEquality();

  const isViewTransitionEligible = enableViewTransition ? includesOnlyViewTransitionEligibleLanes(committedLanes) : false;

  if (
    isViewTransitionEligible &&
    finishedWork.alternate === null &&
    // We can't use the Placement flag here because it gets reset earlier.
    // Instead, we check if this is the root of the insertion by checking if
    // the parent was previous existing.
    finishedWork.return !== null &&
    finishedWork.return.alternate !== null
  ) {
    // This was a new mount. This means we could've triggered an enter
    // animation on the content. Restore the view transitions if there were
    // any assigned in the snapshot phase.
    restoreEnterOrExitViewTransitions(finishedWork);
  }

  // When updating this function, also update reconnectPassiveEffects, which
  // does most of the same things when an offscreen tree goes from hidden ->
  // visible, or when toggling effects inside a hidden tree.
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // If this component rendered in Profiling mode (DEV or in Profiler
      // component) then log its render time. We do this after the fact in
      // the passive effect to avoid the overhead of this getting in the way
      // of the render characteristics and avoid the overhead of unwinding
      // uncommitted renders.
      if (
        enableProfilerTimer &&
        enableComponentPerformanceTrack &&
        (finishedWork.mode & ProfileMode) !== NoMode &&
        finishedWork.actualStartTime > 0 &&
        (finishedWork.flags & PerformedWork) !== NoFlags
      ) {
        logComponentRender(finishedWork, finishedWork.actualStartTime, endTime, inHydratedSubtree, committedLanes);
      }

      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      if (flags & Passive) {
        commitHookPassiveMountEffects(finishedWork, HookPassive | HookHasEffect);
      }
      break;
    }
    case ClassComponent: {
      // If this component rendered in Profiling mode (DEV or in Profiler
      // component) then log its render time. We do this after the fact in
      // the passive effect to avoid the overhead of this getting in the way
      // of the render characteristics and avoid the overhead of unwinding
      // uncommitted renders.
      if (
        enableProfilerTimer &&
        enableComponentPerformanceTrack &&
        (finishedWork.mode & ProfileMode) !== NoMode &&
        finishedWork.actualStartTime > 0
      ) {
        if ((finishedWork.flags & DidCapture) !== NoFlags) {
          logComponentErrored(
            finishedWork,
            finishedWork.actualStartTime,
            endTime,
            // TODO: The captured values are all hidden inside the
            // updater/callback closures so we can't get to the errors but
            // they're there so we should be able to log them.
            [],
          );
        } else if ((finishedWork.flags & PerformedWork) !== NoFlags) {
          logComponentRender(finishedWork, finishedWork.actualStartTime, endTime, inHydratedSubtree, committedLanes);
        }
      }

      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      const wasInHydratedSubtree = inHydratedSubtree;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        // Detect if this was a hydration commit by look at if the previous
        // state was dehydrated and this wasn't a forced client render.
        inHydratedSubtree =
          finishedWork.alternate !== null &&
          (finishedWork.alternate.memoizedState as RootState).isDehydrated &&
          (finishedWork.flags & ForceClientRender) === NoFlags;
      }

      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);

      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        inHydratedSubtree = wasInHydratedSubtree;
      }

      if (isViewTransitionEligible) {
        if (supportsMutation && rootViewTransitionNameCanceled) {
          restoreRootViewTransitionName(finishedRoot.containerInfo);
        }
      }

      if (flags & Passive) {
        let previousCache: Cache | null = null;
        if (finishedWork.alternate !== null) {
          previousCache = (finishedWork.alternate.memoizedState as RootState).cache;
        }
        const nextCache = (finishedWork.memoizedState as RootState).cache;
        // Retain/release the root cache.
        // Note that on initial mount, previousCache and nextCache will be the
        // same and this retain won't occur. To counter this, we instead
        // retain the HostRoot's initial cache when creating the root itself
        // (see createFiberRoot() in ReactFiberRoot.js). Subsequent updates
        // that change the cache are reflected here, such that previous/next
        // caches are retained correctly.
        if (nextCache !== previousCache) {
          retainCache(nextCache);
          if (previousCache != null) {
            releaseCache(previousCache);
          }
        }

        // enableTransitionTracing: transition start/complete callbacks are
        // not ported.
      }
      if (enableProfilerTimer && enableProfilerCommitHooks) {
        finishedRoot.passiveEffectDuration += popNestedEffectDurations(prevProfilerEffectDuration);
      }
      break;
    }
    case Profiler: {
      // Only Profilers with work in their subtree will have a Passive effect
      // scheduled.
      if (flags & Passive) {
        const prevProfilerEffectDuration = pushNestedEffectDurations();

        recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);

        const profilerInstance = finishedWork.stateNode as ProfilerStateNode;

        if (enableProfilerTimer && enableProfilerCommitHooks) {
          // Bubble times to the next nearest ancestor Profiler.
          // After we process that Profiler, we'll bubble further up.
          profilerInstance.passiveEffectDuration += bubbleNestedEffectDurations(prevProfilerEffectDuration);
        }

        commitProfilerPostCommit(
          finishedWork,
          finishedWork.alternate,
          // This value will still reflect the previous commit phase.
          // It does not get reset until the start of the next commit phase.
          commitStartTime,
          profilerInstance.passiveEffectDuration,
        );
      } else {
        recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      }
      break;
    }
    case ActivityComponent: {
      const wasInHydratedSubtree = inHydratedSubtree;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const prevState =
          finishedWork.alternate !== null ? (finishedWork.alternate.memoizedState as ActivityState | null) : null;
        const nextState = finishedWork.memoizedState as ActivityState | null;
        trackHydratedSubtree(
          finishedWork,
          endTime,
          prevState !== null && nextState === null,
          prevState !== null ? prevState.hydrationErrors : null,
        );
      }

      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);

      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        inHydratedSubtree = wasInHydratedSubtree;
      }
      break;
    }
    case SuspenseComponent: {
      const wasInHydratedSubtree = inHydratedSubtree;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const prevState =
          finishedWork.alternate !== null ? (finishedWork.alternate.memoizedState as SuspenseState | null) : null;
        const nextState = finishedWork.memoizedState as SuspenseState | null;
        trackHydratedSubtree(
          finishedWork,
          endTime,
          prevState !== null && prevState.dehydrated !== null && (nextState === null || nextState.dehydrated === null),
          prevState !== null ? prevState.hydrationErrors : null,
        );
      }

      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);

      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        inHydratedSubtree = wasInHydratedSubtree;
      }
      break;
    }
    case LegacyHiddenComponent: {
      // enableLegacyHidden: the legacy hidden component's passive effects
      // are not ported.
      break;
    }
    case OffscreenComponent: {
      // TODO: Pass `current` as argument to this function
      const instance = finishedWork.stateNode as OffscreenInstance;
      const current = finishedWork.alternate;
      const nextState = finishedWork.memoizedState as OffscreenState | null;

      const isHidden = nextState !== null;

      if (isHidden) {
        if (isViewTransitionEligible && current !== null && current.memoizedState === null) {
          // Content is now hidden but wasn't before. This means we could've
          // triggered an exit animation on the content. Restore the view
          // transitions if there were any assigned in the snapshot phase.
          restoreEnterOrExitViewTransitions(current);
        }
        if (instance._visibility & OffscreenPassiveEffectsConnected) {
          // The effects are currently connected. Update them.
          recursivelyTraversePassiveMountEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            endTime,
          );
        } else {
          if (disableLegacyMode || finishedWork.mode & ConcurrentMode) {
            // The effects are currently disconnected. Since the tree is
            // hidden, don't connect them. This also applies to the initial
            // render. "Atomic" effects are ones that need to fire on every
            // commit, even during pre-rendering. An example is updating the
            // reference count on cache instances.
            recursivelyTraverseAtomicPassiveEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              endTime,
            );
          } else {
            // Legacy Mode: Fire the effects even if the tree is hidden.
            instance._visibility |= OffscreenPassiveEffectsConnected;
            recursivelyTraversePassiveMountEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              endTime,
            );
          }
        }
      } else {
        // Tree is visible
        if (isViewTransitionEligible && current !== null && current.memoizedState !== null) {
          // Content is now visible but wasn't before. This means we could've
          // triggered an enter animation on the content. Restore the view
          // transitions if there were any assigned in the snapshot phase.
          restoreEnterOrExitViewTransitions(finishedWork);
        }
        if (instance._visibility & OffscreenPassiveEffectsConnected) {
          // The effects are currently connected. Update them.
          recursivelyTraversePassiveMountEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            endTime,
          );
        } else {
          // The effects are currently disconnected. Reconnect them, while
          // also firing effects inside newly mounted trees. This also applies
          // to the initial render.
          instance._visibility |= OffscreenPassiveEffectsConnected;

          const includeWorkInProgressEffects =
            (finishedWork.subtreeFlags & PassiveMask) !== NoFlags ||
            (enableProfilerTimer &&
              enableComponentPerformanceTrack &&
              finishedWork.actualDuration !== 0 &&
              (finishedWork.alternate === null || finishedWork.alternate.child !== finishedWork.child));
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects,
            endTime,
          );

          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            enableComponentPerformanceTrack &&
            (finishedWork.mode & ProfileMode) !== NoMode &&
            !inHydratedSubtree
          ) {
            // Log the reappear in the render phase.
            const startTime = finishedWork.actualStartTime;
            if (startTime >= 0 && endTime - startTime > 0.05) {
              logComponentReappeared(finishedWork, startTime, endTime);
            }
            if (
              componentEffectStartTime >= 0 &&
              componentEffectEndTime >= 0 &&
              componentEffectEndTime - componentEffectStartTime > 0.05
            ) {
              logComponentReappeared(finishedWork, componentEffectStartTime, componentEffectEndTime);
            }
          }
        }
      }

      if (flags & Passive) {
        commitOffscreenPassiveMountEffects(current, finishedWork, instance);
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      if (flags & Passive) {
        // TODO: Pass `current` as argument to this function
        const current = finishedWork.alternate;
        commitCachePassiveMountEffect(current, finishedWork);
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (isViewTransitionEligible) {
          const current = finishedWork.alternate;
          if (current === null) {
            // This is a new mount. We should have handled this as part of the
            // Placement effect or it is deeper inside a entering transition.
          } else {
            // Something mutated within this subtree. This might have caused
            // something to cross-fade if we didn't already cancel it.
            // If not, restore it.
            restoreUpdateViewTransition(current, finishedWork);
          }
        }
        recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
        break;
      }
      // Upstream falls through to TracingMarkerComponent, then to default.
      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      break;
    }
    case TracingMarkerComponent:
    // enableTransitionTracing: TracingMarker passive effects are not ported;
    // upstream falls through to the default case.
    default: {
      recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode
  ) {
    const isMount =
      !inHydratedSubtree &&
      finishedWork.alternate === null &&
      finishedWork.return !== null &&
      finishedWork.return.alternate !== null;
    if (isMount) {
      // Log the mount in the render phase.
      const startTime = finishedWork.actualStartTime;
      if (startTime >= 0 && endTime - startTime > 0.05) {
        logComponentMount(finishedWork, startTime, endTime);
      }
    }
    if (componentEffectStartTime >= 0 && componentEffectEndTime >= 0) {
      if (componentEffectSpawnedUpdate || componentEffectDuration > 0.05) {
        logComponentEffect(
          finishedWork,
          componentEffectStartTime,
          componentEffectEndTime,
          componentEffectDuration,
          componentEffectErrors,
        );
      }
      if (isMount && componentEffectEndTime - componentEffectStartTime > 0.05) {
        logComponentMount(finishedWork, componentEffectStartTime, componentEffectEndTime);
      }
    }
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popDeepEquality(prevDeepEquality);
}

function recursivelyTraverseReconnectPassiveEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  includeWorkInProgressEffects: boolean,
  endTime: number,
): void {
  // This function visits both newly finished work and nodes that were
  // re-used from a previously committed tree. We cannot check non-static
  // flags if the node was reused.
  const childShouldIncludeWorkInProgressEffects =
    includeWorkInProgressEffects &&
    ((parentFiber.subtreeFlags & PassiveMask) !== NoFlags ||
      (enableProfilerTimer &&
        enableComponentPerformanceTrack &&
        parentFiber.actualDuration !== 0 &&
        (parentFiber.alternate === null || parentFiber.alternate.child !== parentFiber.child)));

  // TODO (Offscreen) Check: flags & (RefStatic | LayoutStatic)
  let child = parentFiber.child;
  while (child !== null) {
    if (enableProfilerTimer && enableComponentPerformanceTrack) {
      const nextSibling: Fiber | null = child.sibling;
      reconnectPassiveEffects(
        finishedRoot,
        child,
        committedLanes,
        committedTransitions,
        childShouldIncludeWorkInProgressEffects,
        nextSibling !== null ? nextSibling.actualStartTime : endTime,
      );
      child = nextSibling;
    } else {
      reconnectPassiveEffects(
        finishedRoot,
        child,
        committedLanes,
        committedTransitions,
        childShouldIncludeWorkInProgressEffects,
        endTime,
      );
      child = child.sibling;
    }
  }
}

export function reconnectPassiveEffects(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  // This function visits both newly finished work and nodes that were
  // re-used from a previously committed tree. We cannot check non-static
  // flags if the node was reused.
  includeWorkInProgressEffects: boolean,
  endTime: number, // Profiling-only. The start time of the next Fiber or root completion.
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  const prevDeepEquality = pushDeepEquality();

  // If this component rendered in Profiling mode (DEV or in Profiler
  // component) then log its render time. We do this after the fact in the
  // passive effect to avoid the overhead of this getting in the way of the
  // render characteristics and avoid the overhead of unwinding uncommitted
  // renders.
  if (
    enableProfilerTimer &&
    enableComponentPerformanceTrack &&
    includeWorkInProgressEffects &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    finishedWork.actualStartTime > 0 &&
    (finishedWork.flags & PerformedWork) !== NoFlags
  ) {
    logComponentRender(finishedWork, finishedWork.actualStartTime, endTime, inHydratedSubtree, committedLanes);
  }

  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseReconnectPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        includeWorkInProgressEffects,
        endTime,
      );
      // TODO: Check for PassiveStatic flag
      commitHookPassiveMountEffects(finishedWork, HookPassive);
      break;
    }
    // Unlike commitPassiveMountOnFiber, we don't need to handle HostRoot
    // because this function only visits nodes that are inside an Offscreen
    // fiber.
    case LegacyHiddenComponent: {
      // enableLegacyHidden: not ported.
      break;
    }
    case OffscreenComponent: {
      const instance = finishedWork.stateNode as OffscreenInstance;
      const nextState = finishedWork.memoizedState as OffscreenState | null;

      const isHidden = nextState !== null;

      if (isHidden) {
        if (instance._visibility & OffscreenPassiveEffectsConnected) {
          // The effects are currently connected. Update them.
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects,
            endTime,
          );
        } else {
          if (disableLegacyMode || finishedWork.mode & ConcurrentMode) {
            // The effects are currently disconnected. Since the tree is
            // hidden, don't connect them. This also applies to the initial
            // render. "Atomic" effects are ones that need to fire on every
            // commit, even during pre-rendering. An example is updating the
            // reference count on cache instances.
            recursivelyTraverseAtomicPassiveEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              endTime,
            );
          } else {
            // Legacy Mode: Fire the effects even if the tree is hidden.
            instance._visibility |= OffscreenPassiveEffectsConnected;
            recursivelyTraverseReconnectPassiveEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              includeWorkInProgressEffects,
              endTime,
            );
          }
        }
      } else {
        // Tree is visible

        // Since we're already inside a reconnecting tree, it doesn't matter
        // whether the effects are currently connected. In either case, we'll
        // continue traversing the tree and firing all the effects.
        //
        // We do need to set the "connected" flag on the instance, though.
        instance._visibility |= OffscreenPassiveEffectsConnected;

        recursivelyTraverseReconnectPassiveEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          includeWorkInProgressEffects,
          endTime,
        );
      }

      if (includeWorkInProgressEffects && flags & Passive) {
        // TODO: Pass `current` as argument to this function
        const current: Fiber | null = finishedWork.alternate;
        commitOffscreenPassiveMountEffects(current, finishedWork, instance);
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraverseReconnectPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        includeWorkInProgressEffects,
        endTime,
      );
      if (includeWorkInProgressEffects && flags & Passive) {
        // TODO: Pass `current` as argument to this function
        const current = finishedWork.alternate;
        commitCachePassiveMountEffect(current, finishedWork);
      }
      break;
    }
    case TracingMarkerComponent:
    // enableTransitionTracing: not ported; upstream falls through to the
    // default case.
    default: {
      recursivelyTraverseReconnectPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        includeWorkInProgressEffects,
        endTime,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popDeepEquality(prevDeepEquality);
}

function recursivelyTraverseAtomicPassiveEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  endTime: number, // Profiling-only. The start time of the next Fiber or root completion.
): void {
  // "Atomic" effects are ones that need to fire on every commit, even during
  // pre-rendering. We call this function when traversing a hidden tree whose
  // regular effects are currently disconnected.
  // TODO: Add special flag for atomic effects
  if (
    parentFiber.subtreeFlags & PassiveMask ||
    (enableProfilerTimer &&
      enableComponentPerformanceTrack &&
      parentFiber.actualDuration !== 0 &&
      (parentFiber.alternate === null || parentFiber.alternate.child !== parentFiber.child))
  ) {
    let child = parentFiber.child;
    while (child !== null) {
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const nextSibling: Fiber | null = child.sibling;
        commitAtomicPassiveEffects(
          finishedRoot,
          child,
          committedLanes,
          committedTransitions,
          nextSibling !== null ? nextSibling.actualStartTime : endTime,
        );
        child = nextSibling;
      } else {
        commitAtomicPassiveEffects(finishedRoot, child, committedLanes, committedTransitions, endTime);
        child = child.sibling;
      }
    }
  }
}

function commitAtomicPassiveEffects(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Transition[] | null,
  endTime: number, // Profiling-only. The start time of the next Fiber or root completion.
): void {
  const prevDeepEquality = pushDeepEquality();

  // If this component rendered in Profiling mode (DEV or in Profiler
  // component) then log its render time. A render can happen even if the
  // subtree is offscreen.
  if (
    enableProfilerTimer &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    finishedWork.actualStartTime > 0 &&
    (finishedWork.flags & PerformedWork) !== NoFlags
  ) {
    logComponentRender(finishedWork, finishedWork.actualStartTime, endTime, inHydratedSubtree, committedLanes);
  }

  // "Atomic" effects are ones that need to fire on every commit, even during
  // pre-rendering. We call this function when traversing a hidden tree whose
  // regular effects are currently disconnected.
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case OffscreenComponent: {
      recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      if (flags & Passive) {
        // TODO: Pass `current` as argument to this function
        const current = finishedWork.alternate;
        const instance = finishedWork.stateNode as OffscreenInstance;
        commitOffscreenPassiveMountEffects(current, finishedWork, instance);
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      if (flags & Passive) {
        // TODO: Pass `current` as argument to this function
        const current = finishedWork.alternate;
        commitCachePassiveMountEffect(current, finishedWork);
      }
      break;
    }
    default: {
      recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, endTime);
      break;
    }
  }

  popDeepEquality(prevDeepEquality);
}

export function commitPassiveUnmountEffects(finishedWork: Fiber): void {
  resetComponentEffectTimers();
  commitPassiveUnmountOnFiber(finishedWork);
}

// If we're inside a brand new tree, or a tree that was already visible, then
// we should only suspend host components that have a ShouldSuspendCommit
// flag. Components without it haven't changed since the last commit, so we
// can skip over those.
//
// When we enter a tree that is being revealed (going from hidden -> visible),
// we need to suspend _any_ component that _may_ suspend. Even if they're
// already in the "current" tree. Because their visibility has changed, the
// browser may not have prerendered them yet. So we check the MaySuspendCommit
// flag instead.
//
// Note that MaySuspendCommit and ShouldSuspendCommit also includes named
// ViewTransitions so that we know to also visit those to collect appearing
// pairs.
let suspenseyCommitFlag: Flags = ShouldSuspendCommit;
export function accumulateSuspenseyCommit(
  finishedWork: Fiber,
  committedLanes: Lanes,
  suspendedState: SuspendedState,
): void {
  resetAppearingViewTransitions();
  accumulateSuspenseyCommitOnFiber(finishedWork, committedLanes, suspendedState);
}

function recursivelyAccumulateSuspenseyCommit(
  parentFiber: Fiber,
  committedLanes: Lanes,
  suspendedState: SuspendedState,
): void {
  if (parentFiber.subtreeFlags & suspenseyCommitFlag) {
    let child = parentFiber.child;
    while (child !== null) {
      accumulateSuspenseyCommitOnFiber(child, committedLanes, suspendedState);
      child = child.sibling;
    }
  }
}

function suspendHostInstance(fiber: Fiber, committedLanes: Lanes, suspendedState: SuspendedState): void {
  const instance = fiber.stateNode as Instance;
  const type = fiber.type as string;
  const props = fiber.memoizedProps as Props;
  // TODO: Allow sync lanes to suspend too with an opt-in.
  if (includesOnlySuspenseyCommitEligibleLanes(committedLanes) || maySuspendCommitInSyncRender(type, props)) {
    suspendInstance(suspendedState, instance, type, props);
  }
}

function accumulateSuspenseyCommitOnFiber(fiber: Fiber, committedLanes: Lanes, suspendedState: SuspendedState): void {
  switch (fiber.tag) {
    case HostHoistable: {
      recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
      if (fiber.flags & suspenseyCommitFlag) {
        if (fiber.memoizedState !== null) {
          suspendResource(
            suspendedState,
            // This should always be set by visiting HostRoot first
            currentHoistableRoot as HoistableRoot,
            fiber.memoizedState,
            fiber.memoizedProps as Props,
          );
        } else {
          suspendHostInstance(fiber, committedLanes, suspendedState);
        }
      }
      break;
    }
    case HostComponent: {
      recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
      if (fiber.flags & suspenseyCommitFlag) {
        suspendHostInstance(fiber, committedLanes, suspendedState);
      }
      break;
    }
    case HostRoot:
    case HostPortal: {
      if (supportsResources) {
        const previousHoistableRoot = currentHoistableRoot;
        const container = containerInfoOf(fiber);
        currentHoistableRoot = getHoistableRoot(container);

        recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
        currentHoistableRoot = previousHoistableRoot;
      } else {
        recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
      }
      break;
    }
    case OffscreenComponent: {
      const isHidden = (fiber.memoizedState as OffscreenState | null) !== null;
      if (isHidden) {
        // Don't suspend in hidden trees
      } else {
        const current = fiber.alternate;
        const wasHidden = current !== null && (current.memoizedState as OffscreenState | null) !== null;
        if (wasHidden) {
          // This tree is being revealed. Visit all newly visible suspensey
          // instances, even if they're in the current tree.
          const prevFlags = suspenseyCommitFlag;
          suspenseyCommitFlag = MaySuspendCommit;
          recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
          suspenseyCommitFlag = prevFlags;
        } else {
          recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
        }
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if ((fiber.flags & suspenseyCommitFlag) !== NoFlags) {
          const props = fiber.memoizedProps as ViewTransitionProps;
          const name: string | null | undefined = props.name;
          if (name != null && name !== "auto") {
            // This is a named ViewTransition being mounted or reappearing.
            // Let's add it to the map so we can match it with deletions
            // later.
            const state = fiber.stateNode as ViewTransitionState;
            // Reset the pair in case we didn't end up restoring the instance
            // in previous commits. This shouldn't really happen anymore but
            // just in case. We could maybe add an invariant.
            state.paired = null;
            trackAppearingViewTransition(name, state);
          }
        }
        recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
        break;
      }
      recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
      break;
    }
    default: {
      recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
    }
  }
}

function detachAlternateSiblings(parentFiber: Fiber): void {
  // A fiber was deleted from this parent fiber, but it's still part of the
  // previous (alternate) parent fiber's list of children. Because children
  // are a linked list, an earlier sibling that's still alive will be
  // connected to the deleted fiber via its `alternate`:
  //
  //   live fiber --alternate--> previous live fiber --sibling--> deleted
  //   fiber
  //
  // We can't disconnect `alternate` on nodes that haven't been deleted yet,
  // but we can disconnect the `sibling` and `child` pointers.

  const previousFiber = parentFiber.alternate;
  if (previousFiber !== null) {
    let detachedChild = previousFiber.child;
    if (detachedChild !== null) {
      previousFiber.child = null;
      do {
        const detachedSibling: Fiber | null = detachedChild.sibling;
        detachedChild.sibling = null;
        detachedChild = detachedSibling;
      } while (detachedChild !== null);
    }
  }
}

function recursivelyTraversePassiveUnmountEffects(parentFiber: Fiber): void {
  // Deletions effects can be scheduled on any fiber type. They need to
  // happen before the children effects have fired.
  const deletions = parentFiber.deletions;

  if ((parentFiber.flags & ChildDeletion) !== NoFlags) {
    if (deletions !== null) {
      for (let i = 0; i < deletions.length; i++) {
        const childToDelete = deletions[i]!;
        const prevEffectStart = pushComponentEffectStart();
        // TODO: Convert this to use recursion
        nextEffect = childToDelete;
        commitPassiveUnmountEffectsInsideOfDeletedTree_begin(childToDelete, parentFiber);
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (childToDelete.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          logComponentUnmount(childToDelete, componentEffectStartTime, componentEffectEndTime);
        }
        popComponentEffectStart(prevEffectStart);
      }
    }
    detachAlternateSiblings(parentFiber);
  }

  // TODO: Split PassiveMask into separate masks for mount and unmount?
  if (parentFiber.subtreeFlags & PassiveMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitPassiveUnmountOnFiber(child);
      child = child.sibling;
    }
  }
}

function commitPassiveUnmountOnFiber(finishedWork: Fiber): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      if (finishedWork.flags & Passive) {
        commitHookPassiveUnmountEffects(finishedWork, finishedWork.return, HookPassive | HookHasEffect);
      }
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      if (enableProfilerTimer && enableProfilerCommitHooks) {
        const finishedRoot = finishedWork.stateNode as FiberRoot;
        finishedRoot.passiveEffectDuration += popNestedEffectDurations(prevProfilerEffectDuration);
      }
      break;
    }
    case Profiler: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      recursivelyTraversePassiveUnmountEffects(finishedWork);

      if (enableProfilerTimer && enableProfilerCommitHooks) {
        const profilerInstance = finishedWork.stateNode as ProfilerStateNode;
        // Propagate layout effect durations to the next nearest Profiler
        // ancestor. Do not reset these values until the next render so
        // DevTools has a chance to read them first.
        profilerInstance.passiveEffectDuration += bubbleNestedEffectDurations(prevProfilerEffectDuration);
      }
      break;
    }
    case OffscreenComponent: {
      const instance = finishedWork.stateNode as OffscreenInstance;
      const nextState = finishedWork.memoizedState as OffscreenState | null;

      const isHidden = nextState !== null;

      if (
        isHidden &&
        instance._visibility & OffscreenPassiveEffectsConnected &&
        // For backwards compatibility, don't unmount when a tree suspends. In
        // the future we may change this to unmount after a delay.
        (finishedWork.return === null || finishedWork.return.tag !== SuspenseComponent)
      ) {
        // The effects are currently connected. Disconnect them.
        // TODO: Add option or heuristic to delay before disconnecting the
        // effects. Then if the tree reappears before the delay has elapsed,
        // we can skip toggling the effects entirely.
        instance._visibility &= ~OffscreenPassiveEffectsConnected;

        recursivelyTraverseDisconnectPassiveEffects(finishedWork);

        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (finishedWork.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          logComponentDisappeared(finishedWork, componentEffectStartTime, componentEffectEndTime);
        }
      } else {
        recursivelyTraversePassiveUnmountEffects(finishedWork);
      }

      break;
    }
    default: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popComponentEffectErrors(prevEffectErrors);
}

function recursivelyTraverseDisconnectPassiveEffects(parentFiber: Fiber): void {
  // Deletions effects can be scheduled on any fiber type. They need to
  // happen before the children effects have fired.
  const deletions = parentFiber.deletions;

  if ((parentFiber.flags & ChildDeletion) !== NoFlags) {
    if (deletions !== null) {
      for (let i = 0; i < deletions.length; i++) {
        const childToDelete = deletions[i]!;
        const prevEffectStart = pushComponentEffectStart();

        // TODO: Convert this to use recursion
        nextEffect = childToDelete;
        commitPassiveUnmountEffectsInsideOfDeletedTree_begin(childToDelete, parentFiber);

        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (childToDelete.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          // While this is inside the disconnect path. This is a deletion
          // within the disconnected tree. We currently log this for deletions
          // in the mutation phase since it's shared by the disappear path.
          logComponentUnmount(childToDelete, componentEffectStartTime, componentEffectEndTime);
        }
        popComponentEffectStart(prevEffectStart);
      }
    }
    detachAlternateSiblings(parentFiber);
  }

  // TODO: Check PassiveStatic flag
  let child = parentFiber.child;
  while (child !== null) {
    disconnectPassiveEffect(child);
    child = child.sibling;
  }
}

export function disconnectPassiveEffect(finishedWork: Fiber): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // TODO: Check PassiveStatic flag
      commitHookPassiveUnmountEffects(finishedWork, finishedWork.return, HookPassive);
      // When disconnecting passive effects, we fire the effects in the same
      // order as during a deletiong: parent before child
      recursivelyTraverseDisconnectPassiveEffects(finishedWork);
      break;
    }
    case OffscreenComponent: {
      const instance = finishedWork.stateNode as OffscreenInstance;
      if (instance._visibility & OffscreenPassiveEffectsConnected) {
        instance._visibility &= ~OffscreenPassiveEffectsConnected;
        recursivelyTraverseDisconnectPassiveEffects(finishedWork);
      } else {
        // The effects are already disconnected.
      }
      break;
    }
    default: {
      recursivelyTraverseDisconnectPassiveEffects(finishedWork);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popComponentEffectErrors(prevEffectErrors);
}

function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
  deletedSubtreeRoot: Fiber,
  nearestMountedAncestor: Fiber | null,
): void {
  while (nextEffect !== null) {
    const fiber: Fiber = nextEffect;

    // Deletion effects fire in parent -> child order
    // TODO: Check if fiber has a PassiveStatic flag
    commitPassiveUnmountInsideDeletedTreeOnFiber(fiber, nearestMountedAncestor);

    const child = fiber.child;
    // TODO: Only traverse subtree if it has a PassiveStatic flag.
    if (child !== null) {
      child.return = fiber;
      nextEffect = child;
    } else {
      commitPassiveUnmountEffectsInsideOfDeletedTree_complete(deletedSubtreeRoot);
    }
  }
}

function commitPassiveUnmountEffectsInsideOfDeletedTree_complete(deletedSubtreeRoot: Fiber): void {
  while (nextEffect !== null) {
    const fiber: Fiber = nextEffect;
    const sibling = fiber.sibling;
    const returnFiber = fiber.return;

    // Recursively traverse the entire deleted tree and clean up fiber
    // fields. This is more aggressive than ideal, and the long term goal is
    // to only have to detach the deleted tree at the root.
    detachFiberAfterEffects(fiber);
    if (fiber === deletedSubtreeRoot) {
      nextEffect = null;
      return;
    }

    if (sibling !== null) {
      sibling.return = returnFiber;
      nextEffect = sibling;
      return;
    }

    nextEffect = returnFiber;
  }
}

function commitPassiveUnmountInsideDeletedTreeOnFiber(current: Fiber, nearestMountedAncestor: Fiber | null): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  switch (current.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      commitHookPassiveUnmountEffects(current, nearestMountedAncestor, HookPassive);
      break;
    }
    // TODO: run passive unmount effects when unmounting a root.
    // Because passive unmount effects are not currently run, the cache
    // instance owned by the root will never be freed. When effects are run,
    // the cache should be freed here:
    // case HostRoot: {
    //   const cache = current.memoizedState.cache;
    //   releaseCache(cache);
    //   break;
    // }
    case LegacyHiddenComponent:
    case OffscreenComponent: {
      const state = current.memoizedState as OffscreenState | null;
      if (state !== null && state.cachePool !== null) {
        const cache: Cache | null | undefined = state.cachePool.pool;
        // Retain/release the cache used for pending (suspended) nodes.
        // Note that this is only reached in the non-suspended/visible case:
        // when the content is suspended/hidden, the retain/release occurs
        // via the parent Suspense component (see case above).
        if (cache != null) {
          retainCache(cache);
        }
      }
      break;
    }
    case SuspenseComponent: {
      // enableTransitionTracing: aborting the boundary's transitions is not
      // ported.
      break;
    }
    case CacheComponent: {
      const cache = (current.memoizedState as CacheState).cache;
      releaseCache(cache);
      break;
    }
    case TracingMarkerComponent: {
      // enableTransitionTracing: aborting the marker's transitions is not
      // ported.
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (current.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      current,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popComponentEffectErrors(prevEffectErrors);
}

export function invokeLayoutEffectMountInDEV(fiber: Fiber): void {
  if (isDevelopment) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListMount(HookLayout | HookHasEffect, fiber);
        break;
      }
      case ClassComponent: {
        commitClassDidMount(fiber);
        break;
      }
    }
  }
}

export function invokePassiveEffectMountInDEV(fiber: Fiber): void {
  if (isDevelopment) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListMount(HookPassive | HookHasEffect, fiber);
        break;
      }
    }
  }
}

export function invokeLayoutEffectUnmountInDEV(fiber: Fiber): void {
  if (isDevelopment) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListUnmount(HookLayout | HookHasEffect, fiber, fiber.return);
        break;
      }
      case ClassComponent: {
        const instance = fiber.stateNode as CommitClassInstance;
        if (typeof instance.componentWillUnmount === "function") {
          safelyCallComponentWillUnmount(fiber, fiber.return, instance);
        }
        break;
      }
    }
  }
}

export function invokePassiveEffectUnmountInDEV(fiber: Fiber): void {
  if (isDevelopment) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListUnmount(HookPassive | HookHasEffect, fiber, fiber.return);
      }
    }
  }
}

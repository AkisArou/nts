// The work loop: renders roots (the render phase), then commits the finished
// tree (the commit phase), and handles everything that can interrupt either
// one: suspending, errors, yielding to the host, and nested updates.

import { hostInstanceOf } from "./ReactFiberStateNode.ts";
import { isDevelopment } from "shared/Build.ts";
import { reportGlobalError } from "shared/reportGlobalError.ts";
import { REACT_STRICT_MODE_TYPE } from "shared/ReactSymbols.ts";
import type { Thenable, Transition, TransitionTypes, Wakeable } from "shared/ReactTypes.ts";
import {
  alwaysThrottleRetries,
  disableLegacyContext,
  disableLegacyMode,
  enableComponentPerformanceTrack,
  enableCreateEventHandleAPI,
  enableDefaultTransitionIndicator,
  enableGestureTransition,
  enableInfiniteRenderLoopDetection,
  enableInfiniteRenderLoopDetectionForceThrow,
  enableParallelTransitions,
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableProfilerTimer,
  enableSchedulingProfiler,
  enableThrottledScheduling,
  enableTransitionTracing,
  enableUpdaterTracking,
  enableViewTransition,
  enableYieldingBeforePassive,
} from "shared/ReactFeatureFlags.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { Lane, Lanes } from "./ReactFiberLane.ts";
import type { ActivityState } from "./ReactFiberActivityComponent.ts";
import type { SuspenseState } from "./ReactFiberSuspenseComponent.ts";
import type { FunctionComponentUpdateQueue } from "./ReactFiberHooks.ts";
import type { PendingBoundaries, PendingTransitionCallbacks, TransitionAbort } from "./ReactFiberTracingMarkerComponent.ts";
import type { OffscreenInstance } from "./ReactFiberOffscreenComponent.ts";
import type { RunningViewTransition, SuspendedState, ViewTransitionInstance } from "react-reconciler/ReactFiberConfig.ts";
import type { RootState } from "./ReactFiberRoot.ts";
import { getViewTransitionName, type ViewTransitionState } from "./ReactFiberViewTransitionComponent.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import {
  IdlePriority as IdleSchedulerPriority,
  NormalPriority as NormalSchedulerPriority,
  now,
  requestPaint,
  // Aliased because `act` will override and push to an internal queue
  scheduleCallback as Scheduler_scheduleCallback,
  shouldYield,
} from "./Scheduler.ts";
import {
  logActionYieldTime,
  logAnimatingPhase,
  logBlockingStart,
  logCommitPhase,
  logErroredRenderPhase,
  logInconsistentRender,
  logInterruptedRenderPhase,
  logPaintYieldPhase,
  logPassiveCommitPhase,
  logRecoveredRenderPhase,
  logRenderPhase,
  logStartViewTransitionYieldPhase,
  logSuspendedCommitPhase,
  logSuspendedRenderPhase,
  logSuspendedViewTransitionPhase,
  logSuspendedWithDelayPhase,
  logSuspendedYieldTime,
  logTransitionStart,
  logYieldTime,
  markAllLanesInOrder,
  setCurrentTrackFromLanes,
} from "./ReactFiberPerformanceTrack.ts";
import {
  addViewTransitionFinishedListener,
  afterActiveInstanceBlur,
  cancelTimeout,
  createViewTransitionInstance,
  flushHydrationEvents,
  getCurrentUpdatePriority,
  getSuspendedCommitReason,
  noTimeout,
  preloadInstance,
  preloadResource,
  resetAfterCommit,
  resolveUpdatePriority,
  scheduleTimeout,
  setCurrentUpdatePriority,
  startSuspendingCommit,
  startViewTransition,
  stopViewTransition,
  supportsHydration,
  suspendOnActiveViewTransition,
  trackSchedulerEvent,
  waitForCommitToBeReady,
} from "react-reconciler/ReactFiberConfig.ts";
import type { Props } from "react-reconciler/ReactFiberConfig.ts";
import { createWorkInProgress, resetWorkInProgress } from "./ReactFiber.ts";
import { isRootDehydrated } from "./ReactFiberShellHydration.ts";
import { getIsHydrating, popHydrationStateOnInterruptedWork } from "./ReactFiberHydrationContext.ts";
import { ConcurrentMode, NoMode, ProfileMode, StrictEffectsMode, StrictLegacyMode } from "./ReactTypeOfMode.ts";
import {
  ActivityComponent,
  ClassComponent,
  ForwardRef,
  FunctionComponent,
  HostComponent,
  HostHoistable,
  HostRoot,
  HostSingleton,
  MemoComponent,
  OffscreenComponent,
  SimpleMemoComponent,
  SuspenseComponent,
  SuspenseListComponent,
} from "./ReactWorkTags.ts";
import { ConcurrentRoot, LegacyRoot } from "./ReactRootTags.ts";
import type { Flags } from "./ReactFiberFlags.ts";
import {
  BeforeMutationMask,
  DidDefer,
  ForceClientRender,
  HostEffectMask,
  Incomplete,
  LayoutMask,
  MaySuspendCommit,
  MountLayoutDev,
  MountPassiveDev,
  MutationMask,
  NoFlags,
  PassiveMask,
  PassiveTransitionMask,
  PlacementDEV,
  ScheduleRetry,
  ShouldSuspendCommit,
  StoreConsistency,
  Visibility,
} from "./ReactFiberFlags.ts";
import {
  addFiberToLanesMap,
  addTransitionToLanesMap,
  checkIfRootIsPrerendering,
  claimNextRetryLane,
  claimNextTransitionDeferredLane,
  getEntangledLanes,
  getLanesToRetrySynchronouslyOnError,
  getNextLanes,
  getTransitionsForLanes,
  IdleLane,
  includesBlockingLane,
  includesExpiredLane,
  includesIdleGroupLanes,
  includesNonIdleWork,
  includesOnlyRetries,
  includesOnlyTransitions,
  includesOnlyViewTransitionEligibleLanes,
  includesRetryLane,
  includesSomeLane,
  includesSyncLane,
  includesTransitionLane,
  isSubsetOfLanes,
  markRootFinished,
  markRootPinged as _markRootPinged,
  markRootSuspended as _markRootSuspended,
  markRootUpdated as _markRootUpdated,
  mergeLanes,
  movePendingFibersToMemoized,
  NoLane,
  NoLanes,
  OffscreenLane,
  pickArbitraryLane,
  removeLanes,
  SomeRetryLane,
  SomeTransitionLane,
  SyncLane,
  SyncUpdateLanes,
  UpdateLanes,
  upgradePendingLanesToSync,
} from "./ReactFiberLane.ts";
import {
  DefaultEventPriority,
  DiscreteEventPriority,
  eventPriorityToLane,
  lanesToEventPriority,
  lowerEventPriority,
} from "./ReactEventPriorities.ts";
import { requestCurrentTransition } from "./ReactFiberTransition.ts";
import { beginWork, replayFunctionComponent, SelectiveHydrationException } from "./ReactFiberBeginWork.ts";
import { completeWork } from "./ReactFiberCompleteWork.ts";
import { unwindInterruptedWork, unwindWork } from "./ReactFiberUnwindWork.ts";
import {
  createClassErrorUpdate,
  createRootErrorUpdate,
  initializeClassErrorUpdate,
  throwException,
} from "./ReactFiberThrow.ts";
import {
  accumulateSuspenseyCommit,
  commitAfterMutationEffects,
  commitBeforeMutationEffects,
  commitLayoutEffects,
  commitMutationEffects,
  commitPassiveMountEffects,
  commitPassiveUnmountEffects,
  disappearLayoutEffectsForDEVValidation,
  disconnectPassiveEffect,
  invokeLayoutEffectMountInDEV,
  invokeLayoutEffectUnmountInDEV,
  invokePassiveEffectMountInDEV,
  invokePassiveEffectUnmountInDEV,
  reappearLayoutEffectsForDEVValidation,
  reconnectPassiveEffects,
  shouldFireAfterActiveInstanceBlur,
} from "./ReactFiberCommitWork.ts";
import { resetShouldStartViewTransition, shouldStartViewTransition } from "./ReactFiberCommitViewTransitions.ts";
import { enqueueUpdate } from "./ReactFiberClassUpdateQueue.ts";
import { resetContextDependencies } from "./ReactFiberNewContext.ts";
import { resetHooksAfterThrow, resetHooksOnUnwind } from "./ReactFiberHooks.ts";
import {
  pushContextOnlyDispatcher,
  restoreDispatcher,
  type SavedDispatcher,
} from "react-reconciler/ReactFiberHooksDispatcher.ts";
import { DefaultAsyncDispatcher } from "./ReactFiberAsyncDispatcher.ts";
import { type CapturedValue, createCapturedValueAtFiber } from "react-reconciler/ReactCapturedValue.ts";
import {
  enqueueConcurrentRenderForLane,
  finishQueueingConcurrentUpdates,
  getConcurrentlyUpdatedLanes,
} from "./ReactFiberConcurrentUpdates.ts";
import {
  animatingLanes,
  animatingTask,
  blockingClampTime,
  blockingEventRepeatTime,
  blockingEventTime,
  blockingEventType,
  blockingSuspendedTime,
  blockingUpdateComponentName,
  blockingUpdateMethodName,
  blockingUpdateTask,
  blockingUpdateTime,
  blockingUpdateType,
  clampBlockingTimers,
  clampIdleTimers,
  clampRetryTimers,
  clampTransitionTimers,
  clearBlockingTimers,
  clearTransitionTimers,
  commitEndTime,
  commitErrors,
  commitStartTime,
  idleClampTime,
  markNestedUpdateScheduled,
  PINGED_UPDATE,
  recordCommitEndTime,
  recordCommitTime,
  recordEffectError,
  recordRenderTime,
  renderStartTime,
  resetCommitErrors,
  retryClampTime,
  SPAWNED_UPDATE,
  startAnimating,
  startPingTimerByLanes,
  startProfilerTimer,
  startYieldTimer,
  stopAnimating,
  stopProfilerTimerIfRunningAndRecordDuration,
  stopProfilerTimerIfRunningAndRecordIncompleteDuration,
  trackSuspendedTime,
  transitionClampTime,
  transitionEventRepeatTime,
  transitionEventTime,
  transitionEventType,
  transitionStartTime,
  transitionSuspendedTime,
  transitionUpdateComponentName,
  transitionUpdateMethodName,
  transitionUpdateTask,
  transitionUpdateTime,
  transitionUpdateType,
  yieldReason,
  yieldStartTime,
} from "./ReactProfilerTimer.ts";
// DEV stuff
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";
import { ReactStrictModeWarnings } from "./ReactStrictModeWarnings.ts";
import {
  isRendering as ReactCurrentDebugFiberIsRenderingInDEV,
  resetCurrentFiber,
  runWithFiberInDEV,
} from "./ReactCurrentFiber.ts";
import {
  isDevToolsPresent,
  markCommitStarted,
  markCommitStopped,
  markComponentErrored,
  markComponentRenderStopped,
  markComponentSuspended,
  markLayoutEffectsStarted,
  markLayoutEffectsStopped,
  markPassiveEffectsStarted,
  markPassiveEffectsStopped,
  markRenderStarted,
  markRenderStopped,
  markRenderYielded,
  onCommitRoot as onCommitRootDevTools,
  onPostCommitRoot as onPostCommitRootDevTools,
  setIsStrictModeForDevtools,
} from "./ReactFiberDevToolsHook.ts";
import { onCommitRoot as onCommitRootTestSelector } from "./ReactTestSelectors.ts";
import { releaseCache } from "./ReactFiberCacheComponent.ts";
import { isConcurrentActEnvironment, isLegacyActEnvironment } from "./ReactFiberAct.ts";
import { processTransitionCallbacks } from "./ReactFiberTracingMarkerComponent.ts";
import {
  clearUseWarnings,
  getSuspendedThenable,
  hasPotentialUseWarnings,
  isThenableResolved,
  SuspenseActionException,
  SuspenseException,
  SuspenseyCommitException,
} from "./ReactFiberThenable.ts";
import { schedulePostPaintCallback } from "./ReactPostPaintCallback.ts";
import { getShellBoundary, getSuspenseHandler } from "./ReactFiberSuspenseContext.ts";
import { resetChildReconcilerOnUnwind } from "./ReactChildFiber.ts";
import {
  ensureRootIsScheduled,
  flushSyncWorkOnAllRoots,
  flushSyncWorkOnLegacyRootsOnly,
  requestTransitionLane,
} from "./ReactFiberRootScheduler.ts";
import { getMaskedContext, getUnmaskedContext } from "./ReactFiberLegacyContext.ts";
import { logUncaughtError } from "./ReactFiberErrorLogger.ts";
import { claimQueuedTransitionTypes } from "./ReactFiberTransitionTypes.ts";


type ExecutionContext = number;

export const NoContext = 0b000;
const BatchedContext = 0b001;
export const RenderContext = 0b010;
export const CommitContext = 0b100;

type RootExitStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const RootInProgress = 0;
const RootFatalErrored = 1;
const RootErrored = 2;
const RootSuspended = 3;
const RootSuspendedWithDelay = 4;
const RootSuspendedAtTheShell = 6;
const RootCompleted = 5;

// Describes where we are in the React execution stack
let executionContext: ExecutionContext = NoContext;
// The root we're working on
let workInProgressRoot: FiberRoot | null = null;
// The fiber we're working on
let workInProgress: Fiber | null = null;
// The lanes we're rendering
let workInProgressRootRenderLanes: Lanes = NoLanes;

export type SuspendedReason = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
const NotSuspended: SuspendedReason = 0;
const SuspendedOnError: SuspendedReason = 1;
const SuspendedOnData: SuspendedReason = 2;
const SuspendedOnImmediate: SuspendedReason = 3;
const SuspendedOnInstance: SuspendedReason = 4;
const SuspendedOnInstanceAndReadyToContinue: SuspendedReason = 5;
const SuspendedOnDeprecatedThrowPromise: SuspendedReason = 6;
const SuspendedAndReadyToContinue: SuspendedReason = 7;
const SuspendedOnHydration: SuspendedReason = 8;
const SuspendedOnAction: SuspendedReason = 9;

// When this is true, the work-in-progress fiber just suspended (or errored) and
// we've yet to unwind the stack. In some cases, we may yield to the main thread
// after this happens. If the fiber is pinged before we resume, we can retry
// immediately instead of unwinding the stack.
let workInProgressSuspendedReason: SuspendedReason = NotSuspended;
let workInProgressThrownValue: unknown = null;

// Tracks whether any siblings were skipped during the unwind phase after
// something suspends. Used to determine whether to schedule another render
// to prewarm the skipped siblings.
let workInProgressRootDidSkipSuspendedSiblings = false;
// Whether the work-in-progress render is the result of a prewarm/prerender.
// This tells us whether or not we should render the siblings after
// something suspends.
let workInProgressRootIsPrerendering = false;

// Whether a ping listener was attached during this render. This is slightly
// different that whether something suspended, because we don't add multiple
// listeners to a promise we've already seen (per root and lane).
let workInProgressRootDidAttachPingListener = false;

// A contextual version of workInProgressRootRenderLanes. It is a superset of
// the lanes that we started working on at the root. When we enter a subtree
// that is currently hidden, we add the lanes that would have committed if
// the hidden tree hadn't been deferred. This is modified by the
// HiddenContext module.
//
// Most things in the work loop should deal with workInProgressRootRenderLanes.
// Most things in begin/complete phases should deal with entangledRenderLanes.
export let entangledRenderLanes: Lanes = NoLanes;

// Whether to root completed, errored, suspended, etc.
let workInProgressRootExitStatus: RootExitStatus = RootInProgress;
// The work left over by components that were visited during this render. Only
// includes unprocessed updates, not work in bailed out children.
let workInProgressRootSkippedLanes: Lanes = NoLanes;
// Lanes that were updated (in an interleaved event) during this render.
let workInProgressRootInterleavedUpdatedLanes: Lanes = NoLanes;
// Lanes that were updated during the render phase (*not* an interleaved event).
let workInProgressRootRenderPhaseUpdatedLanes: Lanes = NoLanes;
// Lanes that were pinged (in an interleaved event) during this render.
let workInProgressRootPingedLanes: Lanes = NoLanes;
// If this render scheduled deferred work, this is the lane of the deferred task.
let workInProgressDeferredLane: Lane = NoLane;
// Represents the retry lanes that were spawned by this render and have not
// been pinged since, implying that they are still suspended.
let workInProgressSuspendedRetryLanes: Lanes = NoLanes;
// Errors that are thrown during the render phase.
let workInProgressRootConcurrentErrors: CapturedValue[] | null = null;
// These are errors that we recovered from without surfacing them to the UI.
// We will log them once the tree commits.
let workInProgressRootRecoverableErrors: CapturedValue[] | null = null;

// Tracks when an update occurs during the render phase.
let workInProgressRootDidIncludeRecursiveRenderUpdate = false;
// Thacks when an update occurs during the commit phase. It's a separate
// variable from the one for renders because the commit phase may run
// concurrently to a render phase.
let didIncludeCommitPhaseUpdate = false;
// The most recent time we either committed a fallback, or when a fallback was
// filled in with the resolved UI. This lets us throttle the appearance of new
// content as it streams in, to minimize jank.
// TODO: Think of a better name for this variable?
let globalMostRecentFallbackTime = 0;
// Track the most recent time we started a new Transition. This lets us apply
// heuristics like the suspensey image timeout based on how long we've waited
// already.
let globalMostRecentTransitionTime = 0;

const FALLBACK_THROTTLE_MS = 300;

// The absolute time for when we should start giving up on rendering
// more and prefer CPU suspense heuristics instead.
let workInProgressRootRenderTargetTime = Infinity;
// How long a render is supposed to take before we start following CPU
// suspense heuristics and opt out of rendering more content.
const RENDER_TIMEOUT_MS = 500;

let workInProgressTransitions: Transition[] | null = null;
export function getWorkInProgressTransitions(): Transition[] | null {
  return workInProgressTransitions;
}

// The first setState call that eventually caused the current render.
let workInProgressUpdateTask: unknown = null;

let currentPendingTransitionCallbacks: PendingTransitionCallbacks | null = null;
let currentEndTime: number | null = null;

function emptyPendingTransitionCallbacks(): PendingTransitionCallbacks {
  return {
    transitionStart: null,
    transitionProgress: null,
    transitionComplete: null,
    markerProgress: null,
    markerIncomplete: null,
    markerComplete: null,
  };
}

export function addTransitionStartCallbackToPendingTransition(transition: Transition): void {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = emptyPendingTransitionCallbacks();
    }
    if (currentPendingTransitionCallbacks.transitionStart === null) {
      currentPendingTransitionCallbacks.transitionStart = [];
    }
    currentPendingTransitionCallbacks.transitionStart.push(transition);
  }
}

export function addMarkerProgressCallbackToPendingTransition(
  markerName: string,
  transitions: Set<Transition>,
  pendingBoundaries: PendingBoundaries,
): void {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = emptyPendingTransitionCallbacks();
    }
    if (currentPendingTransitionCallbacks.markerProgress === null) {
      currentPendingTransitionCallbacks.markerProgress = new Map<string, { pendingBoundaries: PendingBoundaries; transitions: Set<Transition> }>();
    }
    currentPendingTransitionCallbacks.markerProgress.set(markerName, {
      pendingBoundaries,
      transitions,
    });
  }
}

export function addMarkerIncompleteCallbackToPendingTransition(
  markerName: string,
  transitions: Set<Transition>,
  aborts: TransitionAbort[],
): void {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = emptyPendingTransitionCallbacks();
    }
    if (currentPendingTransitionCallbacks.markerIncomplete === null) {
      currentPendingTransitionCallbacks.markerIncomplete = new Map<string, { aborts: TransitionAbort[]; transitions: Set<Transition> }>();
    }
    currentPendingTransitionCallbacks.markerIncomplete.set(markerName, {
      transitions,
      aborts,
    });
  }
}

export function addMarkerCompleteCallbackToPendingTransition(markerName: string, transitions: Set<Transition>): void {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = emptyPendingTransitionCallbacks();
    }
    if (currentPendingTransitionCallbacks.markerComplete === null) {
      currentPendingTransitionCallbacks.markerComplete = new Map<string, Set<Transition>>();
    }
    currentPendingTransitionCallbacks.markerComplete.set(markerName, transitions);
  }
}

export function addTransitionProgressCallbackToPendingTransition(
  transition: Transition,
  boundaries: PendingBoundaries,
): void {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = emptyPendingTransitionCallbacks();
    }
    if (currentPendingTransitionCallbacks.transitionProgress === null) {
      currentPendingTransitionCallbacks.transitionProgress = new Map<Transition, PendingBoundaries>();
    }
    currentPendingTransitionCallbacks.transitionProgress.set(transition, boundaries);
  }
}

export function addTransitionCompleteCallbackToPendingTransition(transition: Transition): void {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = emptyPendingTransitionCallbacks();
    }
    if (currentPendingTransitionCallbacks.transitionComplete === null) {
      currentPendingTransitionCallbacks.transitionComplete = [];
    }
    currentPendingTransitionCallbacks.transitionComplete.push(transition);
  }
}

function resetRenderTimer(): void {
  workInProgressRootRenderTargetTime = now() + RENDER_TIMEOUT_MS;
}

export function getRenderTargetTime(): number {
  return workInProgressRootRenderTargetTime;
}

let legacyErrorBoundariesThatAlreadyFailed: Set<unknown> | null = null;

type SuspendedCommitReason = string | null;

type DelayedCommitReason = 0 | 1 | 2 | 3;
const IMMEDIATE_COMMIT = 0;
const ABORTED_VIEW_TRANSITION_COMMIT = 1;
const DELAYED_PASSIVE_COMMIT = 2;
const ANIMATION_STARTED_COMMIT = 3;

const NO_PENDING_EFFECTS = 0;
const PENDING_MUTATION_PHASE = 1;
const PENDING_LAYOUT_PHASE = 2;
const PENDING_AFTER_MUTATION_PHASE = 3;
const PENDING_SPAWNED_WORK = 4;
const PENDING_PASSIVE_PHASE = 5;
// 6 and 7 are the gesture mutation and animation phases; enableGestureTransition
// is off in the stable channel, so they are never entered.
let pendingEffectsStatus: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0;
// Only read while pendingEffectsStatus is not NO_PENDING_EFFECTS.
let pendingEffectsRoot: FiberRoot = null!;
let pendingFinishedWork: Fiber = null!;
let pendingEffectsLanes: Lanes = NoLanes;
let pendingEffectsRemainingLanes: Lanes = NoLanes;
let pendingEffectsRenderEndTime = -0; // Profiling-only
let pendingPassiveTransitions: Transition[] | null = null;
let pendingRecoverableErrors: CapturedValue[] | null = null;
let pendingViewTransition: RunningViewTransition | null = null;
let pendingViewTransitionEvents: ((types: string[]) => void | (() => void))[] | null = null;
let pendingTransitionTypes: TransitionTypes | null = null;
let pendingDidIncludeRenderPhaseUpdate = false;
let pendingSuspendedCommitReason: SuspendedCommitReason = null; // Profiling-only
let pendingDelayedCommitReason: DelayedCommitReason = IMMEDIATE_COMMIT; // Profiling-only
let pendingSuspendedViewTransitionReason: string | null = null; // Profiling-only

// Use these to prevent an infinite loop of nested updates
const NESTED_UPDATE_LIMIT = 50;
let nestedUpdateCount = 0;
let rootWithNestedUpdates: FiberRoot | null = null;
let isFlushingPassiveEffects = false;
let didScheduleUpdateDuringPassiveEffects = false;

const NO_NESTED_UPDATE = 0;
const NESTED_UPDATE_SYNC_LANE = 1;
const NESTED_UPDATE_PHASE_SPAWN = 2;
let nestedUpdateKind: 0 | 1 | 2 = NO_NESTED_UPDATE;

const NESTED_PASSIVE_UPDATE_LIMIT = 50;
let nestedPassiveUpdateCount = 0;
let rootWithPassiveNestedUpdates: FiberRoot | null = null;

let isRunningInsertionEffect = false;

export function getWorkInProgressRoot(): FiberRoot | null {
  return workInProgressRoot;
}

export function getCommittingRoot(): FiberRoot | null {
  return pendingEffectsRoot;
}

export function getWorkInProgressRootRenderLanes(): Lanes {
  return workInProgressRootRenderLanes;
}

export function hasPendingCommitEffects(): boolean {
  return pendingEffectsStatus !== NO_PENDING_EFFECTS && pendingEffectsStatus !== PENDING_PASSIVE_PHASE;
}

export function getRootWithPendingPassiveEffects(): FiberRoot | null {
  return pendingEffectsStatus === PENDING_PASSIVE_PHASE ? pendingEffectsRoot : null;
}

export function getPendingPassiveEffectsLanes(): Lanes {
  return pendingEffectsLanes;
}

export function getPendingTransitionTypes(): TransitionTypes | null {
  return pendingTransitionTypes;
}

export function isWorkLoopSuspendedOnData(): boolean {
  return workInProgressSuspendedReason === SuspendedOnData || workInProgressSuspendedReason === SuspendedOnAction;
}

export function getCurrentTime(): number {
  return now();
}

export function requestUpdateLane(fiber: Fiber): Lane {
  // Special cases
  const mode = fiber.mode;
  if (!disableLegacyMode && (mode & ConcurrentMode) === NoMode) {
    return SyncLane;
  } else if ((executionContext & RenderContext) !== NoContext && workInProgressRootRenderLanes !== NoLanes) {
    // This is a render phase update. These are not officially supported. The
    // old behavior is to give this the same "thread" (lanes) as
    // whatever is currently rendering. So if you call `setState` on a component
    // that happens later in the same render, it will flush. Ideally, we want to
    // remove the special case and treat them as if they came from an
    // interleaved event. Regardless, this pattern is not officially supported.
    // This behavior is only a fallback. The flag only exists until we can roll
    // out the setState warning, since existing code might accidentally rely on
    // the current behavior.
    return pickArbitraryLane(workInProgressRootRenderLanes);
  }

  const transition = requestCurrentTransition();
  if (transition !== null) {
    if (enableGestureTransition) {
      if (transition.gesture) {
        throw new Error(
          "Cannot setState on regular state inside a startGestureTransition. " +
            "Gestures can only update the useOptimistic() hook. There should be no " +
            "side-effects associated with starting a Gesture until its Action is " +
            "invoked. Move side-effects to the Action instead.",
        );
      }
    }
    if (isDevelopment) {
      if (!transition._updatedFibers) {
        transition._updatedFibers = new Set<unknown>();
      }
      transition._updatedFibers.add(fiber);
      if (hasPotentialUseWarnings() && resolveUpdatePriority() === DiscreteEventPriority) {
        // If we're updating inside a discrete event, then this might be a new user interaction
        // and not just an automatically resolved loading sequence. Don't warn unless it happens again.
        clearUseWarnings();
      }
    }

    return requestTransitionLane(transition);
  }

  const priority = resolveUpdatePriority();
  if (isDevelopment && priority === DiscreteEventPriority) {
    clearUseWarnings();
  }
  return eventPriorityToLane(priority);
}

function requestRetryLane(fiber: Fiber): Lane {
  // This is a fork of `requestUpdateLane` designed specifically for Suspense
  // "retries" — a special update that attempts to flip a Suspense boundary
  // from its placeholder state to its primary/resolved state.

  // Special cases
  const mode = fiber.mode;
  if (!disableLegacyMode && (mode & ConcurrentMode) === NoMode) {
    return SyncLane;
  }

  return claimNextRetryLane();
}

export function requestDeferredLane(): Lane {
  if (workInProgressDeferredLane === NoLane) {
    // If there are multiple useDeferredValue hooks in the same render, the
    // tasks that they spawn should all be batched together, so they should all
    // receive the same lane.

    // Check the priority of the current render to decide the priority of the
    // deferred task.

    // OffscreenLane is used for prerendering, but we also use OffscreenLane
    // for incremental hydration. It's given the lowest priority because the
    // initial HTML is the same as the final UI. But useDeferredValue during
    // hydration is an exception — we need to upgrade the UI to the final
    // value. So if we're currently hydrating, we treat it like a transition.
    const isPrerendering = includesSomeLane(workInProgressRootRenderLanes, OffscreenLane) && !getIsHydrating();
    if (isPrerendering) {
      // There's only one OffscreenLane, so if it contains deferred work, we
      // should just reschedule using the same lane.
      workInProgressDeferredLane = OffscreenLane;
    } else {
      // Everything else is spawned as a transition.
      workInProgressDeferredLane = claimNextTransitionDeferredLane();
    }
  }

  // Mark the parent Suspense boundary so it knows to spawn the deferred lane.
  const suspenseHandler = getSuspenseHandler();
  if (suspenseHandler !== null) {
    // TODO: As an optimization, we shouldn't entangle the lanes at the root; we
    // can entangle them using the baseLanes of the Suspense boundary instead.
    // We only need to do something special if there's no Suspense boundary.
    suspenseHandler.flags |= DidDefer;
  }

  return workInProgressDeferredLane;
}

export function scheduleViewTransitionEvent(
  fiber: Fiber,
  callback: ((instance: ViewTransitionInstance, types: string[]) => void | (() => void)) | null | undefined,
): void {
  if (enableViewTransition) {
    if (callback != null) {
      const state = fiber.stateNode as ViewTransitionState;
      let instance = state.ref;
      if (instance === null) {
        instance = state.ref = createViewTransitionInstance(
          getViewTransitionName(fiber.memoizedProps as Props, state),
        );
      }
      if (pendingViewTransitionEvents === null) {
        pendingViewTransitionEvents = [];
      }
      const boundInstance = instance;
      pendingViewTransitionEvents.push((types) => callback(boundInstance, types));
    }
  }
}

// enableGestureTransition is off in the stable channel: no gesture is ever
// applied, so there is no gesture event to schedule.
export function scheduleGestureTransitionEvent(_fiber: Fiber, _callback: unknown): void {}

export function peekDeferredLane(): Lane {
  return workInProgressDeferredLane;
}

export function scheduleUpdateOnFiber(root: FiberRoot, fiber: Fiber, lane: Lane): void {
  if (isDevelopment) {
    if (isRunningInsertionEffect) {
      console.error("useInsertionEffect must not schedule updates.");
    }
  }

  if (isDevelopment) {
    if (isFlushingPassiveEffects) {
      didScheduleUpdateDuringPassiveEffects = true;
    }
  }

  // Check if the work loop is currently suspended and waiting for data to
  // finish loading.
  if (
    // Suspended render phase
    (root === workInProgressRoot &&
      (workInProgressSuspendedReason === SuspendedOnData || workInProgressSuspendedReason === SuspendedOnAction)) ||
    // Suspended commit phase
    root.cancelPendingCommit !== null
  ) {
    // The incoming update might unblock the current render. Interrupt the
    // current attempt and restart from the top.
    prepareFreshStack(root, NoLanes);
    const didAttemptEntireTree = false;
    markRootSuspended(root, workInProgressRootRenderLanes, workInProgressDeferredLane, didAttemptEntireTree);
  }

  // Mark that the root has a pending update.
  markRootUpdated(root, lane);

  if ((executionContext & RenderContext) !== NoContext && root === workInProgressRoot) {
    // This update was dispatched during the render phase. This is a mistake
    // if the update originates from user space (with the exception of local
    // hook updates, which are handled differently and don't reach this
    // function), but there are some internal React features that use this as
    // an implementation detail, like selective hydration.
    warnAboutRenderPhaseUpdatesInDEV(fiber);

    // Track lanes that were updated during the render phase
    workInProgressRootRenderPhaseUpdatedLanes = mergeLanes(workInProgressRootRenderPhaseUpdatedLanes, lane);
  } else {
    // This is a normal update, scheduled from outside the render phase. For
    // example, during an input event.
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        addFiberToLanesMap(root, fiber, lane);
      }
    }

    warnIfUpdatesNotWrappedWithActDEV(fiber);

    if (enableTransitionTracing) {
      const transition = ReactSharedInternals.T;
      if (transition !== null && transition.name != null) {
        if (transition.startTime === -1) {
          transition.startTime = now();
        }

        addTransitionToLanesMap(root, transition, lane);
      }
    }

    if (root === workInProgressRoot) {
      // Received an update to a tree that's in the middle of rendering. Mark
      // that there was an interleaved update work on this root.
      if ((executionContext & RenderContext) === NoContext) {
        workInProgressRootInterleavedUpdatedLanes = mergeLanes(workInProgressRootInterleavedUpdatedLanes, lane);
      }
      if (workInProgressRootExitStatus === RootSuspendedWithDelay) {
        // The root already suspended with a delay, which means this render
        // definitely won't finish. Since we have a new update, let's mark it as
        // suspended now, right before marking the incoming update. This has the
        // effect of interrupting the current render and switching to the update.
        // TODO: Make sure this doesn't override pings that happen while we've
        // already started rendering.
        const didAttemptEntireTree = false;
        markRootSuspended(root, workInProgressRootRenderLanes, workInProgressDeferredLane, didAttemptEntireTree);
      }
    }

    ensureRootIsScheduled(root);
    if (
      lane === SyncLane &&
      executionContext === NoContext &&
      !disableLegacyMode &&
      (fiber.mode & ConcurrentMode) === NoMode
    ) {
      if (isDevelopment && ReactSharedInternals.isBatchingLegacy) {
        // Treat `act` as if it's inside `batchedUpdates`, even in legacy mode.
      } else {
        // Flush the synchronous work now, unless we're already working or inside
        // a batch. This is intentionally inside scheduleUpdateOnFiber instead of
        // scheduleCallbackForFiber to preserve the ability to schedule a callback
        // without immediately flushing it. We only do this for user-initiated
        // updates, to preserve historical behavior of legacy mode.
        resetRenderTimer();
        flushSyncWorkOnLegacyRootsOnly();
      }
    }
  }
}

export function scheduleInitialHydrationOnRoot(root: FiberRoot, lane: Lane): void {
  // This is a special fork of scheduleUpdateOnFiber that is only used to
  // schedule the initial hydration of a root that has just been created. Most
  // of the stuff in scheduleUpdateOnFiber can be skipped.
  //
  // The main reason for this separate path, though, is to distinguish the
  // initial children from subsequent updates. In fully client-rendered roots
  // (createRoot instead of hydrateRoot), all top-level renders are modeled as
  // updates, but hydration roots are special because the initial render must
  // match what was rendered on the server.
  const current = root.current;
  current.lanes = lane;
  markRootUpdated(root, lane);
  ensureRootIsScheduled(root);
}

export function isUnsafeClassRenderPhaseUpdate(_fiber: Fiber): boolean {
  // Check if this is a render phase update. Only called by class components,
  // which special (deprecated) behavior for UNSAFE_componentWillReceive props.
  return (executionContext & RenderContext) !== NoContext;
}

// Owner stacks are expensive, so only so many elements per second capture
// one (see ReactJSXElement). The work loop resets the count at the start of
// each render, at most once a second. Upstream's shared/ReactOwnerStackReset.
let lastOwnerStackResetTime = 0;
function resetOwnerStackLimit(): void {
  if (isDevelopment) {
    const currentTime = performance.now();
    if (currentTime - lastOwnerStackResetTime > 1000) {
      ReactSharedInternals.recentlyCreatedOwnerStacks = 0;
      lastOwnerStackResetTime = currentTime;
    }
  } else {
    throw new Error("resetOwnerStackLimit should never be called in production mode. This is a bug in React.");
  }
}

export function performWorkOnRoot(root: FiberRoot, lanes: Lanes, forceSync: boolean): void {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.");
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (workInProgressRootRenderLanes !== NoLanes && workInProgress !== null) {
      const yieldedFiber = workInProgress;
      // We've returned from yielding to the event loop. Let's log the time it took.
      const yieldEndTime = now();
      switch (yieldReason) {
        case SuspendedOnImmediate:
        case SuspendedOnData:
          logSuspendedYieldTime(yieldStartTime, yieldEndTime, yieldedFiber);
          break;
        case SuspendedOnAction:
          logActionYieldTime(yieldStartTime, yieldEndTime, yieldedFiber);
          break;
        default:
          logYieldTime(yieldStartTime, yieldEndTime);
      }
    }
  }

  // We disable time-slicing in some cases: if the work has been CPU-bound
  // for too long ("expired" work, to prevent starvation), or we're in
  // sync-updates-by-default mode.
  const shouldTimeSlice =
    (!forceSync && !includesBlockingLane(lanes) && !includesExpiredLane(root, lanes)) ||
    // If we're prerendering, then we should use the concurrent work loop
    // even if the lanes are synchronous, so that prerendering never blocks
    // the main thread.
    // TODO: We should consider doing this whenever a sync lane is suspended,
    // even for regular pings.
    checkIfRootIsPrerendering(root, lanes);

  let exitStatus: RootExitStatus = shouldTimeSlice ? renderRootConcurrent(root, lanes) : renderRootSync(root, lanes, true);

  let renderWasConcurrent = shouldTimeSlice;
  let currentLanes = lanes;

  for (;;) {
    if (exitStatus === RootInProgress) {
      // Render phase is still in progress.
      if (workInProgressRootIsPrerendering && !shouldTimeSlice) {
        // We're in prerendering mode, but time slicing is not enabled. This
        // happens when something suspends during a synchronous update. Exit the
        // the work loop. When we resume, we'll use the concurrent work loop so
        // that prerendering is non-blocking.
        //
        // Mark the root as suspended. Usually we do this at the end of the
        // render phase, but we do it here so that we resume in
        // prerendering mode.
        // TODO: Consider always calling markRootSuspended immediately.
        // Needs to be *after* we attach a ping listener, though.
        const didAttemptEntireTree = false;
        markRootSuspended(root, currentLanes, NoLane, didAttemptEntireTree);
      }
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        // We're about to yield. Let's keep track of how long we yield to the event loop.
        // We also stash the suspended reason at the time we yielded since it might have
        // changed when we resume such as when it gets pinged.
        startYieldTimer(workInProgressSuspendedReason);
      }
      break;
    }

    let renderEndTime = 0;
    if (enableProfilerTimer && enableComponentPerformanceTrack) {
      renderEndTime = now();
    }

    // The render completed.

    // Check if this render may have yielded to a concurrent event, and if so,
    // confirm that any newly rendered stores are consistent.
    // TODO: It's possible that even a concurrent render may never have yielded
    // to the main thread, if it was fast enough, or if it expired. We could
    // skip the consistency check in that case, too.
    const finishedWork = root.current.alternate!;
    if (renderWasConcurrent && !isRenderConsistentWithExternalStores(finishedWork)) {
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        setCurrentTrackFromLanes(currentLanes);
        logInconsistentRender(renderStartTime, renderEndTime, workInProgressUpdateTask);
        finalizeRender(currentLanes, renderEndTime);
      }
      // A store was mutated in an interleaved event. Render again,
      // synchronously, to block further mutations.
      exitStatus = renderRootSync(root, currentLanes, false);
      // We assume the tree is now consistent because we didn't yield to any
      // concurrent events.
      renderWasConcurrent = false;
      // Need to check the exit status again.
      continue;
    }

    // Check if something threw
    if ((disableLegacyMode || root.tag !== LegacyRoot) && exitStatus === RootErrored) {
      const lanesThatJustErrored = currentLanes;
      const errorRetryLanes = getLanesToRetrySynchronouslyOnError(root, lanesThatJustErrored);
      if (errorRetryLanes !== NoLanes) {
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          setCurrentTrackFromLanes(currentLanes);
          logErroredRenderPhase(renderStartTime, renderEndTime, currentLanes, workInProgressUpdateTask);
          finalizeRender(currentLanes, renderEndTime);
        }
        currentLanes = errorRetryLanes;
        exitStatus = recoverFromConcurrentError(root, lanesThatJustErrored, errorRetryLanes);
        renderWasConcurrent = false;
        // Need to check the exit status again.
        if (exitStatus !== RootErrored) {
          // The root did not error this time. Restart the exit algorithm
          // from the beginning.
          // TODO: Refactor the exit algorithm to be less confusing. Maybe
          // more branches + recursion instead of a loop. I think the only
          // thing that causes it to be a loop is the RootSuspendedAtTheShell
          // check. If that's true, then we don't need a loop/recursion
          // at all.
          continue;
        }
        // The root errored yet again. Proceed to commit the tree.
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          renderEndTime = now();
        }
      }
    }
    if (exitStatus === RootFatalErrored) {
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        setCurrentTrackFromLanes(currentLanes);
        logErroredRenderPhase(renderStartTime, renderEndTime, currentLanes, workInProgressUpdateTask);
        finalizeRender(currentLanes, renderEndTime);
      }
      prepareFreshStack(root, NoLanes);
      // Since this is a fatal error, we're going to pretend we attempted
      // the entire tree, to avoid scheduling a prerender.
      const didAttemptEntireTree = true;
      markRootSuspended(root, currentLanes, NoLane, didAttemptEntireTree);
      break;
    }

    // We now have a consistent tree. The next step is either to commit it,
    // or, if something suspended, wait to commit it after a timeout.
    finishConcurrentRender(root, exitStatus, finishedWork, currentLanes, renderEndTime);
    break;
  }

  ensureRootIsScheduled(root);
}

function recoverFromConcurrentError(
  root: FiberRoot,
  originallyAttemptedLanes: Lanes,
  errorRetryLanes: Lanes,
): RootExitStatus {
  // If an error occurred during hydration, discard server response and fall
  // back to client side render.

  // Before rendering again, save the errors from the previous attempt.
  const errorsFromFirstAttempt = workInProgressRootConcurrentErrors;

  const wasRootDehydrated = supportsHydration && isRootDehydrated(root);
  if (wasRootDehydrated) {
    // The shell failed to hydrate. Set a flag to force a client rendering
    // during the next attempt. To do this, we call prepareFreshStack now
    // to create the root work-in-progress fiber. This is a bit weird in terms
    // of factoring, because it relies on renderRootSync not calling
    // prepareFreshStack again in the call below, which happens because the
    // root and lanes haven't changed.
    //
    // TODO: I think what we should do is set ForceClientRender inside
    // throwException, like we do for nested Suspense boundaries. The reason
    // it's here instead is so we can switch to the synchronous work loop, too.
    // Something to consider for a future refactor.
    const rootWorkInProgress = prepareFreshStack(root, errorRetryLanes);
    rootWorkInProgress.flags |= ForceClientRender;
  }

  const exitStatus = renderRootSync(root, errorRetryLanes, false);
  // A status of RootSuspendedAtTheShell means the retry unwound to the root
  // without completing (e.g. something suspended in the shell), so the tree is
  // incomplete and must not be treated as recovered — committing it would
  // corrupt the current tree. Fall through and return the status as-is so the
  // root stays suspended.
  if (exitStatus !== RootErrored && exitStatus !== RootSuspendedAtTheShell) {
    // Successfully finished rendering on retry

    if (workInProgressRootDidAttachPingListener && !wasRootDehydrated) {
      // During the synchronous render, we attached additional ping listeners.
      // This is highly suggestive of an uncached promise (though it's not the
      // only reason this would happen). If it was an uncached promise, then
      // it may have masked a downstream error from ocurring without actually
      // fixing it. Example:
      //
      //    use(Promise.resolve('uncached'))
      //    throw new Error('Oops!')
      //
      // When this happens, there's a conflict between blocking potential
      // concurrent data races and unwrapping uncached promise values. We
      // have to choose one or the other. Because the data race recovery is
      // a last ditch effort, we'll disable it.
      root.errorRecoveryDisabledLanes = mergeLanes(root.errorRecoveryDisabledLanes, originallyAttemptedLanes);

      // Mark the current render as suspended and force it to restart. Once
      // these lanes finish successfully, we'll re-enable the error recovery
      // mechanism for subsequent updates.
      workInProgressRootInterleavedUpdatedLanes |= originallyAttemptedLanes;
      return RootSuspendedWithDelay;
    }

    // The errors from the failed first attempt have been recovered. Add
    // them to the collection of recoverable errors. We'll log them in the
    // commit phase.
    const errorsFromSecondAttempt = workInProgressRootRecoverableErrors;
    workInProgressRootRecoverableErrors = errorsFromFirstAttempt;
    // The errors from the second attempt should be queued after the errors
    // from the first attempt, to preserve the causal sequence.
    if (errorsFromSecondAttempt !== null) {
      queueRecoverableErrors(errorsFromSecondAttempt);
    }
  } else {
    // The UI failed to recover.
  }
  return exitStatus;
}

export function queueRecoverableErrors(errors: CapturedValue[]): void {
  if (workInProgressRootRecoverableErrors === null) {
    workInProgressRootRecoverableErrors = errors;
  } else {
    workInProgressRootRecoverableErrors.push(...errors);
  }
}

function finishConcurrentRender(
  root: FiberRoot,
  exitStatus: RootExitStatus,
  finishedWork: Fiber,
  lanes: Lanes,
  renderEndTime: number, // Profiling-only
): void {
  // TODO: The fact that most of these branches are identical suggests that some
  // of the exit statuses are not best modeled as exit statuses and should be
  // tracked orthogonally.
  switch (exitStatus) {
    case RootInProgress:
    case RootFatalErrored: {
      throw new Error("Root did not complete. This is a bug in React.");
    }
    case RootSuspendedWithDelay: {
      if (!includesOnlyTransitions(lanes) && !includesOnlyRetries(lanes)) {
        // Commit the placeholder.
        break;
      }
      // Upstream falls through to RootSuspendedAtTheShell here.
      suspendWithoutCommitting(root, lanes, renderEndTime);
      return;
    }
    case RootSuspendedAtTheShell: {
      suspendWithoutCommitting(root, lanes, renderEndTime);
      return;
    }
    case RootErrored: {
      // This render errored. Ignore any recoverable errors because we weren't actually
      // able to recover. Instead, whatever the final errors were is the ones we log.
      // This ensures that we only log the actual client side error if it's just a plain
      // error thrown from a component on the server and the client.
      workInProgressRootRecoverableErrors = null;
      break;
    }
    case RootSuspended:
    case RootCompleted: {
      break;
    }
    default: {
      throw new Error("Unknown root exit status.");
    }
  }

  if (shouldForceFlushFallbacksInDEV()) {
    // We're inside an `act` scope. Commit immediately.
    completeRoot(
      root,
      finishedWork,
      lanes,
      workInProgressRootRecoverableErrors,
      workInProgressTransitions,
      workInProgressRootDidIncludeRecursiveRenderUpdate,
      workInProgressDeferredLane,
      workInProgressRootInterleavedUpdatedLanes,
      workInProgressSuspendedRetryLanes,
      workInProgressRootDidSkipSuspendedSiblings,
      exitStatus,
      null,
      null,
      renderStartTime,
      renderEndTime,
    );
  } else {
    if (includesOnlyRetries(lanes) && (alwaysThrottleRetries || exitStatus === RootSuspended)) {
      // This render only included retries, no updates. Throttle committing
      // retries so that we don't show too many loading states too quickly.
      const msUntilTimeout = globalMostRecentFallbackTime + FALLBACK_THROTTLE_MS - now();

      // Don't bother with a very short suspense time.
      if (msUntilTimeout > 10) {
        const didAttemptEntireTree = !workInProgressRootDidSkipSuspendedSiblings;
        markRootSuspended(root, lanes, workInProgressDeferredLane, didAttemptEntireTree);

        const nextLanes = getNextLanes(root, NoLanes, true);
        if (nextLanes !== NoLanes) {
          // There's additional work we can do on this root. We might as well
          // attempt to work on that while we're suspended.
          return;
        }

        // The render is suspended, it hasn't timed out, and there's no
        // lower priority work to do. Instead of committing the fallback
        // immediately, wait for more data to arrive.
        // TODO: Combine retry throttling with Suspensey commits. Right now they
        // run one after the other.
        pendingEffectsLanes = lanes;
        const recoverableErrors = workInProgressRootRecoverableErrors;
        const transitions = workInProgressTransitions;
        const didIncludeRenderPhaseUpdate = workInProgressRootDidIncludeRecursiveRenderUpdate;
        const spawnedLane = workInProgressDeferredLane;
        const updatedLanes = workInProgressRootInterleavedUpdatedLanes;
        const suspendedRetryLanes = workInProgressSuspendedRetryLanes;
        const didSkipSuspendedSiblings = workInProgressRootDidSkipSuspendedSiblings;
        const completedRenderStartTime = renderStartTime;
        root.timeoutHandle = scheduleTimeout(
          () =>
            completeRootWhenReady(
              root,
              finishedWork,
              recoverableErrors,
              transitions,
              didIncludeRenderPhaseUpdate,
              lanes,
              spawnedLane,
              updatedLanes,
              suspendedRetryLanes,
              didSkipSuspendedSiblings,
              exitStatus,
              "Throttled",
              completedRenderStartTime,
              renderEndTime,
            ),
          msUntilTimeout,
        );
        return;
      }
    }
    completeRootWhenReady(
      root,
      finishedWork,
      workInProgressRootRecoverableErrors,
      workInProgressTransitions,
      workInProgressRootDidIncludeRecursiveRenderUpdate,
      lanes,
      workInProgressDeferredLane,
      workInProgressRootInterleavedUpdatedLanes,
      workInProgressSuspendedRetryLanes,
      workInProgressRootDidSkipSuspendedSiblings,
      exitStatus,
      null,
      renderStartTime,
      renderEndTime,
    );
  }
}

// A transition (or retry) suspended: exit without committing a placeholder
// and without scheduling a timeout. Delay indefinitely until we receive more
// data.
function suspendWithoutCommitting(root: FiberRoot, lanes: Lanes, renderEndTime: number): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    setCurrentTrackFromLanes(lanes);
    logSuspendedRenderPhase(renderStartTime, renderEndTime, lanes, workInProgressUpdateTask);
    finalizeRender(lanes, renderEndTime);
    trackSuspendedTime(lanes, renderEndTime);
  }
  const didAttemptEntireTree = !workInProgressRootDidSkipSuspendedSiblings;
  markRootSuspended(root, lanes, workInProgressDeferredLane, didAttemptEntireTree);
}

function completeRootWhenReady(
  root: FiberRoot,
  finishedWork: Fiber,
  recoverableErrors: CapturedValue[] | null,
  transitions: Transition[] | null,
  didIncludeRenderPhaseUpdate: boolean,
  lanes: Lanes,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
  didSkipSuspendedSiblings: boolean,
  exitStatus: RootExitStatus,
  suspendedCommitReason: SuspendedCommitReason, // Profiling-only
  completedRenderStartTime: number, // Profiling-only
  completedRenderEndTime: number, // Profiling-only
): void {
  root.timeoutHandle = noTimeout;

  // TODO: Combine retry throttling with Suspensey commits. Right now they run
  // one after the other.
  const BothVisibilityAndMaySuspendCommit = Visibility | MaySuspendCommit;
  const subtreeFlags = finishedWork.subtreeFlags;
  const isViewTransitionEligible = enableViewTransition && includesOnlyViewTransitionEligibleLanes(lanes); // TODO: Use a subtreeFlag to optimize.
  // enableGestureTransition is off in the stable channel.
  const isGestureTransition = false;
  const maySuspendCommit =
    subtreeFlags & ShouldSuspendCommit ||
    (subtreeFlags & BothVisibilityAndMaySuspendCommit) === BothVisibilityAndMaySuspendCommit;
  let suspendedState: SuspendedState | null = null;
  if (isViewTransitionEligible || maySuspendCommit || isGestureTransition) {
    // Before committing, ask the renderer whether the host tree is ready.
    // If it's not, we'll wait until it notifies us.
    suspendedState = startSuspendingCommit();
    // This will walk the completed fiber tree and attach listeners to all
    // the suspensey resources. The renderer is responsible for accumulating
    // all the load events. This all happens in a single synchronous
    // transaction, so it track state in its own module scope.
    // This will also track any newly added or appearing ViewTransition
    // components for the purposes of forming pairs.
    accumulateSuspenseyCommit(finishedWork, lanes, suspendedState);
    if (isViewTransitionEligible) {
      // Wait for any pending View Transition (including gestures) to finish.
      suspendOnActiveViewTransition(suspendedState, root.containerInfo);
    }
    // For timeouts we use the previous fallback commit for retries and
    // the start time of the transition for transitions. This offset
    // represents the time already passed.
    const timeoutOffset = includesOnlyRetries(lanes)
      ? globalMostRecentFallbackTime - now()
      : includesOnlyTransitions(lanes)
        ? globalMostRecentTransitionTime - now()
        : 0;
    // At the end, ask the renderer if it's ready to commit, or if we should
    // suspend. If it's not ready, it will return a callback to subscribe to
    // a ready event.
    const schedulePendingCommit = waitForCommitToBeReady(suspendedState, timeoutOffset);
    if (schedulePendingCommit !== null) {
      // NOTE: waitForCommitToBeReady returns a subscribe function so that we
      // only allocate a function if the commit isn't ready yet. The other
      // pattern would be to always pass a callback to waitForCommitToBeReady.

      // Not yet ready to commit. Delay the commit until the renderer notifies
      // us that it's ready. This will be canceled if we start work on the
      // root again.
      pendingEffectsLanes = lanes;
      const readyState = suspendedState;
      const readyReason = enableProfilerTimer ? getSuspendedCommitReason(suspendedState, root.containerInfo) : null;
      root.cancelPendingCommit = schedulePendingCommit(() =>
        completeRoot(
          root,
          finishedWork,
          lanes,
          recoverableErrors,
          transitions,
          didIncludeRenderPhaseUpdate,
          spawnedLane,
          updatedLanes,
          suspendedRetryLanes,
          didSkipSuspendedSiblings,
          exitStatus,
          readyState,
          readyReason,
          completedRenderStartTime,
          completedRenderEndTime,
        ),
      );
      const didAttemptEntireTree = !didSkipSuspendedSiblings;
      markRootSuspended(root, lanes, spawnedLane, didAttemptEntireTree);
      return;
    }
  }

  // Otherwise, commit immediately.
  completeRoot(
    root,
    finishedWork,
    lanes,
    recoverableErrors,
    transitions,
    didIncludeRenderPhaseUpdate,
    spawnedLane,
    updatedLanes,
    suspendedRetryLanes,
    didSkipSuspendedSiblings,
    exitStatus,
    suspendedState,
    suspendedCommitReason,
    completedRenderStartTime,
    completedRenderEndTime,
  );
}

function isRenderConsistentWithExternalStores(finishedWork: Fiber): boolean {
  // Search the rendered tree for external store reads, and check whether the
  // stores were mutated in a concurrent event. Intentionally using an iterative
  // loop instead of recursion so we can exit early.
  let node: Fiber = finishedWork;
  for (;;) {
    const tag = node.tag;
    if ((tag === FunctionComponent || tag === ForwardRef || tag === SimpleMemoComponent) && node.flags & StoreConsistency) {
      const updateQueue = node.updateQueue as FunctionComponentUpdateQueue | null;
      if (updateQueue !== null) {
        const checks = updateQueue.stores;
        if (checks !== null) {
          for (let i = 0; i < checks.length; i++) {
            const check = checks[i]!;
            const getSnapshot = check.getSnapshot;
            const renderedValue = check.value;
            try {
              if (!Object.is(getSnapshot(), renderedValue)) {
                // Found an inconsistent store.
                return false;
              }
            } catch {
              // If `getSnapshot` throws, return `false`. This will schedule
              // a re-render, and the error will be rethrown during render.
              return false;
            }
          }
        }
      }
    }
    const child = node.child;
    if (node.subtreeFlags & StoreConsistency && child !== null) {
      child.return = node;
      node = child;
      continue;
    }
    if (node === finishedWork) {
      return true;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        return true;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// The extra indirections around markRootUpdated and markRootSuspended is
// needed to avoid a circular dependency between this module and
// ReactFiberLane. There's probably a better way to split up these modules and
// avoid this problem. Perhaps all the root-marking functions should move into
// the work loop.

function markRootUpdated(root: FiberRoot, updatedLanes: Lanes): void {
  _markRootUpdated(root, updatedLanes);

  if (enableInfiniteRenderLoopDetection) {
    // Check for recursive updates
    if (executionContext & RenderContext) {
      workInProgressRootDidIncludeRecursiveRenderUpdate = true;
    } else if (executionContext & CommitContext) {
      didIncludeCommitPhaseUpdate = true;
    }

    throwIfInfiniteUpdateLoopDetected(true);
  }
}

function markRootPinged(root: FiberRoot, pingedLanes: Lanes): void {
  _markRootPinged(root, pingedLanes);

  if (enableInfiniteRenderLoopDetection) {
    // Check for recursive pings. Pings are conceptually different from updates in
    // other contexts but we call it an "update" in this context because
    // repeatedly pinging a suspended render can cause a recursive render loop.
    // The relevant property is that it can result in a new render attempt
    // being scheduled.
    if (executionContext & RenderContext) {
      workInProgressRootDidIncludeRecursiveRenderUpdate = true;
    } else if (executionContext & CommitContext) {
      didIncludeCommitPhaseUpdate = true;
    }

    throwIfInfiniteUpdateLoopDetected(true);
  }
}

function markRootSuspended(root: FiberRoot, lanes: Lanes, spawnedLane: Lane, didAttemptEntireTree: boolean): void {
  let suspendedLanes = lanes;
  if (enableParallelTransitions) {
    // When suspending, we should always mark the entangled lanes as suspended.
    suspendedLanes = getEntangledLanes(root, suspendedLanes);
  }

  // When suspending, we should always exclude lanes that were pinged or (more
  // rarely, since we try to avoid it) updated during the render phase.
  suspendedLanes = removeLanes(suspendedLanes, workInProgressRootPingedLanes);
  suspendedLanes = removeLanes(suspendedLanes, workInProgressRootInterleavedUpdatedLanes);
  _markRootSuspended(root, suspendedLanes, spawnedLane, didAttemptEntireTree);
}

export function flushRoot(root: FiberRoot, lanes: Lanes): void {
  if (lanes !== NoLanes) {
    upgradePendingLanesToSync(root, lanes);
    ensureRootIsScheduled(root);
    if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
      resetRenderTimer();
      // TODO: For historical reasons this flushes all sync work across all
      // roots. It shouldn't really matter either way, but we could change this
      // to only flush the given root.
      flushSyncWorkOnAllRoots();
    }
  }
}

export function getExecutionContext(): ExecutionContext {
  return executionContext;
}

export function deferredUpdates<A>(fn: () => A): A {
  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(DefaultEventPriority);
    ReactSharedInternals.T = null;
    return fn();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }
}

export function batchedUpdates<A, R>(fn: (a: A) => R, a: A): R {
  if (disableLegacyMode) {
    // batchedUpdates is a no-op now, but there's still some internal react-dom
    // code calling it, that we can't remove until we remove legacy mode.
    return fn(a);
  }
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;
  try {
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    // If there were legacy sync updates, flush them at the end of the outer
    // most batchedUpdates-like method.
    if (
      executionContext === NoContext &&
      // Treat `act` as if it's inside `batchedUpdates`, even in legacy mode.
      !(isDevelopment && ReactSharedInternals.isBatchingLegacy)
    ) {
      resetRenderTimer();
      flushSyncWorkOnLegacyRootsOnly();
    }
  }
}

export function discreteUpdates<A, B, C, D, R>(
  fn: (a: A, b: B, c: C, d: D) => R,
  a: A,
  b: B,
  c: C,
  d: D,
): R {
  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    ReactSharedInternals.T = null;
    return fn(a, b, c, d);
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
    if (executionContext === NoContext) {
      resetRenderTimer();
    }
  }
}

export function flushSyncFromReconciler<R>(fn?: () => R): R | undefined {
  // In legacy mode, we flush pending passive effects at the beginning of the
  // next event, not at the end of the previous one.
  if (
    pendingEffectsStatus !== NO_PENDING_EFFECTS &&
    !disableLegacyMode &&
    pendingEffectsRoot.tag === LegacyRoot &&
    (executionContext & (RenderContext | CommitContext)) === NoContext
  ) {
    flushPendingEffects();
  }

  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;

  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();

  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    ReactSharedInternals.T = null;
    if (fn) {
      return fn();
    }
    return undefined;
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;

    executionContext = prevExecutionContext;
    // Flush the immediate callbacks that were scheduled during this batch.
    // Note that this will happen even if batchedUpdates is higher up
    // the stack.
    if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
      flushSyncWorkOnAllRoots();
    }
  }
}

// If called outside of a render or commit will flush all sync work on all roots
// Returns whether the the call was during a render or not
export function flushSyncWork(): boolean {
  if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
    flushSyncWorkOnAllRoots();
    return false;
  }
  return true;
}

export function isAlreadyRendering(): boolean {
  // Used by the renderer to print a warning if certain APIs are called from
  // the wrong context, and for profiling warnings.
  return (executionContext & (RenderContext | CommitContext)) !== NoContext;
}

export function isInvalidExecutionContextForEventFunction(): boolean {
  // Used to throw if certain APIs are called from the wrong context.
  return (executionContext & RenderContext) !== NoContext;
}

// This is called by the HiddenContext module when we enter or leave a
// hidden subtree. The stack logic is managed there because that's the only
// place that ever modifies it. Which module it lives in doesn't matter for
// performance because this function will get inlined regardless
export function setEntangledRenderLanes(newEntangledRenderLanes: Lanes): void {
  entangledRenderLanes = newEntangledRenderLanes;
}

export function getEntangledRenderLanes(): Lanes {
  return entangledRenderLanes;
}

function resetWorkInProgressStack(): void {
  if (workInProgress === null) return;
  let interruptedWork: Fiber | null;
  if (workInProgressSuspendedReason === NotSuspended) {
    // Normal case. Work-in-progress hasn't started yet. Unwind all
    // its parents.
    interruptedWork = workInProgress.return;
  } else {
    // Work-in-progress is in suspended state. Reset the work loop and unwind
    // both the suspended fiber and all its parents.
    resetSuspendedWorkLoopOnUnwind(workInProgress);
    interruptedWork = workInProgress;
  }
  while (interruptedWork !== null) {
    const current = interruptedWork.alternate;
    unwindInterruptedWork(current, interruptedWork, workInProgressRootRenderLanes);
    interruptedWork = interruptedWork.return;
  }
  workInProgress = null;
}

function finalizeRender(lanes: Lanes, finalizationTime: number): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // enableGestureTransition is off: no render is a gesture render.
    if (includesBlockingLane(lanes)) {
      clampBlockingTimers(finalizationTime);
    }
    if (includesTransitionLane(lanes)) {
      clampTransitionTimers(finalizationTime);
    }
    if (includesRetryLane(lanes)) {
      clampRetryTimers(finalizationTime);
    }
    if (includesIdleGroupLanes(lanes)) {
      clampIdleTimers(finalizationTime);
    }
  }
}

function clampToStart(time: number, clampTime: number): number {
  return time >= 0 && time < clampTime ? clampTime : time;
}

function prepareFreshStack(root: FiberRoot, lanes: Lanes): Fiber {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // The order of tracks within a group are determined by the earliest start time.
    // Are tracks should show up in priority order and we should ideally always show
    // every track. This is a hack to ensure that we're displaying all tracks in the
    // right order. Ideally we could do this only once but because calls that aren't
    // recorded aren't considered for ordering purposes, we need to keep adding these
    // over and over again in case recording has just started. We can't tell when
    // recording starts.
    markAllLanesInOrder();

    const previousRenderStartTime = renderStartTime;
    // Starting a new render. Log the end of any previous renders and the
    // blocked time before the render started.
    recordRenderTime();
    // If this was a restart, e.g. due to an interrupting update, then there's no space
    // in the track to log the cause since we'll have rendered all the way up until the
    // restart so we need to clamp that.
    if (workInProgressRootRenderLanes !== NoLanes && previousRenderStartTime > 0) {
      setCurrentTrackFromLanes(workInProgressRootRenderLanes);
      if (workInProgressRootExitStatus === RootSuspended || workInProgressRootExitStatus === RootSuspendedWithDelay) {
        // If the root was already suspended when it got interrupted and restarted,
        // then this is considered a prewarm and not an interrupted render because
        // we couldn't have shown anything anyway so it's not a bad thing that we
        // got interrupted.
        logSuspendedRenderPhase(previousRenderStartTime, renderStartTime, lanes, workInProgressUpdateTask);
      } else {
        logInterruptedRenderPhase(previousRenderStartTime, renderStartTime, lanes, workInProgressUpdateTask);
      }
      finalizeRender(workInProgressRootRenderLanes, renderStartTime);
    }
    const previousUpdateTask = workInProgressUpdateTask;

    workInProgressUpdateTask = null;
    // enableGestureTransition is off: the gesture track is never started.
    if (includesBlockingLane(lanes)) {
      workInProgressUpdateTask = blockingUpdateTask;
      const clampedUpdateTime = clampToStart(blockingUpdateTime, blockingClampTime);
      const clampedEventTime = clampToStart(blockingEventTime, blockingClampTime);
      const clampedRenderStartTime = // Clamp the suspended time to the first event/update.
        clampedEventTime >= 0 ? clampedEventTime : clampedUpdateTime >= 0 ? clampedUpdateTime : renderStartTime;
      if (blockingSuspendedTime >= 0) {
        setCurrentTrackFromLanes(SyncLane);
        logSuspendedWithDelayPhase(blockingSuspendedTime, clampedRenderStartTime, lanes, previousUpdateTask);
      } else if (includesBlockingLane(animatingLanes)) {
        // If this lane is still animating, log the time from previous render finishing to now as animating.
        setCurrentTrackFromLanes(SyncLane);
        logAnimatingPhase(blockingClampTime, clampedRenderStartTime, animatingTask);
      }
      logBlockingStart(
        clampedUpdateTime,
        clampedEventTime,
        blockingEventType,
        blockingEventRepeatTime > 0,
        blockingUpdateType === SPAWNED_UPDATE,
        blockingUpdateType === PINGED_UPDATE,
        renderStartTime,
        lanes,
        blockingUpdateTask,
        blockingUpdateMethodName,
        blockingUpdateComponentName,
      );
      clearBlockingTimers();
    }
    if (includesTransitionLane(lanes)) {
      workInProgressUpdateTask = transitionUpdateTask;
      const clampedStartTime = clampToStart(transitionStartTime, transitionClampTime);
      const clampedUpdateTime = clampToStart(transitionUpdateTime, transitionClampTime);
      const clampedEventTime = clampToStart(transitionEventTime, transitionClampTime);
      const clampedRenderStartTime =
        // Clamp the suspended time to the first event/update.
        clampedEventTime >= 0 ? clampedEventTime : clampedUpdateTime >= 0 ? clampedUpdateTime : renderStartTime;
      if (transitionSuspendedTime >= 0) {
        setCurrentTrackFromLanes(SomeTransitionLane);
        logSuspendedWithDelayPhase(transitionSuspendedTime, clampedRenderStartTime, lanes, workInProgressUpdateTask);
      } else if (includesTransitionLane(animatingLanes)) {
        // If this lane is still animating, log the time from previous render finishing to now as animating.
        setCurrentTrackFromLanes(SomeTransitionLane);
        logAnimatingPhase(transitionClampTime, clampedRenderStartTime, animatingTask);
      }
      logTransitionStart(
        clampedStartTime,
        clampedUpdateTime,
        clampedEventTime,
        transitionEventType,
        transitionEventRepeatTime > 0,
        transitionUpdateType === PINGED_UPDATE,
        renderStartTime,
        transitionUpdateTask,
        transitionUpdateMethodName,
        transitionUpdateComponentName,
      );
      clearTransitionTimers();
    }
    if (includesRetryLane(lanes)) {
      if (includesRetryLane(animatingLanes)) {
        // If this lane is still animating, log the time from previous render finishing to now as animating.
        setCurrentTrackFromLanes(SomeRetryLane);
        logAnimatingPhase(retryClampTime, renderStartTime, animatingTask);
      }
    }
    if (includesIdleGroupLanes(lanes)) {
      if (includesIdleGroupLanes(animatingLanes)) {
        // If this lane is still animating, log the time from previous render finishing to now as animating.
        setCurrentTrackFromLanes(IdleLane);
        logAnimatingPhase(idleClampTime, renderStartTime, animatingTask);
      }
    }
  }

  const timeoutHandle = root.timeoutHandle;
  if (timeoutHandle !== noTimeout) {
    // The root previous suspended and scheduled a timeout to commit a fallback
    // state. Now that we have additional work, cancel the timeout.
    root.timeoutHandle = noTimeout;
    cancelTimeout(timeoutHandle);
  }
  const cancelPendingCommit = root.cancelPendingCommit;
  if (cancelPendingCommit !== null) {
    root.cancelPendingCommit = null;
    cancelPendingCommit();
  }

  pendingEffectsLanes = NoLanes;

  resetWorkInProgressStack();
  workInProgressRoot = root;
  const rootWorkInProgress = createWorkInProgress(root.current, null);
  workInProgress = rootWorkInProgress;
  workInProgressRootRenderLanes = lanes;
  workInProgressSuspendedReason = NotSuspended;
  workInProgressThrownValue = null;
  workInProgressRootDidSkipSuspendedSiblings = false;
  workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
  workInProgressRootDidAttachPingListener = false;
  workInProgressRootExitStatus = RootInProgress;
  workInProgressRootSkippedLanes = NoLanes;
  workInProgressRootInterleavedUpdatedLanes = NoLanes;
  workInProgressRootRenderPhaseUpdatedLanes = NoLanes;
  workInProgressRootPingedLanes = NoLanes;
  workInProgressDeferredLane = NoLane;
  workInProgressSuspendedRetryLanes = NoLanes;
  workInProgressRootConcurrentErrors = null;
  workInProgressRootRecoverableErrors = null;
  workInProgressRootDidIncludeRecursiveRenderUpdate = false;

  // Get the lanes that are entangled with whatever we're about to render. We
  // track these separately so we can distinguish the priority of the render
  // task from the priority of the lanes it is entangled with. For example, a
  // transition may not be allowed to finish unless it includes the Sync lane,
  // which is currently suspended. We should be able to render the Transition
  // and Sync lane in the same batch, but at Transition priority, because the
  // Sync lane already suspended.
  entangledRenderLanes = getEntangledLanes(root, lanes);

  finishQueueingConcurrentUpdates();

  if (isDevelopment) {
    resetOwnerStackLimit();

    ReactStrictModeWarnings.discardPendingWarnings();
  }

  return rootWorkInProgress;
}

function resetSuspendedWorkLoopOnUnwind(fiber: Fiber): void {
  // Reset module-level state that was set during the render phase.
  resetContextDependencies();
  resetHooksOnUnwind(fiber);
  resetChildReconcilerOnUnwind();
}

function handleThrow(root: FiberRoot, thrown: unknown): void {
  // A component threw an exception. Usually this is because it suspended, but
  // it also includes regular program errors.
  //
  // We're either going to unwind the stack to show a Suspense or error
  // boundary, or we're going to replay the component again. Like after a
  // promise resolves.
  //
  // Until we decide whether we're going to unwind or replay, we should preserve
  // the current state of the work loop without resetting anything.
  //
  // If we do decide to unwind the stack, module-level variables will be reset
  // in resetSuspendedWorkLoopOnUnwind.

  // These should be reset immediately because they're only supposed to be set
  // when React is executing user code.
  let thrownValue = thrown;
  resetHooksAfterThrow();
  if (isDevelopment) {
    resetCurrentFiber();
  }

  if (thrownValue === SuspenseException || thrownValue === SuspenseActionException) {
    // This is a special type of exception used for Suspense. For historical
    // reasons, the rest of the Suspense implementation expects the thrown value
    // to be a thenable, because before `use` existed that was the (unstable)
    // API for suspending. This implementation detail can change later, once we
    // deprecate the old API in favor of `use`.
    thrownValue = getSuspendedThenable();
    // TODO: Suspending the work loop during the render phase is
    // currently not compatible with sibling prerendering. We will add
    // this optimization back in a later step.
    // Don't suspend work loop, except to check if the data has
    // immediately resolved (i.e. in a microtask). Otherwise, trigger the
    // nearest Suspense fallback.
    workInProgressSuspendedReason = SuspendedOnImmediate;
  } else if (thrownValue === SuspenseyCommitException) {
    thrownValue = getSuspendedThenable();
    workInProgressSuspendedReason = SuspendedOnInstance;
  } else if (thrownValue === SelectiveHydrationException) {
    // An update flowed into a dehydrated boundary. Before we can apply the
    // update, we need to finish hydrating. Interrupt the work-in-progress
    // render so we can restart at the hydration lane.
    //
    // The ideal implementation would be able to switch contexts without
    // unwinding the current stack.
    //
    // We could name this something more general but as of now it's the only
    // case where we think this should happen.
    workInProgressSuspendedReason = SuspendedOnHydration;
  } else {
    // This is a regular error.
    const isWakeable =
      thrownValue !== null &&
      typeof thrownValue === "object" &&
      typeof (thrownValue as { then?: unknown }).then === "function";

    workInProgressSuspendedReason = isWakeable
      ? // A wakeable object was thrown by a legacy Suspense implementation.
        // This has slightly different behavior than suspending with `use`.
        SuspendedOnDeprecatedThrowPromise
      : // This is a regular error. If something earlier in the component already
        // suspended, we must clear the thenable state to unblock the work loop.
        SuspendedOnError;
  }

  workInProgressThrownValue = thrownValue;

  const erroredWork = workInProgress;
  if (erroredWork === null) {
    // This is a fatal error
    workInProgressRootExitStatus = RootFatalErrored;
    logUncaughtError(root, createCapturedValueAtFiber(thrownValue, root.current));
    return;
  }

  if (enableProfilerTimer && erroredWork.mode & ProfileMode) {
    // Record the time spent rendering before an error was thrown. This
    // avoids inaccurate Profiler durations in the case of a
    // suspended render.
    stopProfilerTimerIfRunningAndRecordDuration(erroredWork);
  }

  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
    switch (workInProgressSuspendedReason) {
      case SuspendedOnError: {
        markComponentErrored(erroredWork, thrownValue, workInProgressRootRenderLanes);
        break;
      }
      case SuspendedOnData:
      case SuspendedOnAction:
      case SuspendedOnImmediate:
      case SuspendedOnDeprecatedThrowPromise:
      case SuspendedAndReadyToContinue: {
        const wakeable = thrownValue as Wakeable;
        markComponentSuspended(erroredWork, wakeable, workInProgressRootRenderLanes);
        break;
      }
      case SuspendedOnInstance: {
        // This is conceptually like a suspend, but it's not associated with
        // a particular wakeable. It's associated with a host resource (e.g.
        // a CSS file or an image) that hasn't loaded yet. DevTools doesn't
        // handle this currently.
        break;
      }
      case SuspendedOnHydration: {
        // This is conceptually like a suspend, but it's not associated with
        // a particular wakeable. DevTools doesn't seem to care about this case,
        // currently. It's similar to if the component were interrupted, which
        // we don't mark with a special function.
        break;
      }
    }
  }
}

export function shouldRemainOnPreviousScreen(): boolean {
  // This is asking whether it's better to suspend the transition and remain
  // on the previous screen, versus showing a fallback as soon as possible. It
  // takes into account both the priority of render and also whether showing a
  // fallback would produce a desirable user experience.

  const handler = getSuspenseHandler();
  if (handler === null) {
    // There's no Suspense boundary that can provide a fallback. We have no
    // choice but to remain on the previous screen.
    // NOTE: We do this even for sync updates, for lack of any better option. In
    // the future, we may change how we handle this, like by putting the whole
    // root into a "detached" mode.
    return true;
  }

  // TODO: Once `use` has fully replaced the `throw promise` pattern, we should
  // be able to remove the equivalent check in finishConcurrentRender, and rely
  // just on this one.
  if (includesOnlyTransitions(workInProgressRootRenderLanes)) {
    if (getShellBoundary() === null) {
      // We're rendering inside the "shell" of the app. Activating the nearest
      // fallback would cause visible content to disappear. It's better to
      // suspend the transition and remain on the previous screen.
      return true;
    }
    // We're rendering content that wasn't part of the previous screen.
    // Rather than block the transition, it's better to show a fallback as
    // soon as possible. The appearance of any nested fallbacks will be
    // throttled to avoid jank.
    return false;
  }

  if (
    includesOnlyRetries(workInProgressRootRenderLanes) ||
    // In this context, an OffscreenLane counts as a Retry
    // TODO: It's become increasingly clear that Retries and Offscreen are
    // deeply connected. They probably can be unified further.
    includesSomeLane(workInProgressRootRenderLanes, OffscreenLane)
  ) {
    // During a retry, we can suspend rendering if the nearest Suspense boundary
    // is the boundary of the "shell", because we're guaranteed not to block
    // any new content from appearing.
    //
    // The reason we must check if this is a retry is because it guarantees
    // that suspending the work loop won't block an actual update, because
    // retries don't "update" anything; they fill in fallbacks that were left
    // behind by a previous transition.
    return handler === getShellBoundary();
  }

  // For all other Lanes besides Transitions and Retries, we should not wait
  // for the data to load.
  return false;
}

type AsyncDispatcher = typeof ReactSharedInternals.A;

function pushDispatcher(_container: unknown): SavedDispatcher {
  return pushContextOnlyDispatcher();
}

function popDispatcher(prevDispatcher: SavedDispatcher): void {
  restoreDispatcher(prevDispatcher);
}

function pushAsyncDispatcher(): AsyncDispatcher {
  const prevAsyncDispatcher = ReactSharedInternals.A;
  ReactSharedInternals.A = DefaultAsyncDispatcher;
  return prevAsyncDispatcher;
}

function popAsyncDispatcher(prevAsyncDispatcher: AsyncDispatcher): void {
  ReactSharedInternals.A = prevAsyncDispatcher;
}

export function markRenderDerivedCause(fiber: Fiber): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (isDevelopment) {
      if (workInProgressUpdateTask === null) {
        // If we don't have a cause associated with this render, it's likely because some
        // other render left work behind on this Fiber. The real cause is this Fiber itself.
        // We use its debugTask as the cause for this render. This might not be the only
        // one when multiple siblings are rendered but they ideally shouldn't be.
        workInProgressUpdateTask = fiber._debugTask == null ? null : fiber._debugTask;
      }
    }
  }
}

export function markTransitionStarted(): void {
  globalMostRecentTransitionTime = now();
}

export function markCommitTimeOfFallback(): void {
  globalMostRecentFallbackTime = now();
}

export function markSkippedUpdateLanes(lane: Lane | Lanes): void {
  workInProgressRootSkippedLanes = mergeLanes(lane, workInProgressRootSkippedLanes);
}

export function renderDidSuspend(): void {
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootSuspended;
  }
}

export function renderDidSuspendDelayIfPossible(): void {
  workInProgressRootExitStatus = RootSuspendedWithDelay;

  if (
    !workInProgressRootDidSkipSuspendedSiblings &&
    // Check if the root will be blocked from committing.
    // TODO: Consider aligning this better with the rest of the logic. Maybe
    // we should only set the exit status to RootSuspendedWithDelay if this
    // condition is true? And remove the equivalent checks elsewhere.
    (includesOnlyTransitions(workInProgressRootRenderLanes) || getSuspenseHandler() === null)
  ) {
    // This render may not have originally been scheduled as a prerender, but
    // something suspended inside the visible part of the tree, which means we
    // won't be able to commit a fallback anyway. Let's proceed as if this were
    // a prerender so that we can warm up the siblings without scheduling a
    // separate pass.
    workInProgressRootIsPrerendering = true;
  }

  // Check if there are updates that we skipped tree that might have unblocked
  // this render.
  if (
    (includesNonIdleWork(workInProgressRootSkippedLanes) ||
      includesNonIdleWork(workInProgressRootInterleavedUpdatedLanes)) &&
    workInProgressRoot !== null
  ) {
    // Mark the current render as suspended so that we switch to working on
    // the updates that were skipped. Usually we only suspend at the end of
    // the render phase.
    // TODO: We should probably always mark the root as suspended immediately
    // (inside this function), since by suspending at the end of the render
    // phase introduces a potential mistake where we suspend lanes that were
    // pinged or updated while we were rendering.
    // TODO: Consider unwinding immediately, using the
    // SuspendedOnHydration mechanism.
    const didAttemptEntireTree = false;
    markRootSuspended(workInProgressRoot, workInProgressRootRenderLanes, workInProgressDeferredLane, didAttemptEntireTree);
  }
}

export function renderDidError(): void {
  if (workInProgressRootExitStatus !== RootSuspendedWithDelay) {
    workInProgressRootExitStatus = RootErrored;
  }
}

export function queueConcurrentError(error: CapturedValue): void {
  if (workInProgressRootConcurrentErrors === null) {
    workInProgressRootConcurrentErrors = [error];
  } else {
    workInProgressRootConcurrentErrors.push(error);
  }
}

// Called during render to determine if anything has suspended.
// Returns false if we're not sure.
export function renderHasNotSuspendedYet(): boolean {
  // If something errored or completed, we can't really be sure,
  // so those are false.
  return workInProgressRootExitStatus === RootInProgress;
}

// TODO: Over time, this function and renderRootConcurrent have become more
// and more similar. Not sure it makes sense to maintain forked paths. Consider
// unifying them again.
function renderRootSync(root: FiberRoot, lanes: Lanes, shouldYieldForPrerendering: boolean): RootExitStatus {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;
  const prevDispatcher = pushDispatcher(root.containerInfo);
  const prevAsyncDispatcher = pushAsyncDispatcher();

  // If the root or lanes have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        const memoizedUpdaters = root.memoizedUpdaters;
        if (memoizedUpdaters.size > 0) {
          restorePendingUpdaters(root, workInProgressRootRenderLanes);
          memoizedUpdaters.clear();
        }

        // At this point, move Fibers that scheduled the upcoming work from the Map to the Set.
        // If we bailout on this work, we'll move them back (like above).
        // It's important to move them now in case the work spawns more work at the same priority with different updaters.
        // That way we can keep the current update and future updates separate.
        movePendingFibersToMemoized(root, lanes);
      }
    }

    workInProgressTransitions = getTransitionsForLanes(root, lanes);
    prepareFreshStack(root, lanes);
  }

  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  let didSuspendInShell = false;
  let exitStatus = workInProgressRootExitStatus;
  outer: for (;;) {
    try {
      if (workInProgressSuspendedReason !== NotSuspended && workInProgress !== null) {
        // The work loop is suspended. During a synchronous render, we don't
        // yield to the main thread. Immediately unwind the stack. This will
        // trigger either a fallback or an error boundary.
        // TODO: For discrete and "default" updates (anything that's not
        // flushSync), we want to wait for the microtasks the flush before
        // unwinding. Will probably implement this using renderRootConcurrent,
        // or merge renderRootSync and renderRootConcurrent into the same
        // function and fork the behavior some other way.
        const unitOfWork = workInProgress;
        const thrownValue = workInProgressThrownValue;
        switch (workInProgressSuspendedReason) {
          case SuspendedOnHydration: {
            // Selective hydration. An update flowed into a dehydrated tree.
            // Interrupt the current render so the work loop can switch to the
            // hydration lane.
            // TODO: I think we might not need to reset the stack here; we can
            // just yield and reset the stack when we re-enter the work loop,
            // like normal.
            resetWorkInProgressStack();
            exitStatus = RootSuspendedAtTheShell;
            break outer;
          }
          case SuspendedOnImmediate:
          case SuspendedOnData:
          case SuspendedOnAction:
          case SuspendedOnDeprecatedThrowPromise: {
            if (getSuspenseHandler() === null) {
              didSuspendInShell = true;
            }
            const reason = workInProgressSuspendedReason;
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
            if (shouldYieldForPrerendering && workInProgressRootIsPrerendering) {
              // We've switched into prerendering mode. This implies that we
              // suspended outside of a Suspense boundary, which means this
              // render will be blocked from committing. Yield to the main
              // thread so we can switch to prerendering using the concurrent
              // work loop.
              exitStatus = RootInProgress;
              break outer;
            }
            break;
          }
          default: {
            // Unwind then continue with the normal work loop.
            const reason = workInProgressSuspendedReason;
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
            break;
          }
        }
      }
      workLoopSync();
      exitStatus = workInProgressRootExitStatus;
      break;
    } catch (thrownValue) {
      handleThrow(root, thrownValue);
    }
  }

  // Check if something suspended in the shell. We use this to detect an
  // infinite ping loop caused by an uncached promise.
  //
  // Only increment this counter once per synchronous render attempt across the
  // whole tree. Even if there are many sibling components that suspend, this
  // counter only gets incremented once.
  if (didSuspendInShell) {
    root.shellSuspendCounter++;
  }

  resetContextDependencies();

  executionContext = prevExecutionContext;
  popDispatcher(prevDispatcher);
  popAsyncDispatcher(prevAsyncDispatcher);

  if (enableSchedulingProfiler) {
    markRenderStopped();
  }

  if (workInProgress !== null) {
    // Did not complete the tree. This can happen if something suspended in
    // the shell.
  } else {
    // Normal case. We completed the whole tree.

    // Set this to null to indicate there's no in-progress render.
    workInProgressRoot = null;
    workInProgressRootRenderLanes = NoLanes;

    // It's safe to process the queue now that the render phase is complete.
    finishQueueingConcurrentUpdates();
  }

  return exitStatus;
}

// The work loop is an extremely hot path.
function workLoopSync(): void {
  // Perform work without checking if we need to yield between fiber.
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

function renderRootConcurrent(root: FiberRoot, lanes: Lanes): RootExitStatus {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;
  const prevDispatcher = pushDispatcher(root.containerInfo);
  const prevAsyncDispatcher = pushAsyncDispatcher();

  // If the root or lanes have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        const memoizedUpdaters = root.memoizedUpdaters;
        if (memoizedUpdaters.size > 0) {
          restorePendingUpdaters(root, workInProgressRootRenderLanes);
          memoizedUpdaters.clear();
        }

        // At this point, move Fibers that scheduled the upcoming work from the Map to the Set.
        // If we bailout on this work, we'll move them back (like above).
        // It's important to move them now in case the work spawns more work at the same priority with different updaters.
        // That way we can keep the current update and future updates separate.
        movePendingFibersToMemoized(root, lanes);
      }
    }

    workInProgressTransitions = getTransitionsForLanes(root, lanes);

    resetRenderTimer();
    prepareFreshStack(root, lanes);
  } else {
    // This is a continuation of an existing work-in-progress.
    //
    // If we were previously in prerendering mode, check if we received any new
    // data during an interleaved event.
    workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
  }

  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  outer: for (;;) {
    try {
      if (workInProgressSuspendedReason !== NotSuspended && workInProgress !== null) {
        // The work loop is suspended. We need to either unwind the stack or
        // replay the suspended component.
        const unitOfWork = workInProgress;
        const thrownValue = workInProgressThrownValue;
        resumeOrUnwind: switch (workInProgressSuspendedReason) {
          case SuspendedOnError: {
            // Unwind then continue with the normal work loop.
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, SuspendedOnError);
            break;
          }
          case SuspendedOnData:
          case SuspendedOnAction: {
            const thenable = thrownValue as Thenable<unknown>;
            if (isThenableResolved(thenable)) {
              // The data resolved. Try rendering the component again.
              workInProgressSuspendedReason = NotSuspended;
              workInProgressThrownValue = null;
              replaySuspendedUnitOfWork(unitOfWork);
              break;
            }
            // The work loop is suspended on data. We should wait for it to
            // resolve before continuing to render.
            // TODO: Handle the case where the promise resolves synchronously.
            // Usually this is handled when we instrument the promise to add a
            // `status` field, but if the promise already has a status, we won't
            // have added a listener until right here.
            const onResolution = (): void => {
              // Check if the root is still suspended on this promise.
              if (
                (workInProgressSuspendedReason === SuspendedOnData ||
                  workInProgressSuspendedReason === SuspendedOnAction) &&
                workInProgressRoot === root
              ) {
                // Mark the root as ready to continue rendering.
                workInProgressSuspendedReason = SuspendedAndReadyToContinue;
              }
              // Ensure the root is scheduled. We should do this even if we're
              // currently working on a different root, so that we resume
              // rendering later.
              ensureRootIsScheduled(root);
            };
            thenable.then(onResolution, onResolution);
            break outer;
          }
          case SuspendedOnImmediate: {
            // If this fiber just suspended, it's possible the data is already
            // cached. Yield to the main thread to give it a chance to ping. If
            // it does, we can retry immediately without unwinding the stack.
            workInProgressSuspendedReason = SuspendedAndReadyToContinue;
            break outer;
          }
          case SuspendedOnInstance: {
            workInProgressSuspendedReason = SuspendedOnInstanceAndReadyToContinue;
            break outer;
          }
          case SuspendedAndReadyToContinue: {
            const thenable = thrownValue as Thenable<unknown>;
            if (isThenableResolved(thenable)) {
              // The data resolved. Try rendering the component again.
              workInProgressSuspendedReason = NotSuspended;
              workInProgressThrownValue = null;
              replaySuspendedUnitOfWork(unitOfWork);
            } else {
              // Otherwise, unwind then continue with the normal work loop.
              workInProgressSuspendedReason = NotSuspended;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, SuspendedAndReadyToContinue);
            }
            break;
          }
          case SuspendedOnInstanceAndReadyToContinue: {
            const tag = workInProgress.tag;
            if (tag === HostHoistable || tag === HostComponent || tag === HostSingleton) {
              const resource: unknown = tag === HostHoistable ? workInProgress.memoizedState : null;
              // Before unwinding the stack, check one more time if the
              // instance is ready. It may have loaded when React yielded to
              // the main thread.
              const hostFiber = workInProgress;
              const type = hostFiber.type as string;
              const props = hostFiber.pendingProps as Props;
              const isReady = resource ? preloadResource(resource) : preloadInstance(hostInstanceOf(hostFiber), type, props);
              if (isReady) {
                // The data resolved. Resume the work loop as if nothing
                // suspended. Unlike when a user component suspends, we don't
                // have to replay anything because the host fiber
                // already completed.
                workInProgressSuspendedReason = NotSuspended;
                workInProgressThrownValue = null;
                const sibling = hostFiber.sibling;
                if (sibling !== null) {
                  workInProgress = sibling;
                } else {
                  const returnFiber = hostFiber.return;
                  if (returnFiber !== null) {
                    workInProgress = returnFiber;
                    completeUnitOfWork(returnFiber);
                  } else {
                    workInProgress = null;
                  }
                }
                break resumeOrUnwind;
              }
            } else {
              // This will fail gracefully but it's not correct, so log a
              // warning in dev.
              if (isDevelopment) {
                console.error("Unexpected type of fiber triggered a suspensey commit. " + "This is a bug in React.");
              }
            }
            // Otherwise, unwind then continue with the normal work loop.
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, SuspendedOnInstanceAndReadyToContinue);
            break;
          }
          case SuspendedOnDeprecatedThrowPromise: {
            // Suspended by an old implementation that uses the `throw promise`
            // pattern. The newer replaying behavior can cause subtle issues
            // like infinite ping loops. So we maintain the old behavior and
            // always unwind.
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, SuspendedOnDeprecatedThrowPromise);
            break;
          }
          case SuspendedOnHydration: {
            // Selective hydration. An update flowed into a dehydrated tree.
            // Interrupt the current render so the work loop can switch to the
            // hydration lane.
            resetWorkInProgressStack();
            workInProgressRootExitStatus = RootSuspendedAtTheShell;
            break outer;
          }
          default: {
            throw new Error("Unexpected SuspendedReason. This is a bug in React.");
          }
        }
      }

      if (isDevelopment && ReactSharedInternals.actQueue !== null) {
        // `act` special case: If we're inside an `act` scope, don't consult
        // `shouldYield`. Always keep working until the render is complete.
        // This is not just an optimization: in a unit test environment, we
        // can't trust the result of `shouldYield`, because the host I/O is
        // likely mocked.
        workLoopSync();
      } else if (enableThrottledScheduling) {
        workLoopConcurrent(includesNonIdleWork(lanes));
      } else {
        workLoopConcurrentByScheduler();
      }
      break;
    } catch (thrownValue) {
      handleThrow(root, thrownValue);
    }
  }
  resetContextDependencies();

  popDispatcher(prevDispatcher);
  popAsyncDispatcher(prevAsyncDispatcher);
  executionContext = prevExecutionContext;

  // Check if the tree has completed.
  if (workInProgress !== null) {
    // Still work remaining.
    if (enableSchedulingProfiler) {
      markRenderYielded();
    }
    return RootInProgress;
  }
  // Completed the tree.
  if (enableSchedulingProfiler) {
    markRenderStopped();
  }

  // Set this to null to indicate there's no in-progress render.
  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;

  // It's safe to process the queue now that the render phase is complete.
  finishQueueingConcurrentUpdates();

  // Return the final exit status.
  return workInProgressRootExitStatus;
}

function workLoopConcurrent(nonIdle: boolean): void {
  // We yield every other "frame" when rendering Transition or Retries. Those are blocking
  // revealing new content. The purpose of this yield is not to avoid the overhead of yielding,
  // which is very low, but rather to intentionally block any frequently occurring other main
  // thread work like animations from starving our work. In other words, the purpose of this
  // is to reduce the framerate of animations to 30 frames per second.
  // For Idle work we yield every 5ms to keep animations going smooth.
  if (workInProgress !== null) {
    const yieldAfter = now() + (nonIdle ? 25 : 5);
    do {
      performUnitOfWork(workInProgress);
    } while (workInProgress !== null && now() < yieldAfter);
  }
}

function workLoopConcurrentByScheduler(): void {
  // Perform work until Scheduler asks us to yield
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

function performUnitOfWork(unitOfWork: Fiber): void {
  // The current, flushed, state of this fiber is the alternate. Ideally
  // nothing should rely on this, but relying on it here means that we don't
  // need an additional field on the work in progress.
  const current = unitOfWork.alternate;

  let next: Fiber | null;
  if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
    startProfilerTimer(unitOfWork);
    if (isDevelopment) {
      next = runWithFiberInDEV(unitOfWork, () => beginWork(current, unitOfWork, entangledRenderLanes));
    } else {
      next = beginWork(current, unitOfWork, entangledRenderLanes);
    }
    stopProfilerTimerIfRunningAndRecordDuration(unitOfWork);
  } else {
    if (isDevelopment) {
      next = runWithFiberInDEV(unitOfWork, () => beginWork(current, unitOfWork, entangledRenderLanes));
    } else {
      next = beginWork(current, unitOfWork, entangledRenderLanes);
    }
  }

  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    // If this doesn't spawn new work, complete the current work.
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

function replaySuspendedUnitOfWork(unitOfWork: Fiber): void {
  // This is a fork of performUnitOfWork specifcally for replaying a fiber that
  // just suspended.
  let next: Fiber | null;
  if (isDevelopment) {
    next = runWithFiberInDEV(unitOfWork, () => replayBeginWork(unitOfWork));
  } else {
    next = replayBeginWork(unitOfWork);
  }

  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    // If this doesn't spawn new work, complete the current work.
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

function replayBeginWork(suspendedUnitOfWork: Fiber): Fiber | null {
  // This is a fork of beginWork specifcally for replaying a fiber that
  // just suspended.
  let unitOfWork = suspendedUnitOfWork;
  const current = unitOfWork.alternate;

  let next: Fiber | null;
  const isProfilingMode = enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode;
  if (isProfilingMode) {
    startProfilerTimer(unitOfWork);
  }
  switch (unitOfWork.tag) {
    case SimpleMemoComponent:
    case FunctionComponent: {
      // Resolve `defaultProps`. This logic is copied from `beginWork`.
      // TODO: Consider moving this switch statement into that module. Also,
      // could maybe use this as an opportunity to say `use` doesn't work with
      // `defaultProps` :)
      const Component = unitOfWork.type;
      let context: unknown;
      if (!disableLegacyContext) {
        const unmaskedContext = getUnmaskedContext(unitOfWork, Component, true);
        context = getMaskedContext(unitOfWork, unmaskedContext);
      }
      next = replayFunctionComponent(
        current,
        unitOfWork,
        unitOfWork.pendingProps,
        Component,
        context,
        workInProgressRootRenderLanes,
      );
      break;
    }
    case ForwardRef: {
      // Resolve `defaultProps`. This logic is copied from `beginWork`.
      // TODO: Consider moving this switch statement into that module. Also,
      // could maybe use this as an opportunity to say `use` doesn't work with
      // `defaultProps` :)
      const Component = (unitOfWork.type as { render: unknown }).render;
      next = replayFunctionComponent(
        current,
        unitOfWork,
        unitOfWork.pendingProps,
        Component,
        unitOfWork.ref,
        workInProgressRootRenderLanes,
      );
      break;
    }
    default: {
      if (unitOfWork.tag === HostComponent) {
        // Some host components are stateful (that's how we implement form
        // actions) but we don't bother to reuse the memoized state because it's
        // not worth the extra code. The main reason to reuse the previous hooks
        // is to reuse uncached promises, but we happen to know that the only
        // promises that a host component might suspend on are definitely cached
        // because they are controlled by us. So don't bother.
        resetHooksOnUnwind(unitOfWork);
        // We are about to retry this host component and need to ensure the hydration
        // state is appropriate for hydrating this unit. Other fiber types hydrate differently
        // and aren't reliant on the cursor positioning so this function is only for HostComponent
        popHydrationStateOnInterruptedWork(unitOfWork);
      }
      // Other types besides function components are reset completely before
      // being replayed. Currently this only happens when a Usable type is
      // reconciled — the reconciler will suspend.
      //
      // We reset the fiber back to its original state; however, this isn't
      // a full "unwind" because we're going to reuse the promises that were
      // reconciled previously. So it's intentional that we don't call
      // resetSuspendedWorkLoopOnUnwind here.
      unwindInterruptedWork(current, unitOfWork, workInProgressRootRenderLanes);
      unitOfWork = workInProgress = resetWorkInProgress(unitOfWork, entangledRenderLanes);
      next = beginWork(current, unitOfWork, entangledRenderLanes);
      break;
    }
  }
  if (isProfilingMode) {
    stopProfilerTimerIfRunningAndRecordDuration(unitOfWork);
  }

  return next;
}

function throwAndUnwindWorkLoop(
  root: FiberRoot,
  unitOfWork: Fiber,
  thrownValue: unknown,
  suspendedReason: SuspendedReason,
): void {
  // This is a fork of performUnitOfWork specifcally for unwinding a fiber
  // that threw an exception.
  //
  // Return to the normal work loop. This will unwind the stack, and potentially
  // result in showing a fallback.
  resetSuspendedWorkLoopOnUnwind(unitOfWork);

  const returnFiber = unitOfWork.return;
  try {
    // Find and mark the nearest Suspense or error boundary that can handle
    // this "exception".
    const didFatal = throwException(root, returnFiber, unitOfWork, thrownValue, workInProgressRootRenderLanes);
    if (didFatal) {
      panicOnRootError(root, thrownValue);
      return;
    }
  } catch (error) {
    // We had trouble processing the error. An example of this happening is
    // when accessing the `componentDidCatch` property of an error boundary
    // throws an error. A weird edge case. There's a regression test for this.
    // To prevent an infinite loop, bubble the error up to the next parent.
    if (returnFiber !== null) {
      workInProgress = returnFiber;
      throw error;
    } else {
      panicOnRootError(root, thrownValue);
      return;
    }
  }

  if (unitOfWork.flags & Incomplete) {
    // Unwind the stack until we reach the nearest boundary.
    let skipSiblings: boolean;

    if (
      // The current algorithm for both hydration and error handling assumes
      // that the tree is rendered sequentially. So we always skip the siblings.
      getIsHydrating() ||
      suspendedReason === SuspendedOnError
    ) {
      skipSiblings = true;
      // We intentionally don't set workInProgressRootDidSkipSuspendedSiblings,
      // because we don't want to trigger another prerender attempt.
    } else if (
      // Check whether this is a prerender
      !workInProgressRootIsPrerendering &&
      // Offscreen rendering is also a form of speculative rendering
      !includesSomeLane(workInProgressRootRenderLanes, OffscreenLane)
    ) {
      // This is not a prerender. Skip the siblings during this render. A
      // separate prerender will be scheduled for later.
      skipSiblings = true;
      workInProgressRootDidSkipSuspendedSiblings = true;

      // Because we're skipping the siblings, schedule an immediate retry of
      // this boundary.
      //
      // The reason we do this is because a prerender is only scheduled when
      // the root is blocked from committing, i.e. RootSuspendedWithDelay.
      // When the root is not blocked, as in the case when we render a
      // fallback, the original lane is considered to be finished, and
      // therefore no longer in need of being prerendered. However, there's
      // still a pending retry that will happen once the data streams in.
      // We should start rendering that even before the data streams in so we
      // can prerender the siblings.
      if (
        suspendedReason === SuspendedOnData ||
        suspendedReason === SuspendedOnAction ||
        suspendedReason === SuspendedOnImmediate ||
        suspendedReason === SuspendedOnDeprecatedThrowPromise
      ) {
        const boundary = getSuspenseHandler();
        if (boundary !== null && boundary.tag === SuspenseComponent) {
          boundary.flags |= ScheduleRetry;
        }
      }
    } else {
      // This is a prerender. Don't skip the siblings.
      skipSiblings = false;
    }

    unwindUnitOfWork(unitOfWork, skipSiblings);
  } else {
    // Although the fiber suspended, we're intentionally going to commit it in
    // an inconsistent state. We can do this safely in cases where we know the
    // inconsistent tree will be hidden.
    //
    // This currently only applies to Legacy Suspense implementation, but we may
    // port a version of this to concurrent roots, too, when performing a
    // synchronous render. Because that will allow us to mutate the tree as we
    // go instead of buffering mutations until the end. Though it's unclear if
    // this particular path is how that would be implemented.
    completeUnitOfWork(unitOfWork);
  }
}

export function markSpawnedRetryLane(lane: Lane): void {
  // Keep track of the retry lanes that were spawned by a fallback during the
  // current render and were not later pinged. This will represent the lanes
  // that are known to still be suspended.
  workInProgressSuspendedRetryLanes = mergeLanes(workInProgressSuspendedRetryLanes, lane);
}

function panicOnRootError(root: FiberRoot, error: unknown): void {
  // There's no ancestor that can handle this exception. This should never
  // happen because the root is supposed to capture all errors that weren't
  // caught by an error boundary. This is a fatal error, or panic condition,
  // because we've run out of ways to recover.
  workInProgressRootExitStatus = RootFatalErrored;
  logUncaughtError(root, createCapturedValueAtFiber(error, root.current));
  // Set `workInProgress` to null. This represents advancing to the next
  // sibling, or the parent if there are no siblings. But since the root
  // has no siblings nor a parent, we set it to null. Usually this is
  // handled by `completeUnitOfWork` or `unwindWork`, but since we're
  // intentionally not calling those, we need set it here.
  // TODO: Consider calling `unwindWork` to pop the contexts.
  workInProgress = null;
}

function completeUnitOfWork(unitOfWork: Fiber): void {
  // Attempt to complete the current unit of work, then move to the next
  // sibling. If there are no more siblings, return to the parent fiber.
  let completedWork: Fiber | null = unitOfWork;
  do {
    if ((completedWork.flags & Incomplete) !== NoFlags) {
      // This fiber did not complete, because one of its children did not
      // complete. Switch to unwinding the stack instead of completing it.
      //
      // The reason "unwind" and "complete" is interleaved is because when
      // something suspends, we continue rendering the siblings even though
      // they will be replaced by a fallback.
      const skipSiblings = workInProgressRootDidSkipSuspendedSiblings;
      unwindUnitOfWork(completedWork, skipSiblings);
      return;
    }

    // The current, flushed, state of this fiber is the alternate. Ideally
    // nothing should rely on this, but relying on it here means that we don't
    // need an additional field on the work in progress.
    const current = completedWork.alternate;
    const returnFiber: Fiber | null = completedWork.return;

    let next: Fiber | null;
    startProfilerTimer(completedWork);
    const fiberToComplete: Fiber = completedWork;
    if (isDevelopment) {
      next = runWithFiberInDEV(fiberToComplete, () => completeWork(current, fiberToComplete, entangledRenderLanes));
    } else {
      next = completeWork(current, fiberToComplete, entangledRenderLanes);
    }
    if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
      // Update render duration assuming we didn't error.
      stopProfilerTimerIfRunningAndRecordIncompleteDuration(completedWork);
    }
    if (next !== null) {
      // Completing this fiber spawned new work. Work on that next.
      workInProgress = next;
      return;
    }

    const siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      // If there is more work to do in this returnFiber, do that next.
      workInProgress = siblingFiber;
      return;
    }
    // Otherwise, return to the parent
    completedWork = returnFiber;
    // Update the next thing we're working on in case something throws.
    workInProgress = completedWork;
  } while (completedWork !== null);

  // We've reached the root.
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootCompleted;
  }
}

function unwindUnitOfWork(unitOfWork: Fiber, skipSiblings: boolean): void {
  let incompleteWork: Fiber | null = unitOfWork;
  do {
    // The current, flushed, state of this fiber is the alternate. Ideally
    // nothing should rely on this, but relying on it here means that we don't
    // need an additional field on the work in progress.
    const current = incompleteWork.alternate;

    // This fiber did not complete because something threw. Pop values off
    // the stack without entering the complete phase. If this is a boundary,
    // capture values if possible.
    const next = unwindWork(current, incompleteWork, entangledRenderLanes);

    // Because this fiber did not complete, don't reset its lanes.

    if (next !== null) {
      // Found a boundary that can handle this exception. Re-renter the
      // begin phase. This branch will return us to the normal work loop.
      //
      // Since we're restarting, remove anything that is not a host effect
      // from the effect tag.
      next.flags &= HostEffectMask;
      workInProgress = next;
      return;
    }

    // Keep unwinding until we reach either a boundary or the root.

    if (enableProfilerTimer && (incompleteWork.mode & ProfileMode) !== NoMode) {
      // Record the render duration for the fiber that errored.
      stopProfilerTimerIfRunningAndRecordIncompleteDuration(incompleteWork);

      // Include the time spent working on failed children before continuing.
      let actualDuration = incompleteWork.actualDuration;
      let child = incompleteWork.child;
      while (child !== null) {
        actualDuration += child.actualDuration;
        child = child.sibling;
      }
      incompleteWork.actualDuration = actualDuration;
    }

    // TODO: Once we stop prerendering siblings, instead of resetting the parent
    // of the node being unwound, we should be able to reset node itself as we
    // unwind the stack. Saves an additional null check.
    const returnFiber: Fiber | null = incompleteWork.return;
    if (returnFiber !== null) {
      // Mark the parent fiber as incomplete and clear its subtree flags.
      // TODO: Once we stop prerendering siblings, we may be able to get rid of
      // the Incomplete flag because unwinding to the nearest boundary will
      // happen synchronously.
      returnFiber.flags |= Incomplete;
      returnFiber.subtreeFlags = NoFlags;
      returnFiber.deletions = null;
    }

    if (!skipSiblings) {
      const siblingFiber = incompleteWork.sibling;
      if (siblingFiber !== null) {
        // This branch will return us to the normal work loop.
        workInProgress = siblingFiber;
        return;
      }
    }

    // Otherwise, return to the parent
    incompleteWork = returnFiber;
    // Update the next thing we're working on in case something throws.
    workInProgress = incompleteWork;
  } while (incompleteWork !== null);

  // We've unwound all the way to the root.
  workInProgressRootExitStatus = RootSuspendedAtTheShell;
  workInProgress = null;
}

function completeRoot(
  root: FiberRoot,
  finishedWork: Fiber | null,
  lanes: Lanes,
  recoverableErrors: CapturedValue[] | null,
  transitions: Transition[] | null,
  didIncludeRenderPhaseUpdate: boolean,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
  _didSkipSuspendedSiblings: boolean,
  exitStatus: RootExitStatus,
  suspendedState: SuspendedState | null,
  suspendedCommitReason: SuspendedCommitReason, // Profiling-only
  completedRenderStartTime: number, // Profiling-only
  completedRenderEndTime: number, // Profiling-only
): void {
  root.cancelPendingCommit = null;

  do {
    // `flushPassiveEffects` will call `flushSyncUpdateQueue` at the end, which
    // means `flushPassiveEffects` will sometimes result in additional
    // passive effects. So we need to keep flushing in a loop until there are
    // no more pending effects.
    // TODO: Might be better if `flushPassiveEffects` did not automatically
    // flush synchronous work at the end, to avoid factoring hazards like this.
    flushPendingEffects();
  } while (pendingEffectsStatus !== NO_PENDING_EFFECTS);
  flushRenderPhaseStrictModeWarningsInDEV();

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.");
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // Log the previous render phase once we commit. I.e. we weren't interrupted.
    setCurrentTrackFromLanes(lanes);
    // enableGestureTransition is off: no gesture render to clamp.
    if (exitStatus === RootErrored) {
      logErroredRenderPhase(completedRenderStartTime, completedRenderEndTime, lanes, workInProgressUpdateTask);
    } else if (recoverableErrors !== null) {
      const hydrationFailed =
        finishedWork !== null &&
        finishedWork.alternate !== null &&
        (finishedWork.alternate.memoizedState as RootState).isDehydrated &&
        (finishedWork.flags & ForceClientRender) !== NoFlags;
      logRecoveredRenderPhase(
        completedRenderStartTime,
        completedRenderEndTime,
        lanes,
        recoverableErrors,
        hydrationFailed,
        workInProgressUpdateTask,
      );
    } else {
      logRenderPhase(completedRenderStartTime, completedRenderEndTime, lanes, workInProgressUpdateTask);
    }
  }

  if (enableSchedulingProfiler) {
    markCommitStarted(lanes);
  }

  if (finishedWork === null) {
    if (enableSchedulingProfiler) {
      markCommitStopped();
    }
    return;
  }
  if (isDevelopment) {
    if (lanes === NoLanes) {
      console.error("finishedLanes should not be empty during a commit. This is a " + "bug in React.");
    }
  }

  if (finishedWork === root.current) {
    throw new Error(
      "Cannot commit the same tree as before. This error is likely caused by " +
        "a bug in React. Please file an issue.",
    );
  }

  if (root === workInProgressRoot) {
    // We can reset these now that they are finished.
    workInProgressRoot = null;
    workInProgress = null;
    workInProgressRootRenderLanes = NoLanes;
  } else {
    // This indicates that the last root we worked on is not the same one that
    // we're committing now. This most commonly happens when a suspended root
    // times out.
  }

  // workInProgressX might be overwritten, so we want
  // to store it in pendingPassiveX until they get processed
  // We need to pass this through as an argument to completeRoot
  // because workInProgressX might have changed between
  // the previous render and commit if we throttle the commit
  // with setTimeout
  pendingFinishedWork = finishedWork;
  pendingEffectsRoot = root;
  pendingEffectsLanes = lanes;
  pendingPassiveTransitions = transitions;
  pendingRecoverableErrors = recoverableErrors;
  pendingDidIncludeRenderPhaseUpdate = didIncludeRenderPhaseUpdate;
  if (enableProfilerTimer) {
    pendingEffectsRenderEndTime = completedRenderEndTime;
    pendingSuspendedCommitReason = suspendedCommitReason;
    pendingDelayedCommitReason = IMMEDIATE_COMMIT;
    pendingSuspendedViewTransitionReason = null;
  }

  // enableGestureTransition is off: a gesture never holds the commit.

  // If we're not starting a gesture we now actually commit the root.
  commitRoot(
    root,
    finishedWork,
    lanes,
    spawnedLane,
    updatedLanes,
    suspendedRetryLanes,
    suspendedState,
    suspendedCommitReason,
    completedRenderEndTime,
  );
}

function commitRoot(
  root: FiberRoot,
  finishedWork: Fiber,
  lanes: Lanes,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
  // Upstream passes this to startViewTransition; see the note there.
  _suspendedState: SuspendedState | null,
  suspendedCommitReason: SuspendedCommitReason, // Profiling-only
  completedRenderEndTime: number, // Profiling-only
): void {
  // Check which lanes no longer have any work scheduled on them, and mark
  // those as finished.
  let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes);

  pendingEffectsRemainingLanes = remainingLanes;

  // Make sure to account for lanes that were updated by a concurrent event
  // during the render phase; don't mark them as finished.
  const concurrentlyUpdatedLanes = getConcurrentlyUpdatedLanes();
  remainingLanes = mergeLanes(remainingLanes, concurrentlyUpdatedLanes);

  // enableGestureTransition is off: GestureLane is never scheduled.

  markRootFinished(root, lanes, remainingLanes, spawnedLane, updatedLanes, suspendedRetryLanes);

  // Reset this before firing side effects so we can detect recursive updates.
  didIncludeCommitPhaseUpdate = false;

  // If there are pending passive effects, schedule a callback to process them.
  // Do this as early as possible, so it is queued before anything else that
  // might get scheduled in the commit phase. (See #16714.)
  // TODO: Delete all other places that schedule the passive effect callback
  // They're redundant.
  let passiveSubtreeMask: Flags;
  if (enableViewTransition) {
    pendingViewTransitionEvents = null;
    if (includesOnlyViewTransitionEligibleLanes(lanes)) {
      // Claim any pending Transition Types for this commit.
      pendingTransitionTypes = claimQueuedTransitionTypes(root);
      passiveSubtreeMask = PassiveTransitionMask;
    } else {
      pendingTransitionTypes = null;
      passiveSubtreeMask = PassiveMask;
    }
  } else {
    passiveSubtreeMask = PassiveMask;
  }
  if (
    // If this subtree rendered with profiling this commit, we need to visit it to log it.
    (enableProfilerTimer && enableComponentPerformanceTrack && finishedWork.actualDuration !== 0) ||
    (finishedWork.subtreeFlags & passiveSubtreeMask) !== NoFlags ||
    (finishedWork.flags & passiveSubtreeMask) !== NoFlags
  ) {
    if (enableYieldingBeforePassive) {
      // We don't schedule a separate task for flushing passive effects.
      // Instead, we just rely on ensureRootIsScheduled below to schedule
      // a callback for us to flush the passive effects.
    } else {
      // So we can clear these now to allow a new callback to be scheduled.
      root.callbackNode = null;
      root.callbackPriority = NoLane;
      scheduleCallback(NormalSchedulerPriority, () => {
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          // Track the currently executing event if there is one so we can ignore this
          // event when logging events.
          trackSchedulerEvent();
        }
        if (pendingDelayedCommitReason === IMMEDIATE_COMMIT) {
          pendingDelayedCommitReason = DELAYED_PASSIVE_COMMIT;
        }
        flushPassiveEffects();
        // This render triggered passive effects: release the root cache pool
        // *after* passive effects fire to avoid freeing a cache pool that may
        // be referenced by a node in the tree (HostRoot, Cache boundary etc)
        return null;
      });
    }
  } else {
    // If we don't have passive effects, we're not going to need to perform more work
    // so we can clear the callback now.
    root.callbackNode = null;
    root.callbackPriority = NoLane;
  }

  if (enableProfilerTimer) {
    // Mark the current commit time to be shared by all Profilers in this
    // batch. This enables them to be grouped later.
    resetCommitErrors();
    recordCommitTime();
    if (enableComponentPerformanceTrack) {
      if (suspendedCommitReason !== null) {
        logSuspendedCommitPhase(completedRenderEndTime, commitStartTime, suspendedCommitReason, workInProgressUpdateTask);
      }
    }
  }

  resetShouldStartViewTransition();

  // The commit phase is broken into several sub-phases. We do a separate pass
  // of the effect list for each phase: all mutation effects come before all
  // layout effects, and so on.

  // Check if there are any effects in the whole tree.
  // TODO: This is left over from the effect list implementation, where we had
  // to check for the existence of `firstEffect` to satisfy Flow. I think the
  // only other reason this optimization exists is because it affects profiling.
  // Reconsider whether this is necessary.
  const subtreeHasBeforeMutationEffects = (finishedWork.subtreeFlags & (BeforeMutationMask | MutationMask)) !== NoFlags;
  const rootHasBeforeMutationEffect = (finishedWork.flags & (BeforeMutationMask | MutationMask)) !== NoFlags;

  if (subtreeHasBeforeMutationEffects || rootHasBeforeMutationEffect) {
    const prevTransition = ReactSharedInternals.T;
    ReactSharedInternals.T = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    try {
      // The first phase a "before mutation" phase. We use this phase to read the
      // state of the host tree right before we mutate it. This is where
      // getSnapshotBeforeUpdate is called.
      commitBeforeMutationEffects(root, finishedWork, lanes);
    } finally {
      // Reset the priority to the previous non-sync value.
      executionContext = prevExecutionContext;
      setCurrentUpdatePriority(previousPriority);
      ReactSharedInternals.T = prevTransition;
    }
  }

  pendingEffectsStatus = PENDING_MUTATION_PHASE;
  if (enableViewTransition && shouldStartViewTransition) {
    if (enableProfilerTimer && enableComponentPerformanceTrack) {
      startAnimating(lanes);
    }
    // Upstream passes the suspended state first, which is the DOM host's
    // signature; this port's host config contract has upstream's other
    // renderers' signature, without it.
    pendingViewTransition = startViewTransition(
      root.containerInfo,
      pendingTransitionTypes,
      flushMutationEffects,
      flushLayoutEffects,
      flushAfterMutationEffects,
      flushSpawnedWork,
      flushPassiveEffects,
      reportViewTransitionError,
      suspendedViewTransition,
      // This callback fires after "pendingEffects" so we need to snapshot the arguments.
      () => finishedViewTransition(lanes),
    );
  } else {
    // Flush synchronously.
    flushMutationEffects();
    flushLayoutEffects();
    // Skip flushAfterMutationEffects
    flushSpawnedWork();
  }
}

function reportViewTransitionError(error: unknown): void {
  // Report errors that happens while preparing a View Transition.
  if (pendingEffectsStatus === NO_PENDING_EFFECTS) {
    return;
  }
  const root = pendingEffectsRoot;
  const onRecoverableError = root.onRecoverableError;
  onRecoverableError(error, makeErrorInfo(null));
}

function suspendedViewTransition(reason: string): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // We'll split the commit into two phases, because we're suspended in the middle.
    recordCommitEndTime();
    logCommitPhase(
      pendingSuspendedCommitReason === null ? pendingEffectsRenderEndTime : commitStartTime,
      commitEndTime,
      commitErrors,
      pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
      workInProgressUpdateTask, // TODO: Use a ViewTransition Task and this is not safe to read in this phase.
    );
    pendingSuspendedViewTransitionReason = reason;
    pendingSuspendedCommitReason = reason;
  }
}

function finishedViewTransition(lanes: Lanes): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if ((animatingLanes & lanes) === NoLanes) {
      // Was already stopped by some other action or maybe other root.
      return;
    }
    const task = animatingTask;
    stopAnimating(lanes);
    // If an affected track isn't in the middle of rendering or committing, log from the previous
    // finished render until the end of the animation.
    // enableGestureTransition is off: there is no gesture track.
    if (
      includesTransitionLane(lanes) &&
      !includesTransitionLane(workInProgressRootRenderLanes) &&
      !includesTransitionLane(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(SomeTransitionLane);
      logAnimatingPhase(transitionClampTime, now(), task);
    }
    if (
      includesRetryLane(lanes) &&
      !includesRetryLane(workInProgressRootRenderLanes) &&
      !includesRetryLane(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(SomeRetryLane);
      logAnimatingPhase(retryClampTime, now(), task);
    }
    if (
      includesIdleGroupLanes(lanes) &&
      !includesIdleGroupLanes(workInProgressRootRenderLanes) &&
      !includesIdleGroupLanes(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(IdleLane);
      logAnimatingPhase(idleClampTime, now(), task);
    }
  }
}

function flushAfterMutationEffects(): void {
  if (pendingEffectsStatus !== PENDING_AFTER_MUTATION_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;
  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;
  commitAfterMutationEffects(root, finishedWork, lanes);
  pendingEffectsStatus = PENDING_SPAWNED_WORK;
}

function flushMutationEffects(): void {
  if (pendingEffectsStatus !== PENDING_MUTATION_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;

  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;
  const subtreeMutationHasEffects = (finishedWork.subtreeFlags & MutationMask) !== NoFlags;
  const rootMutationHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

  if (subtreeMutationHasEffects || rootMutationHasEffect) {
    const prevTransition = ReactSharedInternals.T;
    ReactSharedInternals.T = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    try {
      // The next phase is the mutation phase, where we mutate the host tree.
      commitMutationEffects(root, finishedWork, lanes);

      if (enableCreateEventHandleAPI) {
        if (shouldFireAfterActiveInstanceBlur) {
          afterActiveInstanceBlur();
        }
      }
      resetAfterCommit(root.containerInfo);
    } finally {
      // Reset the priority to the previous non-sync value.
      executionContext = prevExecutionContext;
      setCurrentUpdatePriority(previousPriority);
      ReactSharedInternals.T = prevTransition;
    }
  }

  // The work-in-progress tree is now the current tree. This must come after
  // the mutation phase, so that the previous tree is still current during
  // componentWillUnmount, but before the layout phase, so that the finished
  // work is current during componentDidMount/Update.
  root.current = finishedWork;
  pendingEffectsStatus = PENDING_LAYOUT_PHASE;
}

function flushLayoutEffects(): void {
  if (pendingEffectsStatus !== PENDING_LAYOUT_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    const suspendedViewTransitionReason = pendingSuspendedViewTransitionReason;
    if (suspendedViewTransitionReason !== null) {
      // We suspended in the middle of the commit for the view transition.
      // We'll start a new commit track now.
      recordCommitTime();
      logSuspendedViewTransitionPhase(
        commitEndTime, // The start is the end of the first commit part.
        commitStartTime, // The end is the start of the second commit part.
        suspendedViewTransitionReason,
        animatingTask,
      );
    }
  }

  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;

  if (enableDefaultTransitionIndicator) {
    const cleanUpIndicator = root.pendingIndicator;
    if (cleanUpIndicator !== null && root.indicatorLanes === NoLanes) {
      // We have now committed all Transitions that needed the default indicator
      // so we can now run the clean up function. We do this in the layout phase
      // so it has the same semantics as if you did it with a useLayoutEffect or
      // if it was reset automatically with useOptimistic.
      const prevTransition = ReactSharedInternals.T;
      ReactSharedInternals.T = null;
      const previousPriority = getCurrentUpdatePriority();
      setCurrentUpdatePriority(DiscreteEventPriority);
      const prevExecutionContext = executionContext;
      executionContext |= CommitContext;
      root.pendingIndicator = null;
      try {
        cleanUpIndicator();
      } catch (x) {
        reportGlobalError(x);
      } finally {
        // Reset the priority to the previous non-sync value.
        executionContext = prevExecutionContext;
        setCurrentUpdatePriority(previousPriority);
        ReactSharedInternals.T = prevTransition;
      }
    }
  }

  const subtreeHasLayoutEffects = (finishedWork.subtreeFlags & LayoutMask) !== NoFlags;
  const rootHasLayoutEffect = (finishedWork.flags & LayoutMask) !== NoFlags;

  if (subtreeHasLayoutEffects || rootHasLayoutEffect) {
    const prevTransition = ReactSharedInternals.T;
    ReactSharedInternals.T = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    try {
      // The next phase is the layout phase, where we call effects that read
      // the host tree after it's been mutated. The idiomatic use case for this is
      // layout, but class component lifecycles also fire here for legacy reasons.
      if (enableSchedulingProfiler) {
        markLayoutEffectsStarted(lanes);
      }
      commitLayoutEffects(finishedWork, root, lanes);
      if (enableSchedulingProfiler) {
        markLayoutEffectsStopped();
      }
    } finally {
      // Reset the priority to the previous non-sync value.
      executionContext = prevExecutionContext;
      setCurrentUpdatePriority(previousPriority);
      ReactSharedInternals.T = prevTransition;
    }
  }

  const completedRenderEndTime = pendingEffectsRenderEndTime;
  const suspendedCommitReason = pendingSuspendedCommitReason;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    recordCommitEndTime();
    logCommitPhase(
      suspendedCommitReason === null ? completedRenderEndTime : commitStartTime,
      commitEndTime,
      commitErrors,
      pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
      workInProgressUpdateTask,
    );
  }

  pendingEffectsStatus = PENDING_AFTER_MUTATION_PHASE;
}

function flushSpawnedWork(): void {
  if (
    pendingEffectsStatus !== PENDING_SPAWNED_WORK &&
    // If a startViewTransition times out, we might flush this earlier than
    // after mutation phase. In that case, we just skip the after mutation phase.
    pendingEffectsStatus !== PENDING_AFTER_MUTATION_PHASE
  ) {
    return;
  }
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // If we didn't skip the after mutation phase, when is means we started an animation.
    const startedAnimation = pendingEffectsStatus === PENDING_SPAWNED_WORK;
    if (startedAnimation) {
      const startViewTransitionStartTime = commitEndTime;
      // Update the new commitEndTime to when we started the animation.
      recordCommitEndTime();
      logStartViewTransitionYieldPhase(
        startViewTransitionStartTime,
        commitEndTime,
        pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
        animatingTask,
      );
      if (pendingDelayedCommitReason !== ABORTED_VIEW_TRANSITION_COMMIT) {
        pendingDelayedCommitReason = ANIMATION_STARTED_COMMIT;
      }
    }
  }

  pendingEffectsStatus = NO_PENDING_EFFECTS;

  const committedViewTransition = pendingViewTransition;
  pendingViewTransition = null; // The view transition has now fully started.

  // Tell Scheduler to yield at the end of the frame, so the browser has an
  // opportunity to paint.
  requestPaint();

  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;
  const recoverableErrors = pendingRecoverableErrors;
  const didIncludeRenderPhaseUpdate = pendingDidIncludeRenderPhaseUpdate;

  const passiveSubtreeMask =
    enableViewTransition && includesOnlyViewTransitionEligibleLanes(lanes) ? PassiveTransitionMask : PassiveMask;
  const rootDidHavePassiveEffects = // If this subtree rendered with profiling this commit, we need to visit it to log it.
    (enableProfilerTimer && enableComponentPerformanceTrack && finishedWork.actualDuration !== 0) ||
    (finishedWork.subtreeFlags & passiveSubtreeMask) !== NoFlags ||
    (finishedWork.flags & passiveSubtreeMask) !== NoFlags;

  if (rootDidHavePassiveEffects) {
    pendingEffectsStatus = PENDING_PASSIVE_PHASE;
  } else {
    pendingEffectsStatus = NO_PENDING_EFFECTS;
    pendingEffectsRoot = null!; // Clear for GC purposes.
    pendingFinishedWork = null!; // Clear for GC purposes.
    // There were no passive effects, so we can immediately release the cache
    // pool for this render.
    releaseRootPooledCache(root, root.pendingLanes);
    if (isDevelopment) {
      nestedPassiveUpdateCount = 0;
      rootWithPassiveNestedUpdates = null;
    }
  }

  // Read this again, since an effect might have updated it
  let remainingLanes = root.pendingLanes;

  // Check if there's remaining work on this root
  // TODO: This is part of the `componentDidCatch` implementation. Its purpose
  // is to detect whether something might have called setState inside
  // `componentDidCatch`. The mechanism is known to be flawed because `setState`
  // inside `componentDidCatch` is itself flawed — that's why we recommend
  // `getDerivedStateFromError` instead. However, it could be improved by
  // checking if remainingLanes includes Sync work, instead of whether there's
  // any work remaining at all (which would also include stuff like Suspense
  // retries or transitions). It's been like this for a while, though, so fixing
  // it probably isn't that urgent.
  if (remainingLanes === NoLanes) {
    // If there's no remaining work, we can clear the set of already failed
    // error boundaries.
    legacyErrorBoundariesThatAlreadyFailed = null;
  }

  if (isDevelopment) {
    if (!rootDidHavePassiveEffects) {
      commitDoubleInvokeEffectsInDEV(root, false);
    }
  }

  const renderPriority = lanesToEventPriority(lanes);
  onCommitRootDevTools(finishedWork.stateNode as FiberRoot, renderPriority);

  if (enableUpdaterTracking) {
    if (isDevToolsPresent) {
      root.memoizedUpdaters.clear();
    }
  }

  if (isDevelopment) {
    onCommitRootTestSelector();
  }

  if (recoverableErrors !== null) {
    const prevTransition = ReactSharedInternals.T;
    const previousUpdateLanePriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    ReactSharedInternals.T = null;
    try {
      // There were errors during this render, but recovered from them without
      // needing to surface it to the UI. We log them here.
      const onRecoverableError = root.onRecoverableError;
      for (let i = 0; i < recoverableErrors.length; i++) {
        const recoverableError = recoverableErrors[i]!;
        const errorInfo = makeErrorInfo(recoverableError.stack);
        if (isDevelopment && recoverableError.source !== null) {
          runWithFiberInDEV(recoverableError.source, () => onRecoverableError(recoverableError.value, errorInfo));
        } else {
          onRecoverableError(recoverableError.value, errorInfo);
        }
      }
    } finally {
      ReactSharedInternals.T = prevTransition;
      setCurrentUpdatePriority(previousUpdateLanePriority);
    }
  }

  if (enableViewTransition) {
    // We should now be after the startViewTransition's .ready call which is late enough
    // to start animating any pseudo-elements. We do this before flushing any passive
    // effects or spawned sync work since this is still part of the previous commit.
    // Even though conceptually it's like its own task between layout effets and passive.
    const pendingEvents = pendingViewTransitionEvents;
    let pendingTypes = pendingTransitionTypes;
    pendingTransitionTypes = null;
    if (pendingEvents !== null) {
      pendingViewTransitionEvents = null;
      if (pendingTypes === null) {
        // Normalize the type. This is lazily created only for events.
        pendingTypes = [];
      }
      if (committedViewTransition !== null) {
        for (let i = 0; i < pendingEvents.length; i++) {
          const viewTransitionEvent = pendingEvents[i]!;
          const cleanup = viewTransitionEvent(pendingTypes);
          if (cleanup !== undefined) {
            addViewTransitionFinishedListener(committedViewTransition, cleanup);
          }
        }
      }
    }
  }

  // If the passive effects are the result of a discrete render, flush them
  // synchronously at the end of the current task so that the result is
  // immediately observable. Otherwise, we assume that they are not
  // order-dependent and do not need to be observed by external systems, so we
  // can wait until after paint.
  // TODO: We can optimize this by not scheduling the callback earlier. Since we
  // currently schedule the callback in multiple places, will wait until those
  // are consolidated.
  if (includesSyncLane(pendingEffectsLanes) && (disableLegacyMode || root.tag !== LegacyRoot)) {
    flushPendingEffects();
  }

  // Always call this before exiting `completeRoot`, to ensure that any
  // additional work on this root is scheduled.
  ensureRootIsScheduled(root);

  // Read this again, since a passive effect might have updated it
  remainingLanes = root.pendingLanes;

  // Check if this render scheduled a cascading synchronous update. This is a
  // heurstic to detect infinite update loops. We are intentionally excluding
  // hydration lanes in this check, because render triggered by selective
  // hydration is conceptually not an update.
  if (
    // Was the finished render the result of an update (not hydration)?
    includesSomeLane(lanes, UpdateLanes) &&
    // Did it schedule a sync update?
    includesSomeLane(remainingLanes, SyncUpdateLanes)
  ) {
    if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
      markNestedUpdateScheduled();
    }

    // Count the number of times the root synchronously re-renders without
    // finishing. If there are too many, it indicates an infinite update loop.
    if (root === rootWithNestedUpdates) {
      nestedUpdateCount++;
    } else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
    nestedUpdateKind = NESTED_UPDATE_SYNC_LANE;
  } else if (
    // Check if there was a recursive update spawned by this render, in either
    // the render phase or the commit phase. We track these explicitly because
    // we can't infer from the remaining lanes alone.
    enableInfiniteRenderLoopDetection &&
    (didIncludeRenderPhaseUpdate || didIncludeCommitPhaseUpdate)
  ) {
    if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
      markNestedUpdateScheduled();
    }

    // Count the number of times the root synchronously re-renders without
    // finishing. If there are too many, it indicates an infinite update loop.
    if (root === rootWithNestedUpdates) {
      nestedUpdateCount++;
    } else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
    nestedUpdateKind = NESTED_UPDATE_PHASE_SPAWN;
  } else {
    nestedUpdateCount = 0;
    rootWithNestedUpdates = null;
    nestedUpdateKind = NO_NESTED_UPDATE;
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (!rootDidHavePassiveEffects) {
      finalizeRender(lanes, commitEndTime);
    }
  }

  // Eagerly flush any event replaying that we unblocked within this commit.
  // This ensures that those are observed before we render any new changes.
  if (supportsHydration) {
    flushHydrationEvents();
  }

  // If layout work was scheduled, flush it now.
  flushSyncWorkOnAllRoots();

  if (enableSchedulingProfiler) {
    markCommitStopped();
  }

  if (enableTransitionTracing) {
    // We process transitions during passive effects. However, passive effects can be
    // processed synchronously during the commit phase as well as asynchronously after
    // paint. At the end of the commit phase, we schedule a callback that will be called
    // after the next paint. If the transitions have already been processed (passive
    // effect phase happened synchronously), we will schedule a callback to process
    // the transitions. However, if we don't have any pending transition callbacks, this
    // means that the transitions have yet to be processed (passive effects processed after paint)
    // so we will store the end time of paint so that we can process the transitions
    // and then call the callback via the correct end time.
    const prevRootTransitionCallbacks = root.transitionCallbacks;
    if (prevRootTransitionCallbacks !== null) {
      schedulePostPaintCallback((endTime: number) => {
        const prevPendingTransitionCallbacks = currentPendingTransitionCallbacks;
        if (prevPendingTransitionCallbacks !== null) {
          currentPendingTransitionCallbacks = null;
          scheduleCallback(IdleSchedulerPriority, () => {
            processTransitionCallbacks(prevPendingTransitionCallbacks, endTime, prevRootTransitionCallbacks);
            return null;
          });
        } else {
          currentEndTime = endTime;
        }
      });
    }
  }
}

// The errorInfo passed to onRecoverableError.
function makeErrorInfo(componentStack: string | null | undefined): { componentStack: string | null | undefined } {
  const errorInfo = {
    componentStack,
  };
  if (isDevelopment) {
    Object.defineProperty(errorInfo, "digest", {
      get() {
        console.error(
          'You are accessing "digest" from the errorInfo object passed to onRecoverableError.' +
            " This property is no longer provided as part of errorInfo but can be accessed as a property" +
            " of the Error instance itself.",
        );
      },
    });
  }
  return errorInfo;
}

function releaseRootPooledCache(root: FiberRoot, remainingLanes: Lanes): void {
  const pooledCacheLanes = (root.pooledCacheLanes &= remainingLanes);
  if (pooledCacheLanes === NoLanes) {
    // None of the remaining work relies on the cache pool. Clear it so
    // subsequent requests get a new cache
    const pooledCache = root.pooledCache;
    if (pooledCache != null) {
      root.pooledCache = null;
      releaseCache(pooledCache);
    }
  }
}

let didWarnAboutInterruptedViewTransitions = false;

export function flushPendingEffectsDelayed(): boolean {
  if (pendingDelayedCommitReason === IMMEDIATE_COMMIT) {
    pendingDelayedCommitReason = DELAYED_PASSIVE_COMMIT;
  }
  return flushPendingEffects();
}

export function flushPendingEffects(): boolean {
  // Returns whether passive effects were flushed.
  if (enableViewTransition && pendingViewTransition !== null) {
    // If we forced a flush before the View Transition full started then we skip it.
    // This ensures that we're not running a partial animation.
    stopViewTransition(pendingViewTransition);
    if (isDevelopment) {
      if (!didWarnAboutInterruptedViewTransitions) {
        didWarnAboutInterruptedViewTransitions = true;
        console.warn(
          "A flushSync update cancelled a View Transition because it was called " +
            "while the View Transition was still preparing. To preserve the synchronous " +
            "semantics, React had to skip the View Transition. If you can, try to avoid " +
            "flushSync() in a scenario that's likely to interfere.",
        );
      }
    }
    pendingViewTransition = null;
    pendingDelayedCommitReason = ABORTED_VIEW_TRANSITION_COMMIT;
  }
  // enableGestureTransition is off: there are no gesture mutations or
  // animations to flush first.
  flushMutationEffects();
  flushLayoutEffects();
  // Skip flushAfterMutation if we're forcing this early.
  flushSpawnedWork();
  return flushPassiveEffects();
}

function flushPassiveEffects(): boolean {
  if (pendingEffectsStatus !== PENDING_PASSIVE_PHASE) {
    return false;
  }
  // TODO: Merge flushPassiveEffectsImpl into this function. I believe they were only separate
  // in the first place because we used to wrap it with
  // `Scheduler.runWithPriority`, which accepts a function. But now we track the
  // priority within React itself, so we can mutate the variable directly.
  // Cache the root since pendingEffectsRoot is cleared in
  // flushPassiveEffectsImpl
  const root = pendingEffectsRoot;
  // Cache and clear the remaining lanes flag; it must be reset since this
  // method can be called from various places, not always from completeRoot
  // where the remaining lanes are known
  const remainingLanes = pendingEffectsRemainingLanes;
  pendingEffectsRemainingLanes = NoLanes;

  const renderPriority = lanesToEventPriority(pendingEffectsLanes);
  const priority = lowerEventPriority(DefaultEventPriority, renderPriority);
  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();

  try {
    setCurrentUpdatePriority(priority);
    ReactSharedInternals.T = null;
    return flushPassiveEffectsImpl();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;

    // Once passive effects have run for the tree - giving components a
    // chance to retain cache instances they use - release the pooled
    // cache at the root (if there is one)
    releaseRootPooledCache(root, remainingLanes);
  }
}

function flushPassiveEffectsImpl(): boolean {
  // Cache and clear the transitions flag
  const transitions = pendingPassiveTransitions;
  pendingPassiveTransitions = null;

  const root = pendingEffectsRoot;
  const lanes = pendingEffectsLanes;
  pendingEffectsStatus = NO_PENDING_EFFECTS;
  pendingEffectsRoot = null!; // Clear for GC purposes.
  pendingFinishedWork = null!; // Clear for GC purposes.
  // TODO: This is sometimes out of sync with pendingEffectsRoot.
  // Figure out why and fix it. It's not causing any known issues (probably
  // because it's only used for profiling), but it's a refactor hazard.
  pendingEffectsLanes = NoLanes;

  if (enableYieldingBeforePassive) {
    // We've finished our work for this render pass.
    root.callbackNode = null;
    root.callbackPriority = NoLane;
  }

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Cannot flush passive effects while already rendering.");
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // We're about to log a lot of profiling for this commit.
    // We set this once so we don't have to recompute it for every log.
    setCurrentTrackFromLanes(lanes);
  }

  if (isDevelopment) {
    isFlushingPassiveEffects = true;
    didScheduleUpdateDuringPassiveEffects = false;
  }

  let passiveEffectStartTime = 0;
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    resetCommitErrors();
    passiveEffectStartTime = now();
    if (pendingDelayedCommitReason === ANIMATION_STARTED_COMMIT) {
      // The animation was started, so we've been animating since that happened.
      logAnimatingPhase(commitEndTime, passiveEffectStartTime, animatingTask);
    } else {
      logPaintYieldPhase(
        commitEndTime,
        passiveEffectStartTime,
        pendingDelayedCommitReason === DELAYED_PASSIVE_COMMIT,
        workInProgressUpdateTask,
      );
    }
  }

  if (enableSchedulingProfiler) {
    markPassiveEffectsStarted(lanes);
  }

  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;

  commitPassiveUnmountEffects(root.current);
  commitPassiveMountEffects(root, root.current, lanes, transitions, pendingEffectsRenderEndTime);

  if (enableSchedulingProfiler) {
    markPassiveEffectsStopped();
  }

  if (isDevelopment) {
    commitDoubleInvokeEffectsInDEV(root, true);
  }

  executionContext = prevExecutionContext;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    const passiveEffectsEndTime = now();
    logPassiveCommitPhase(passiveEffectStartTime, passiveEffectsEndTime, commitErrors, workInProgressUpdateTask);
    finalizeRender(lanes, passiveEffectsEndTime);
  }

  flushSyncWorkOnAllRoots();

  if (enableTransitionTracing) {
    const prevPendingTransitionCallbacks = currentPendingTransitionCallbacks;
    const prevRootTransitionCallbacks = root.transitionCallbacks;
    const prevEndTime = currentEndTime;
    if (prevPendingTransitionCallbacks !== null && prevRootTransitionCallbacks !== null && prevEndTime !== null) {
      currentPendingTransitionCallbacks = null;
      currentEndTime = null;
      scheduleCallback(IdleSchedulerPriority, () => {
        processTransitionCallbacks(prevPendingTransitionCallbacks, prevEndTime, prevRootTransitionCallbacks);
        return null;
      });
    }
  }

  if (isDevelopment) {
    // If additional passive effects were scheduled, increment a counter. If this
    // exceeds the limit, we'll fire a warning.
    if (didScheduleUpdateDuringPassiveEffects) {
      if (root === rootWithPassiveNestedUpdates) {
        nestedPassiveUpdateCount++;
      } else {
        nestedPassiveUpdateCount = 0;
        rootWithPassiveNestedUpdates = root;
      }
    } else {
      nestedPassiveUpdateCount = 0;
    }
    isFlushingPassiveEffects = false;
    didScheduleUpdateDuringPassiveEffects = false;
  }

  if (enableYieldingBeforePassive) {
    // Next, we reschedule any remaining work in a new task since it's a new
    // sequence of work. We wait until the end to do this in case the passive
    // effect schedules higher priority work than we had remaining. That way
    // we don't schedule an early callback that gets cancelled anyway.
    ensureRootIsScheduled(root);
  }

  // TODO: Move to commitPassiveMountEffects
  onPostCommitRootDevTools(root);
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    const stateNode = root.current.stateNode as FiberRoot;
    stateNode.effectDuration = 0;
    stateNode.passiveEffectDuration = 0;
  }

  return true;
}

export function isAlreadyFailedLegacyErrorBoundary(instance: unknown): boolean {
  return legacyErrorBoundariesThatAlreadyFailed !== null && legacyErrorBoundariesThatAlreadyFailed.has(instance);
}

export function markLegacyErrorBoundaryAsFailed(instance: unknown): void {
  if (legacyErrorBoundariesThatAlreadyFailed === null) {
    legacyErrorBoundariesThatAlreadyFailed = new Set([instance]);
  } else {
    legacyErrorBoundariesThatAlreadyFailed.add(instance);
  }
}

function captureCommitPhaseErrorOnRoot(rootFiber: Fiber, sourceFiber: Fiber, error: unknown): void {
  const errorInfo = createCapturedValueAtFiber(error, sourceFiber);
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    recordEffectError(errorInfo);
  }
  const update = createRootErrorUpdate(rootFiber.stateNode as FiberRoot, errorInfo, SyncLane);
  const root = enqueueUpdate(rootFiber, update, SyncLane);
  if (root !== null) {
    markRootUpdated(root, SyncLane);
    ensureRootIsScheduled(root);
  }
}

// A class component that may be an error boundary.
interface ErrorBoundaryType {
  getDerivedStateFromError?: unknown;
}
interface ErrorBoundaryInstance {
  componentDidCatch?: unknown;
}

export function captureCommitPhaseError(sourceFiber: Fiber, nearestMountedAncestor: Fiber | null, error: unknown): void {
  if (isDevelopment) {
    setIsRunningInsertionEffect(false);
  }
  if (sourceFiber.tag === HostRoot) {
    // Error was thrown at the root. There is no parent, so the root
    // itself should capture it.
    captureCommitPhaseErrorOnRoot(sourceFiber, sourceFiber, error);
    return;
  }

  let fiber = nearestMountedAncestor;
  while (fiber !== null) {
    if (fiber.tag === HostRoot) {
      captureCommitPhaseErrorOnRoot(fiber, sourceFiber, error);
      return;
    } else if (fiber.tag === ClassComponent) {
      const ctor = fiber.type as ErrorBoundaryType;
      const instance = fiber.stateNode as ErrorBoundaryInstance;
      if (
        typeof ctor.getDerivedStateFromError === "function" ||
        (typeof instance.componentDidCatch === "function" && !isAlreadyFailedLegacyErrorBoundary(instance))
      ) {
        const errorInfo = createCapturedValueAtFiber(error, sourceFiber);
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          recordEffectError(errorInfo);
        }
        const update = createClassErrorUpdate(SyncLane);
        const root = enqueueUpdate(fiber, update, SyncLane);
        if (root !== null) {
          initializeClassErrorUpdate(update, root, fiber, errorInfo);
          markRootUpdated(root, SyncLane);
          ensureRootIsScheduled(root);
        }
        return;
      }
    }
    fiber = fiber.return;
  }

  if (isDevelopment) {
    console.error(
      "Internal React error: Attempted to capture a commit phase error " +
        "inside a detached tree. This indicates a bug in React. Potential " +
        "causes include deleting the same fiber more than once, committing an " +
        "already-finished tree, or an inconsistent return pointer.\n\n" +
        "Error message:\n\n%s",
      error,
    );
  }
}

export function attachPingListener(root: FiberRoot, wakeable: Wakeable, lanes: Lanes): void {
  // Attach a ping listener
  //
  // The data might resolve before we have a chance to commit the fallback. Or,
  // in the case of a refresh, we'll never commit a fallback. So we need to
  // attach a listener now. When it resolves ("pings"), we can decide whether to
  // try rendering the tree again.
  //
  // Only attach a listener if one does not already exist for the lanes
  // we're currently rendering (which acts like a "thread ID" here).
  //
  // We only need to do this in concurrent mode. Legacy Suspense always
  // commits fallbacks synchronously, so there are no pings.
  let pingCache = root.pingCache;
  let threadIDs: Set<unknown> | undefined;
  if (pingCache === null) {
    pingCache = root.pingCache = new Map<Wakeable, Set<unknown>>();
    threadIDs = new Set<unknown>();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set<unknown>();
      pingCache.set(wakeable, threadIDs);
    }
  }
  if (!threadIDs.has(lanes)) {
    workInProgressRootDidAttachPingListener = true;

    // Memoize using the thread ID to prevent redundant listeners.
    threadIDs.add(lanes);
    const ping = (): void => pingSuspendedRoot(root, wakeable, lanes);
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        // If we have pending work still, restore the original updaters
        restorePendingUpdaters(root, lanes);
      }
    }
    wakeable.then(ping, ping);
  }
}

function pingSuspendedRoot(root: FiberRoot, wakeable: Wakeable, pingedLanes: Lanes): void {
  const pingCache = root.pingCache;
  if (pingCache !== null) {
    // The wakeable resolved, so we no longer need to memoize, because it will
    // never be thrown again.
    pingCache.delete(wakeable);
  }

  markRootPinged(root, pingedLanes);

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    startPingTimerByLanes(pingedLanes);
  }

  warnIfSuspenseResolutionNotWrappedWithActDEV(root);

  if (workInProgressRoot === root && isSubsetOfLanes(workInProgressRootRenderLanes, pingedLanes)) {
    // Received a ping at the same priority level at which we're currently
    // rendering. We might want to restart this render. This should mirror
    // the logic of whether or not a root suspends once it completes.
    // TODO: If we're rendering sync either due to Sync, Batched or expired,
    // we should probably never restart.
    // TODO: Attach different listeners depending on whether the listener was
    // attached during prerendering. Prerender pings should not interrupt
    // normal renders.

    // If we're suspended with delay, or if it's a retry, we'll always suspend
    // so we can always restart.
    if (
      workInProgressRootExitStatus === RootSuspendedWithDelay ||
      (workInProgressRootExitStatus === RootSuspended &&
        includesOnlyRetries(workInProgressRootRenderLanes) &&
        now() - globalMostRecentFallbackTime < FALLBACK_THROTTLE_MS)
    ) {
      // Force a restart from the root by unwinding the stack. Unless this is
      // being called from the render phase, because that would cause a crash.
      if ((executionContext & RenderContext) === NoContext) {
        prepareFreshStack(root, NoLanes);
      } else {
        // TODO: If this does happen during the render phase, we should throw
        // the special internal exception that we use to interrupt the stack for
        // selective hydration. That was temporarily reverted but we once we add
        // it back we can use it here.
        //
        // In the meantime, record the pinged lanes so markRootSuspended won't
        // mark them as suspended, allowing a retry.
        workInProgressRootPingedLanes = mergeLanes(workInProgressRootPingedLanes, pingedLanes);
      }
    } else {
      // Even though we can't restart right now, we might get an
      // opportunity later. So we mark this render as having a ping.
      workInProgressRootPingedLanes = mergeLanes(workInProgressRootPingedLanes, pingedLanes);
    }

    // If something pings the work-in-progress render, any work that suspended
    // up to this point may now be unblocked; in other words, no
    // longer suspended.
    //
    // Unlike the broader check above, we only need do this if the lanes match
    // exactly. If the lanes don't exactly match, that implies the promise
    // was created by an older render.
    if (workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes) {
      workInProgressSuspendedRetryLanes = NoLanes;
    }
  }

  ensureRootIsScheduled(root);
}

// enableGestureTransition is off in the stable channel: no root ever has a
// pending gesture, so these never have work to do.
export function pingGestureRoot(_root: FiberRoot): void {}

export function restartGestureRoot(_root: FiberRoot): void {}

function retryTimedOutBoundary(boundaryFiber: Fiber, lane: Lane): void {
  // The boundary fiber (a Suspense component or SuspenseList component)
  // previously was rendered in its fallback state. One of the promises that
  // suspended it has resolved, which means at least part of the tree was
  // likely unblocked. Try rendering again, at a new lanes.
  let retryLane = lane;
  if (retryLane === NoLane) {
    // TODO: Assign this to `suspenseState.retryLane`? to avoid
    // unnecessary entanglement?
    retryLane = requestRetryLane(boundaryFiber);
  }
  // TODO: Special case idle priority?
  const root = enqueueConcurrentRenderForLane(boundaryFiber, retryLane);
  if (root !== null) {
    markRootUpdated(root, retryLane);
    ensureRootIsScheduled(root);
  }
}

export function retryDehydratedSuspenseBoundary(boundaryFiber: Fiber): void {
  const suspenseState = boundaryFiber.memoizedState as SuspenseState | null;
  let retryLane: Lane = NoLane;
  if (suspenseState !== null) {
    retryLane = suspenseState.retryLane;
  }
  retryTimedOutBoundary(boundaryFiber, retryLane);
}

export function resolveRetryWakeable(boundaryFiber: Fiber, wakeable: Wakeable): void {
  let retryLane: Lane = NoLane; // Default
  let retryCache: WeakSet<Wakeable> | Set<Wakeable> | null;
  switch (boundaryFiber.tag) {
    case ActivityComponent:
    case SuspenseComponent: {
      retryCache = boundaryFiber.stateNode as WeakSet<Wakeable> | Set<Wakeable> | null;
      const suspenseState = boundaryFiber.memoizedState as SuspenseState | ActivityState | null;
      if (suspenseState !== null) {
        retryLane = suspenseState.retryLane;
      }
      break;
    }
    case SuspenseListComponent:
      retryCache = boundaryFiber.stateNode as WeakSet<Wakeable> | Set<Wakeable> | null;
      break;
    case OffscreenComponent: {
      const instance = boundaryFiber.stateNode as OffscreenInstance;
      retryCache = instance._retryCache;
      break;
    }
    default:
      throw new Error("Pinged unknown suspense boundary type. " + "This is probably a bug in React.");
  }

  if (retryCache !== null) {
    // The wakeable resolved, so we no longer need to memoize, because it will
    // never be thrown again.
    retryCache.delete(wakeable);
  }

  retryTimedOutBoundary(boundaryFiber, retryLane);
}

function throwForcedInfiniteRenderLoopError(root: FiberRoot | null, renderLanes: Lanes): never {
  if (root !== null) {
    // Disable concurrent error recovery for the in-progress render so the thrown
    // error reaches the nearest error boundary and breaks the infinite update
    // loop instead of being silently retried by the recovery mechanism.
    root.errorRecoveryDisabledLanes = mergeLanes(root.errorRecoveryDisabledLanes, renderLanes);
  }
  throw new Error(
    "Maximum update depth exceeded. This could be an infinite loop. This can happen when a component " +
      "repeatedly calls setState during render phase or inside useLayoutEffect, " +
      "causing infinite render loop. React limits the number of nested updates to " +
      "prevent infinite loops.",
  );
}

export function throwIfInfiniteUpdateLoopDetected(isFromInfiniteRenderLoopDetectionInstrumentation: boolean): void {
  if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
    nestedUpdateCount = 0;
    nestedPassiveUpdateCount = 0;
    rootWithNestedUpdates = null;
    rootWithPassiveNestedUpdates = null;

    const updateKind = nestedUpdateKind;
    nestedUpdateKind = NO_NESTED_UPDATE;

    if (enableInfiniteRenderLoopDetection) {
      if (updateKind === NESTED_UPDATE_SYNC_LANE) {
        if (isFromInfiniteRenderLoopDetectionInstrumentation || (executionContext & RenderContext) !== NoContext) {
          // This loop was identified only because of the instrumentation gated with enableInfiniteRenderLoopDetection,
          // warn instead of throwing, unless enableInfiniteRenderLoopDetectionForceThrow.
          if (enableInfiniteRenderLoopDetectionForceThrow) {
            throwForcedInfiniteRenderLoopError(workInProgressRoot, workInProgressRootRenderLanes);
          } else if (isDevelopment) {
            console.error(
              "Maximum update depth exceeded. This could be an infinite loop. This can happen when a component " +
                "repeatedly calls setState during render phase or inside useLayoutEffect, " +
                "causing infinite render loop. React limits the number of nested updates to " +
                "prevent infinite loops.",
            );
          }
        } else {
          throw new Error(
            "Maximum update depth exceeded. This can happen when a component " +
              "repeatedly calls setState inside componentWillUpdate or " +
              "componentDidUpdate. React limits the number of nested updates to " +
              "prevent infinite loops.",
          );
        }
      } else if (updateKind === NESTED_UPDATE_PHASE_SPAWN) {
        if (enableInfiniteRenderLoopDetectionForceThrow) {
          throwForcedInfiniteRenderLoopError(workInProgressRoot, workInProgressRootRenderLanes);
        } else if (isDevelopment) {
          console.error(
            "Maximum update depth exceeded. This could be an infinite loop. This can happen when a component " +
              "repeatedly calls setState during render phase or inside useLayoutEffect, " +
              "causing infinite render loop. React limits the number of nested updates to " +
              "prevent infinite loops.",
          );
        }
      }
    } else {
      throw new Error(
        "Maximum update depth exceeded. This can happen when a component " +
          "repeatedly calls setState inside componentWillUpdate or " +
          "componentDidUpdate. React limits the number of nested updates to " +
          "prevent infinite loops.",
      );
    }
  }

  if (isDevelopment) {
    if (nestedPassiveUpdateCount > NESTED_PASSIVE_UPDATE_LIMIT) {
      nestedPassiveUpdateCount = 0;
      rootWithPassiveNestedUpdates = null;

      console.error(
        "Maximum update depth exceeded. This can happen when a component " +
          "calls setState inside useEffect, but useEffect either doesn't " +
          "have a dependency array, or one of the dependencies changes on " +
          "every render.",
      );
    }
  }
}

function flushRenderPhaseStrictModeWarningsInDEV(): void {
  if (isDevelopment) {
    ReactStrictModeWarnings.flushLegacyContextWarning();
    ReactStrictModeWarnings.flushPendingUnsafeLifecycleWarnings();
  }
}

function recursivelyTraverseAndDoubleInvokeEffectsInDEV(
  root: FiberRoot,
  parentFiber: Fiber,
  isInStrictMode: boolean,
): void {
  if ((parentFiber.subtreeFlags & (PlacementDEV | Visibility)) === NoFlags) {
    // Parent's descendants have already had effects double invoked.
    // Early exit to avoid unnecessary tree traversal.
    return;
  }
  let child = parentFiber.child;
  while (child !== null) {
    doubleInvokeEffectsInDEVIfNecessary(root, child, isInStrictMode);
    child = child.sibling;
  }
}

// Unconditionally disconnects and connects passive and layout effects.
function doubleInvokeEffectsOnFiber(root: FiberRoot, fiber: Fiber): void {
  setIsStrictModeForDevtools(true);
  try {
    disappearLayoutEffectsForDEVValidation(fiber);
    disconnectPassiveEffect(fiber);
    reappearLayoutEffectsForDEVValidation(root, fiber.alternate, fiber);
    reconnectPassiveEffects(root, fiber, NoLanes, null, false, 0);
  } finally {
    setIsStrictModeForDevtools(false);
  }
}

function doubleInvokeEffectsInDEVIfNecessary(root: FiberRoot, fiber: Fiber, parentIsInStrictMode: boolean): void {
  const isStrictModeFiber = fiber.type === REACT_STRICT_MODE_TYPE;
  const isInStrictMode = parentIsInStrictMode || isStrictModeFiber;

  // First case: the fiber **is not** of type OffscreenComponent. No
  // special rules apply to double invoking effects.
  if (fiber.tag !== OffscreenComponent) {
    if (fiber.flags & PlacementDEV) {
      if (isInStrictMode) {
        runWithFiberInDEV(fiber, () => doubleInvokeEffectsOnFiber(root, fiber));
      }
    } else {
      recursivelyTraverseAndDoubleInvokeEffectsInDEV(root, fiber, isInStrictMode);
    }
    return;
  }

  // Second case: the fiber **is** of type OffscreenComponent.
  // This branch contains cases specific to Offscreen.
  if (fiber.memoizedState === null) {
    // Only consider Offscreen that is visible.
    // TODO (Offscreen) Handle manual mode.
    if (isInStrictMode && fiber.flags & (Visibility | PlacementDEV)) {
      // Double invoke effects on Offscreen's subtree
      // if it is visible and its visibility has changed.
      // However, we also need to consider newly hydrated Offscreen because their
      // visibility flags might not have changed.
      runWithFiberInDEV(fiber, () => doubleInvokeEffectsOnFiber(root, fiber));
    } else if (fiber.subtreeFlags & PlacementDEV) {
      // Something in the subtree could have been suspended.
      // We need to continue traversal and find newly inserted fibers.
      runWithFiberInDEV(fiber, () => recursivelyTraverseAndDoubleInvokeEffectsInDEV(root, fiber, isInStrictMode));
    }
  }
}

function commitDoubleInvokeEffectsInDEV(root: FiberRoot, hasPassiveEffects: boolean): void {
  if (isDevelopment) {
    if (disableLegacyMode || root.tag !== LegacyRoot) {
      let doubleInvokeEffects = true;

      if (
        (disableLegacyMode || root.tag === ConcurrentRoot) &&
        !(root.current.mode & (StrictLegacyMode | StrictEffectsMode))
      ) {
        doubleInvokeEffects = false;
      }
      recursivelyTraverseAndDoubleInvokeEffectsInDEV(root, root.current, doubleInvokeEffects);
    } else {
      // TODO: Is this runWithFiberInDEV needed since the other effect functions do it too?
      runWithFiberInDEV(root.current, () => legacyCommitDoubleInvokeEffectsInDEV(root.current, hasPassiveEffects));
    }
  }
}

function legacyCommitDoubleInvokeEffectsInDEV(fiber: Fiber, hasPassiveEffects: boolean): void {
  // TODO (StrictEffects) Should we set a marker on the root if it contains strict effects
  // so we don't traverse unnecessarily? similar to subtreeFlags but just at the root level.
  // Maybe not a big deal since this is DEV only behavior.

  invokeEffectsInDev(fiber, MountLayoutDev, invokeLayoutEffectUnmountInDEV);
  if (hasPassiveEffects) {
    invokeEffectsInDev(fiber, MountPassiveDev, invokePassiveEffectUnmountInDEV);
  }

  invokeEffectsInDev(fiber, MountLayoutDev, invokeLayoutEffectMountInDEV);
  if (hasPassiveEffects) {
    invokeEffectsInDev(fiber, MountPassiveDev, invokePassiveEffectMountInDEV);
  }
}

function invokeEffectsInDev(firstChild: Fiber, fiberFlags: Flags, invokeEffectFn: (fiber: Fiber) => void): void {
  let current: Fiber | null = firstChild;
  let subtreeRoot: Fiber | null = null;
  while (current != null) {
    const primarySubtreeFlag = current.subtreeFlags & fiberFlags;
    if (current !== subtreeRoot && current.child != null && primarySubtreeFlag !== NoFlags) {
      current = current.child;
    } else {
      if ((current.flags & fiberFlags) !== NoFlags) {
        invokeEffectFn(current);
      }

      if (current.sibling !== null) {
        current = current.sibling;
      } else {
        current = subtreeRoot = current.return;
      }
    }
  }
}

let didWarnStateUpdateForNotYetMountedComponent: Set<string> | null = null;
export function warnAboutUpdateOnNotYetMountedFiberInDEV(fiber: Fiber): void {
  if (isDevelopment) {
    if ((executionContext & RenderContext) !== NoContext) {
      // We let the other warning about render phase updates deal with this one.
      return;
    }

    if (!disableLegacyMode && !(fiber.mode & ConcurrentMode)) {
      return;
    }

    const tag = fiber.tag;
    if (
      tag !== HostRoot &&
      tag !== ClassComponent &&
      tag !== FunctionComponent &&
      tag !== ForwardRef &&
      tag !== MemoComponent &&
      tag !== SimpleMemoComponent
    ) {
      // Only warn for user-defined components, not internal ones like Suspense.
      return;
    }

    // We show the whole stack but dedupe on the top component's name because
    // the problematic code almost always lies inside that component.
    const componentName = getComponentNameFromFiber(fiber) || "ReactComponent";
    if (didWarnStateUpdateForNotYetMountedComponent !== null) {
      if (didWarnStateUpdateForNotYetMountedComponent.has(componentName)) {
        return;
      }
      didWarnStateUpdateForNotYetMountedComponent.add(componentName);
    } else {
      didWarnStateUpdateForNotYetMountedComponent = new Set([componentName]);
    }

    runWithFiberInDEV(fiber, () => {
      console.error(
        "Can't perform a React state update on a component that hasn't mounted yet. " +
          "This indicates that you have a side-effect in your render function that " +
          "asynchronously tries to update the component. Move this work to " +
          "useEffect instead.",
      );
    });
  }
}

let didWarnAboutUpdateInRender = false;
const didWarnAboutUpdateInRenderForAnotherComponent = new Set<string>();

function warnAboutRenderPhaseUpdatesInDEV(fiber: Fiber): void {
  if (isDevelopment) {
    if (ReactCurrentDebugFiberIsRenderingInDEV) {
      switch (fiber.tag) {
        case FunctionComponent:
        case ForwardRef:
        case SimpleMemoComponent: {
          const renderingComponentName = (workInProgress && getComponentNameFromFiber(workInProgress)) || "Unknown";
          // Dedupe by the rendering component because it's the one that needs to be fixed.
          const dedupeKey = renderingComponentName;
          if (!didWarnAboutUpdateInRenderForAnotherComponent.has(dedupeKey)) {
            didWarnAboutUpdateInRenderForAnotherComponent.add(dedupeKey);
            const setStateComponentName = getComponentNameFromFiber(fiber) || "Unknown";
            console.error(
              "Cannot update a component (`%s`) while rendering a " +
                "different component (`%s`). To locate the bad setState() call inside `%s`, " +
                "follow the stack trace as described in https://react.dev/link/setstate-in-render",
              setStateComponentName,
              renderingComponentName,
              renderingComponentName,
            );
          }
          break;
        }
        case ClassComponent: {
          if (!didWarnAboutUpdateInRender) {
            console.error(
              "Cannot update during an existing state transition (such as " +
                "within `render`). Render methods should be a pure " +
                "function of props and state.",
            );
            didWarnAboutUpdateInRender = true;
          }
          break;
        }
      }
    }
  }
}

export function restorePendingUpdaters(root: FiberRoot, lanes: Lanes): void {
  if (enableUpdaterTracking) {
    if (isDevToolsPresent) {
      const memoizedUpdaters = root.memoizedUpdaters;
      memoizedUpdaters.forEach((schedulingFiber) => {
        addFiberToLanesMap(root, schedulingFiber, lanes);
      });

      // This function intentionally does not clear memoized updaters.
      // Those may still be relevant to the current commit
      // and a future one (e.g. Suspense).
    }
  }
}

type SchedulerTask = (didTimeout: boolean) => SchedulerTask | null | undefined;
type SchedulerPriority = Parameters<typeof Scheduler_scheduleCallback>[0];

// The callback node returned while inside `act`: the task went to the `act`
// queue, not the scheduler.
const fakeActCallbackNode = {};
function scheduleCallback(priorityLevel: SchedulerPriority, callback: SchedulerTask): unknown {
  if (isDevelopment) {
    // If we're currently inside an `act` scope, bypass Scheduler and push to
    // the `act` queue instead.
    const actQueue = ReactSharedInternals.actQueue;
    if (actQueue !== null) {
      actQueue.push(callback);
      return fakeActCallbackNode;
    }
    return Scheduler_scheduleCallback(priorityLevel, callback);
  }
  // In production, always call Scheduler. This function will be stripped out.
  return Scheduler_scheduleCallback(priorityLevel, callback);
}

function shouldForceFlushFallbacksInDEV(): boolean {
  // Never force flush in production. This function should get stripped out.
  return isDevelopment && ReactSharedInternals.actQueue !== null;
}

function warnIfUpdatesNotWrappedWithActDEV(fiber: Fiber): void {
  if (isDevelopment) {
    if (disableLegacyMode || fiber.mode & ConcurrentMode) {
      if (!isConcurrentActEnvironment()) {
        // Not in an act environment. No need to warn.
        return;
      }
    } else {
      // Legacy mode has additional cases where we suppress a warning.
      if (!isLegacyActEnvironment(fiber)) {
        // Not in an act environment. No need to warn.
        return;
      }
      if (executionContext !== NoContext) {
        // Legacy mode doesn't warn if the update is batched, i.e.
        // batchedUpdates or flushSync.
        return;
      }
      if (fiber.tag !== FunctionComponent && fiber.tag !== ForwardRef && fiber.tag !== SimpleMemoComponent) {
        // For backwards compatibility with pre-hooks code, legacy mode only
        // warns for updates that originate from a hook.
        return;
      }
    }

    if (ReactSharedInternals.actQueue === null) {
      runWithFiberInDEV(fiber, () => {
        console.error(
          "An update to %s inside a test was not wrapped in act(...).\n\n" +
            "When testing, code that causes React state updates should be " +
            "wrapped into act(...):\n\n" +
            "act(() => {\n" +
            "  /* fire events that update state */\n" +
            "});\n" +
            "/* assert on the output */\n\n" +
            "This ensures that you're testing the behavior the user would see " +
            "in the browser." +
            " Learn more at https://react.dev/link/wrap-tests-with-act",
          getComponentNameFromFiber(fiber),
        );
      });
    }
  }
}

function warnIfSuspenseResolutionNotWrappedWithActDEV(root: FiberRoot): void {
  if (isDevelopment) {
    if (
      (disableLegacyMode || root.tag !== LegacyRoot) &&
      isConcurrentActEnvironment() &&
      ReactSharedInternals.actQueue === null
    ) {
      console.error(
        "A suspended resource finished loading inside a test, but the event " +
          "was not wrapped in act(...).\n\n" +
          "When testing, code that resolves suspended data should be wrapped " +
          "into act(...):\n\n" +
          "act(() => {\n" +
          "  /* finish loading suspended data */\n" +
          "});\n" +
          "/* assert on the output */\n\n" +
          "This ensures that you're testing the behavior the user would see " +
          "in the browser." +
          " Learn more at https://react.dev/link/wrap-tests-with-act",
      );
    }
  }
}

export function setIsRunningInsertionEffect(isRunning: boolean): void {
  if (isDevelopment) {
    isRunningInsertionEffect = isRunning;
  }
}

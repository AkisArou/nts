// Upstream's feature flags, resolved for the stable release channel:
// `__EXPERIMENTAL__` is false, and `__PROFILE__` (profiling builds) is the
// development build, as upstream builds it. Ported code keeps upstream's
// `if (enableX)` shape so that each file stays diffable against upstream at
// the next pin; the constants fold away at build time.
//
// Leave each flag's type literal (`= false`, never `: boolean = false`).
// esbuild folds on the value, but nts folds a branch on its condition's
// *type*: a widened flag compiles every branch it gates into the native
// build, refusals and all.

import { isProfiling } from "shared/Build.ts";

const __EXPERIMENTAL__ = false;
const __PROFILE__ = isProfiling;

export const enableBrowserAPI = true;
export const disableSchedulerTimeoutInWorkLoop = false;
export const enableSuspenseCallback = false;
export const enableScopeAPI = false;
export const enableCreateEventHandleAPI = false;
export const enableLegacyFBSupport = false;
export const enableYieldingBeforePassive = false;
export const enableThrottledScheduling = false;
export const enableLegacyCache = __EXPERIMENTAL__;
export const enableAsyncIterableChildren = __EXPERIMENTAL__;
export const enableFlightWeakThenables = __EXPERIMENTAL__;
export const enableTaint = __EXPERIMENTAL__;
export const enableViewTransition = true;
export const enableViewTransitionParentEnterExit = __EXPERIMENTAL__;
export const enableViewTransitionForPersistenceMode = false;
export const enableGestureTransition = __EXPERIMENTAL__;
export const enableScrollEndPolyfill = __EXPERIMENTAL__;
export const enableSuspenseyImages = false;
export const enableFizzBlockingRender = __EXPERIMENTAL__; // rel="expect"

export const enableSrcObject = __EXPERIMENTAL__;
export const enableHydrationChangeEvent = __EXPERIMENTAL__;
export const enableDefaultTransitionIndicator = __EXPERIMENTAL__;
export const enableOptimisticKey = __EXPERIMENTAL__;
export const enableObjectFiber = false;
export const enableTransitionTracing = false;
export const enableLegacyHidden = false;
export const enableSuspenseAvoidThisFallback = false;
export const enableCPUSuspense = __EXPERIMENTAL__;
export const enableNoCloningMemoCache = false;
export const enableFizzExternalRuntime = __EXPERIMENTAL__;
export const alwaysThrottleRetries = true;
export const enableEffectEventMutationPhase = true;
export const passChildrenWhenCloningPersistedNodes = false;
export const enableRetryLaneExpiration = false;
export const retryLaneExpirationMs = 5000;
export const syncLaneExpirationMs = 250;
export const transitionLaneExpirationMs = 5000;
export const enableInfiniteRenderLoopDetection = false;
export const enableInfiniteRenderLoopDetectionForceThrow = false;
export const enableConditionalUseWarning = true;
export const enableFragmentRefs = true;
export const enableFragmentRefsScrollIntoView = true;
export const enableFragmentRefsInstanceHandles = true;
export const enableFragmentRefsTextNodes = true;
export const enableInternalInstanceMap = false;
export const disableLegacyContext = true;
export const disableLegacyContextForFunctionComponents = true;
export const enableMoveBefore = false;
export const disableClientCache = true;
export const enableReactTestRendererWarning = true;
export const disableLegacyMode = true;
export const disableCommentsAsDOMContainers = true;
export const enableTrustedTypesIntegration = true;
export const disableInputAttributeSyncing = false;
export const disableTextareaChildren = false;
export const enableParallelTransitions = true;
export const enableProfilerTimer = __PROFILE__;
export const enableComponentPerformanceTrack = true;
export const enablePerformanceIssueReporting = false;
export const enableSchedulingProfiler =
  !enableComponentPerformanceTrack && __PROFILE__;
export const enableProfilerCommitHooks = __PROFILE__;
export const enableProfilerNestedUpdatePhase = __PROFILE__;
export const enableAsyncDebugInfo = true;
export const enableUpdaterTracking = __PROFILE__;
export const ownerStackLimit = 1e4;
export const eprh_enableUseKeyedStateCompilerLint = false;
export const eprh_enableVerboseNoSetStateInEffectCompilerLint = false;
export const eprh_enableExhaustiveEffectDependenciesCompilerLint:
  | "off"
  | "all"
  | "extra-only"
  | "missing-only" = "off";

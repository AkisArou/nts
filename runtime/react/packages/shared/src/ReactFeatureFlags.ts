// Upstream's feature flags, resolved for the stable release channel:
// `__EXPERIMENTAL__` is false, and `__PROFILE__` (profiling builds) is the
// development build, as upstream builds it. Ported code keeps upstream's
// `if (enableX)` shape so that each file stays diffable against upstream at
// the next pin; the constants fold away at build time.

import { isProfiling } from "./Build.ts";

const __EXPERIMENTAL__ = false;
const __PROFILE__ = isProfiling;

export const enableBrowserAPI: boolean = true;
export const disableSchedulerTimeoutInWorkLoop: boolean = false;
export const enableSuspenseCallback: boolean = false;
export const enableScopeAPI: boolean = false;
export const enableCreateEventHandleAPI: boolean = false;
export const enableLegacyFBSupport: boolean = false;
export const enableYieldingBeforePassive: boolean = false;
export const enableThrottledScheduling: boolean = false;
export const enableLegacyCache = __EXPERIMENTAL__;
export const enableAsyncIterableChildren = __EXPERIMENTAL__;
export const enableFlightWeakThenables = __EXPERIMENTAL__;
export const enableTaint = __EXPERIMENTAL__;
export const enableViewTransition: boolean = true;
export const enableViewTransitionParentEnterExit = __EXPERIMENTAL__;
export const enableViewTransitionForPersistenceMode: boolean = false;
export const enableGestureTransition = __EXPERIMENTAL__;
export const enableScrollEndPolyfill = __EXPERIMENTAL__;
export const enableSuspenseyImages: boolean = false;
export const enableFizzBlockingRender = __EXPERIMENTAL__; // rel="expect"

export const enableSrcObject = __EXPERIMENTAL__;
export const enableHydrationChangeEvent = __EXPERIMENTAL__;
export const enableDefaultTransitionIndicator = __EXPERIMENTAL__;
export const enableOptimisticKey = __EXPERIMENTAL__;
export const enableObjectFiber: boolean = false;
export const enableTransitionTracing: boolean = false;
export const enableLegacyHidden: boolean = false;
export const enableSuspenseAvoidThisFallback: boolean = false;
export const enableCPUSuspense = __EXPERIMENTAL__;
export const enableNoCloningMemoCache: boolean = false;
export const enableFizzExternalRuntime = __EXPERIMENTAL__;
export const alwaysThrottleRetries: boolean = true;
export const enableEffectEventMutationPhase: boolean = true;
export const passChildrenWhenCloningPersistedNodes: boolean = false;
export const enableRetryLaneExpiration: boolean = false;
export const retryLaneExpirationMs = 5000;
export const syncLaneExpirationMs = 250;
export const transitionLaneExpirationMs = 5000;
export const enableInfiniteRenderLoopDetection: boolean = false;
export const enableInfiniteRenderLoopDetectionForceThrow: boolean = false;
export const enableConditionalUseWarning: boolean = true;
export const enableFragmentRefs: boolean = true;
export const enableFragmentRefsScrollIntoView: boolean = true;
export const enableFragmentRefsInstanceHandles: boolean = true;
export const enableFragmentRefsTextNodes: boolean = true;
export const enableInternalInstanceMap: boolean = false;
export const disableLegacyContext: boolean = true;
export const disableLegacyContextForFunctionComponents: boolean = true;
export const enableMoveBefore: boolean = false;
export const disableClientCache: boolean = true;
export const enableReactTestRendererWarning: boolean = true;
export const disableLegacyMode: boolean = true;
export const disableCommentsAsDOMContainers: boolean = true;
export const enableTrustedTypesIntegration: boolean = true;
export const disableInputAttributeSyncing: boolean = false;
export const disableTextareaChildren: boolean = false;
export const enableParallelTransitions: boolean = true;
export const enableProfilerTimer = __PROFILE__;
export const enableComponentPerformanceTrack: boolean = true;
export const enablePerformanceIssueReporting: boolean = false;
export const enableSchedulingProfiler: boolean =
  !enableComponentPerformanceTrack && __PROFILE__;
export const enableProfilerCommitHooks = __PROFILE__;
export const enableProfilerNestedUpdatePhase = __PROFILE__;
export const enableAsyncDebugInfo: boolean = true;
export const enableUpdaterTracking = __PROFILE__;
export const ownerStackLimit = 1e4;
export const eprh_enableUseKeyedStateCompilerLint: boolean = false;
export const eprh_enableVerboseNoSetStateInEffectCompilerLint: boolean = false;
export const eprh_enableExhaustiveEffectDependenciesCompilerLint:
  | "off"
  | "all"
  | "extra-only"
  | "missing-only" = "off";

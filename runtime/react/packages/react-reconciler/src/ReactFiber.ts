// Fibers: creating them from elements, and the double-buffered
// work-in-progress copies the render phase writes to.

import { isDevelopment } from "shared/Build.ts";
import { getComponentNameFromType } from "shared/getComponentNameFromType.ts";
import {
  disableLegacyMode,
  enableLegacyHidden,
  enableProfilerTimer,
  enableScopeAPI,
  enableSuspenseyImages,
  enableTransitionTracing,
  enableViewTransition,
} from "shared/ReactFeatureFlags.ts";
import {
  REACT_ACTIVITY_TYPE,
  REACT_CONSUMER_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_ELEMENT_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_LAZY_TYPE,
  REACT_LEGACY_HIDDEN_TYPE,
  REACT_MEMO_TYPE,
  REACT_PROFILER_TYPE,
  REACT_SCOPE_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_TRACING_MARKER_TYPE,
  REACT_VIEW_TRANSITION_TYPE,
} from "shared/ReactSymbols.ts";
import type { Props, ReactElement, ReactKey, ReactPortal, ReactDebugInfo } from "shared/ReactTypes.ts";
import type { Dependencies, Fiber, HookType, Ref } from "./ReactInternalTypes.ts";
import type { RootTag } from "./ReactRootTags.ts";
import type { WorkTag } from "./ReactWorkTags.ts";
import type { TypeOfMode } from "./ReactTypeOfMode.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import type { ActivityInstance, SuspenseInstance } from "react-reconciler/ReactFiberConfig.ts";
import type { LegacyHiddenProps, OffscreenProps } from "./ReactFiberOffscreenComponent.ts";
import type { ViewTransitionState } from "./ReactFiberViewTransitionComponent.ts";
import type { TracingMarkerInstance } from "./ReactFiberTracingMarkerComponent.ts";
import { isHostHoistableType, isHostSingletonType, supportsResources, supportsSingletons } from "react-reconciler/ReactFiberConfig.ts";
import { NoFlags, Placement, StaticMask } from "./ReactFiberFlags.ts";
import type { Flags } from "./ReactFiberFlags.ts";
import { ConcurrentRoot } from "./ReactRootTags.ts";
import {
  ActivityComponent,
  ClassComponent,
  ContextConsumer,
  ContextProvider,
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
  LazyComponent,
  LegacyHiddenComponent,
  MemoComponent,
  Mode,
  OffscreenComponent,
  Profiler,
  SimpleMemoComponent,
  SuspenseComponent,
  SuspenseListComponent,
  Throw,
  TracingMarkerComponent,
  ViewTransitionComponent,
} from "./ReactWorkTags.ts";
import { getComponentNameFromOwner } from "./getComponentNameFromFiber.ts";
import { isDevToolsPresent } from "react-reconciler/ReactFiberDevToolsPresence.ts";
import { resolveTypeForHotReloading } from "./ReactFiberHotReloading.ts";
import { NoLanes } from "./ReactFiberLane.ts";
import {
  ConcurrentMode,
  NoMode,
  ProfileMode,
  StrictEffectsMode,
  StrictLegacyMode,
  SuspenseyImagesMode,
} from "./ReactTypeOfMode.ts";
import { TransitionTracingMarker } from "./ReactFiberTracingMarkerComponent.ts";
import { getHostContext } from "./ReactFiberHostContext.ts";

export type { Fiber };

let hasBadMapPolyfill = false;

if (isDevelopment) {
  try {
    const nonExtensibleObject = Object.preventExtensions({});
    new Map([[nonExtensibleObject, null]]);
    new Set([nonExtensibleObject]);
  } catch {
    // TODO: Consider warning about bad polyfills
    hasBadMapPolyfill = true;
  }
}

// Please ensure we do the following:
// 1) Nobody should add any instance methods on this. Instance methods can be
//    more difficult to predict when they get optimized and they are almost
//    never inlined properly in static compilers.
// 2) Nobody should rely on `instanceof Fiber` for type testing. We should
//    always know when it is a fiber.
// 3) It should be easy to port this to a C struct and keep a C implementation
//    compatible.
export class FiberNode {
  // Instance
  tag: WorkTag;
  key: ReactKey;
  elementType: unknown = null;
  type: unknown = null;
  stateNode: unknown = null;

  // Fiber
  return: Fiber | null = null;
  child: Fiber | null = null;
  sibling: Fiber | null = null;
  index = 0;

  ref: Ref = null;
  refCleanup: (() => void) | null = null;

  pendingProps: unknown;
  memoizedProps: unknown = null;
  updateQueue: unknown = null;
  memoizedState: unknown = null;
  dependencies: Dependencies | null = null;

  mode: TypeOfMode;

  // Effects
  flags: Flags = NoFlags;
  subtreeFlags: Flags = NoFlags;
  deletions: Fiber[] | null = null;

  lanes: Lanes = NoLanes;
  childLanes: Lanes = NoLanes;

  alternate: Fiber | null = null;

  // Initialized with doubles rather than small integers, as upstream does,
  // so that later double values do not change the object's shape in V8
  // (https://github.com/facebook/react/issues/14365).
  actualDuration = -0;
  actualStartTime = -1.1;
  selfBaseDuration = -0;
  treeBaseDuration = -0;

  // Development only. Not directly used but handy for debugging internals.
  _debugInfo: ReactDebugInfo | null = null;
  _debugOwner: Fiber | null = null;
  _debugStack: unknown = null;
  _debugTask: unknown = null;
  _debugNeedsRemount = false;
  _debugHookTypes: HookType[] | null = null;

  constructor(tag: WorkTag, pendingProps: unknown, key: ReactKey, mode: TypeOfMode) {
    this.tag = tag;
    this.key = key;
    this.pendingProps = pendingProps;
    this.mode = mode;
    if (isDevelopment) {
      if (!hasBadMapPolyfill && typeof Object.preventExtensions === "function") {
        Object.preventExtensions(this);
      }
    }
  }
}

function createFiber(tag: WorkTag, pendingProps: unknown, key: ReactKey, mode: TypeOfMode): Fiber {
  return new FiberNode(tag, pendingProps, key, mode);
}

// Class components are recognised by `isReactComponent` on the prototype.
// JS object model: reading a function's prototype is the only marker the
// public contract gives us (create-react-class and old classes rely on it).
function shouldConstruct(Component: unknown): boolean {
  const prototype = (Component as { prototype?: { isReactComponent?: unknown } }).prototype;
  return !!(prototype && prototype.isReactComponent);
}

export function isSimpleFunctionComponent(type: unknown): boolean {
  return (
    typeof type === "function" &&
    !shouldConstruct(type) &&
    (type as { defaultProps?: unknown }).defaultProps === undefined
  );
}

export function isFunctionClassComponent(type: unknown): boolean {
  return shouldConstruct(type);
}

function cloneDependencies(currentDependencies: Dependencies | null): Dependencies | null {
  if (currentDependencies === null) {
    return null;
  }
  return isDevelopment
    ? {
        lanes: currentDependencies.lanes,
        firstContext: currentDependencies.firstContext,
        _debugThenableState: currentDependencies._debugThenableState ?? null,
      }
    : {
        lanes: currentDependencies.lanes,
        firstContext: currentDependencies.firstContext,
      };
}

// This is used to create an alternate fiber to do work on.
export function createWorkInProgress(current: Fiber, pendingProps: unknown): Fiber {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    // We use a double buffering pooling technique because we know that we'll
    // only ever need at most two versions of a tree. We pool the "other" unused
    // node that we're free to reuse. This is lazily created to avoid allocating
    // extra objects for things that are never updated. It also allow us to
    // reclaim the extra memory if needed.
    workInProgress = createFiber(current.tag, pendingProps, current.key, current.mode);
    workInProgress.elementType = current.elementType;
    workInProgress.type = current.type;
    workInProgress.stateNode = current.stateNode;

    if (isDevelopment) {
      // DEV-only fields
      workInProgress._debugOwner = current._debugOwner;
      workInProgress._debugStack = current._debugStack;
      workInProgress._debugTask = current._debugTask;
      workInProgress._debugHookTypes = current._debugHookTypes;
    }

    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    workInProgress.pendingProps = pendingProps;
    // Needed because Blocks store data on type.
    workInProgress.type = current.type;

    // We already have an alternate.
    // Reset the effect tag.
    workInProgress.flags = NoFlags;

    // The effects are no longer valid.
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;

    if (enableProfilerTimer) {
      // We intentionally reset, rather than copy, actualDuration & actualStartTime.
      // This prevents time from endlessly accumulating in new commits.
      // This has the downside of resetting values for different priority renders,
      // But works for yielding (the common case) and should support resuming.
      workInProgress.actualDuration = -0;
      workInProgress.actualStartTime = -1.1;
    }
  }

  // Reset all effects except static ones.
  // Static effects are not specific to a render.
  workInProgress.flags = current.flags & StaticMask;
  workInProgress.childLanes = current.childLanes;
  workInProgress.lanes = current.lanes;

  workInProgress.child = current.child;
  workInProgress.memoizedProps = current.memoizedProps;
  workInProgress.memoizedState = current.memoizedState;
  workInProgress.updateQueue = current.updateQueue;

  // Clone the dependencies object. This is mutated during the render phase, so
  // it cannot be shared with the current fiber.
  workInProgress.dependencies = cloneDependencies(current.dependencies);

  // These will be overridden during the parent's reconciliation
  workInProgress.sibling = current.sibling;
  workInProgress.index = current.index;
  workInProgress.ref = current.ref;
  workInProgress.refCleanup = current.refCleanup;

  if (enableProfilerTimer) {
    workInProgress.selfBaseDuration = current.selfBaseDuration;
    workInProgress.treeBaseDuration = current.treeBaseDuration;
  }

  if (isDevelopment) {
    workInProgress._debugInfo = current._debugInfo;
    workInProgress._debugNeedsRemount = current._debugNeedsRemount;
    switch (workInProgress.tag) {
      case FunctionComponent:
      case SimpleMemoComponent:
      case MemoComponent:
      case ClassComponent:
      case ForwardRef:
        workInProgress.type = resolveTypeForHotReloading(current.type);
        break;
      default:
        break;
    }
  }

  return workInProgress;
}

// Used to reuse a Fiber for a second pass.
export function resetWorkInProgress(workInProgress: Fiber, renderLanes: Lanes): Fiber {
  // This resets the Fiber to what createFiber or createWorkInProgress would
  // have set the values to before during the first pass. Ideally this wouldn't
  // be necessary but unfortunately many code paths reads from the workInProgress
  // when they should be reading from current and writing to workInProgress.

  // We assume pendingProps, index, key, ref, return are still untouched to
  // avoid doing another reconciliation.

  // Reset the effect flags but keep any Placement tags, since that's something
  // that child fiber is setting, not the reconciliation.
  workInProgress.flags &= StaticMask | Placement;

  // The effects are no longer valid.

  const current = workInProgress.alternate;
  if (current === null) {
    // Reset to createFiber's initial values.
    workInProgress.childLanes = NoLanes;
    workInProgress.lanes = renderLanes;

    workInProgress.child = null;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.memoizedProps = null;
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;

    workInProgress.dependencies = null;

    workInProgress.stateNode = null;

    if (enableProfilerTimer) {
      // Note: We don't reset the actualTime counts. It's useful to accumulate
      // actual time across multiple render passes.
      workInProgress.selfBaseDuration = 0;
      workInProgress.treeBaseDuration = 0;
    }
  } else {
    // Reset to the cloned values that createWorkInProgress would've.
    workInProgress.childLanes = current.childLanes;
    workInProgress.lanes = current.lanes;

    workInProgress.child = current.child;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;
    workInProgress.memoizedProps = current.memoizedProps;
    workInProgress.memoizedState = current.memoizedState;
    workInProgress.updateQueue = current.updateQueue;
    // Needed because Blocks store data on type.
    // TODO: Blocks don't exist anymore. Do we still need this?
    workInProgress.type = current.type;

    // Clone the dependencies object. This is mutated during the render phase, so
    // it cannot be shared with the current fiber.
    workInProgress.dependencies = cloneDependencies(current.dependencies);

    if (enableProfilerTimer) {
      // Note: We don't reset the actualTime counts. It's useful to accumulate
      // actual time across multiple render passes.
      workInProgress.selfBaseDuration = current.selfBaseDuration;
      workInProgress.treeBaseDuration = current.treeBaseDuration;
    }
  }

  return workInProgress;
}

export function createHostRootFiber(tag: RootTag, isStrictMode: boolean): Fiber {
  let mode: number;
  if (disableLegacyMode || tag === ConcurrentRoot) {
    mode = ConcurrentMode;
    if (isStrictMode === true) {
      mode |= StrictLegacyMode | StrictEffectsMode;
    }
  } else {
    mode = NoMode;
  }

  if (isDevelopment || (enableProfilerTimer && isDevToolsPresent)) {
    // dev: Enable profiling instrumentation by default.
    // profile: enabled if DevTools is present or subtree is wrapped in <Profiler>.
    // production: disabled.
    mode |= ProfileMode;
  }

  return createFiber(HostRoot, null, null, mode);
}

function propsOf(pendingProps: unknown): Props {
  return pendingProps as Props;
}

// TODO: Get rid of this helper. Only createFiberFromElement should exist.
export function createFiberFromTypeAndProps(
  type: unknown, // React$ElementType
  key: ReactKey,
  pendingProps: unknown,
  owner: Fiber | null,
  initialMode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  let mode = initialMode;
  let fiberTag: WorkTag = FunctionComponent;
  // The resolved type is set if we know what the final type will be. I.e. it's not lazy.
  let resolvedType = type;
  if (isDevelopment) {
    resolvedType = resolveTypeForHotReloading(type);
  }
  if (typeof resolvedType === "function") {
    if (shouldConstruct(resolvedType)) {
      fiberTag = ClassComponent;
    }
  } else if (typeof resolvedType === "string") {
    const hostType = resolvedType;
    if (supportsResources && supportsSingletons) {
      const hostContext = getHostContext();
      fiberTag = isHostHoistableType(hostType, propsOf(pendingProps), hostContext)
        ? HostHoistable
        : isHostSingletonType(hostType)
          ? HostSingleton
          : HostComponent;
    } else if (supportsResources) {
      const hostContext = getHostContext();
      fiberTag = isHostHoistableType(hostType, propsOf(pendingProps), hostContext) ? HostHoistable : HostComponent;
    } else if (supportsSingletons) {
      fiberTag = isHostSingletonType(hostType) ? HostSingleton : HostComponent;
    } else {
      fiberTag = HostComponent;
    }
  } else if (
    (resolvedType === REACT_LEGACY_HIDDEN_TYPE ||
      resolvedType === REACT_VIEW_TRANSITION_TYPE ||
      resolvedType === REACT_SCOPE_TYPE ||
      resolvedType === REACT_TRACING_MARKER_TYPE) &&
    specialFiberFor(resolvedType) !== null
  ) {
    return specialFiberFor(resolvedType)!(pendingProps, mode, lanes, key);
  } else {
    getTag: switch (resolvedType) {
      case REACT_ACTIVITY_TYPE:
        return createFiberFromActivity(pendingProps, mode, lanes, key);
      case REACT_FRAGMENT_TYPE:
        return createFiberFromFragment(propsOf(pendingProps)["children"], mode, lanes, key);
      case REACT_STRICT_MODE_TYPE:
        fiberTag = Mode;
        mode |= StrictLegacyMode;
        if (disableLegacyMode || (mode & ConcurrentMode) !== NoMode) {
          // Strict effects should never run on legacy roots
          mode |= StrictEffectsMode;
        }
        break;
      case REACT_PROFILER_TYPE:
        return createFiberFromProfiler(pendingProps, mode, lanes, key);
      case REACT_SUSPENSE_TYPE:
        return createFiberFromSuspense(pendingProps, mode, lanes, key);
      case REACT_SUSPENSE_LIST_TYPE:
        return createFiberFromSuspenseList(pendingProps, mode, lanes, key);
      default: {
        if (typeof resolvedType === "object" && resolvedType !== null) {
          switch ((resolvedType as { $$typeof?: unknown }).$$typeof) {
            case REACT_CONTEXT_TYPE:
              fiberTag = ContextProvider;
              break getTag;
            case REACT_CONSUMER_TYPE:
              fiberTag = ContextConsumer;
              break getTag;
            case REACT_FORWARD_REF_TYPE:
              fiberTag = ForwardRef;
              break getTag;
            case REACT_MEMO_TYPE:
              fiberTag = MemoComponent;
              break getTag;
            case REACT_LAZY_TYPE:
              fiberTag = LazyComponent;
              resolvedType = null;
              break getTag;
          }
        }
        let info = "";
        let typeString: string;
        if (isDevelopment) {
          if (
            type === undefined ||
            (typeof type === "object" && type !== null && Object.keys(type).length === 0)
          ) {
            info +=
              " You likely forgot to export your component from the file " +
              "it's defined in, or you might have mixed up default and named imports.";
          }

          if (type === null) {
            typeString = "null";
          } else if (Array.isArray(type)) {
            typeString = "array";
          } else if (type !== undefined && (type as { $$typeof?: unknown }).$$typeof === REACT_ELEMENT_TYPE) {
            typeString = `<${getComponentNameFromType((type as ReactElement).type) || "Unknown"} />`;
            info = " Did you accidentally export a JSX literal instead of a component?";
          } else {
            typeString = typeof type;
          }

          const ownerName = owner ? getComponentNameFromOwner(owner) : null;
          if (ownerName) {
            info += "\n\nCheck the render method of `" + ownerName + "`.";
          }
        } else {
          typeString = type === null ? "null" : typeof type;
        }

        // The type is invalid but it's conceptually a child that errored and not the
        // current component itself so we create a virtual child that throws in its
        // begin phase. This is the same thing we do in ReactChildFiber if we throw
        // but we do it here so that we can assign the debug owner and stack from the
        // element itself. That way the error stack will point to the JSX callsite.
        fiberTag = Throw;
        pendingProps = new Error(
          "Element type is invalid: expected a string (for built-in " +
            "components) or a class/function (for composite components) " +
            `but got: ${typeString}.${info}`,
        );
        resolvedType = null;
      }
    }
  }

  const fiber = createFiber(fiberTag, pendingProps, key, mode);
  fiber.elementType = type;
  fiber.type = resolvedType;
  fiber.lanes = lanes;

  if (isDevelopment) {
    fiber._debugOwner = owner;
  }

  return fiber;
}

type SpecialFiberFactory = (pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: ReactKey) => Fiber;

// Upstream's switch falls through these cases in order, each taken only when
// its feature flag is on: with legacy hidden off, a LegacyHidden element
// becomes a ViewTransition. enableScopeAPI is off in the stable channel, so a
// scope reaches the tracing marker case and then the invalid-type error.
function specialFiberFor(type: unknown): SpecialFiberFactory | null {
  if (type === REACT_LEGACY_HIDDEN_TYPE && enableLegacyHidden) {
    return (pendingProps, mode, lanes, key) =>
      createFiberFromLegacyHidden(pendingProps as LegacyHiddenProps, mode, lanes, key);
  }
  if ((type === REACT_LEGACY_HIDDEN_TYPE || type === REACT_VIEW_TRANSITION_TYPE) && enableViewTransition) {
    return createFiberFromViewTransition;
  }
  if (enableScopeAPI && type === REACT_SCOPE_TYPE) {
    throw new Error("The Scope API is not enabled in this build of React.");
  }
  if (enableTransitionTracing) {
    return createFiberFromTracingMarker;
  }
  return null;
}

export function createFiberFromElement(element: ReactElement, mode: TypeOfMode, lanes: Lanes): Fiber {
  let owner: Fiber | null = null;
  if (isDevelopment) {
    owner = (element._owner as Fiber | null | undefined) ?? null;
  }
  const type = element.type;
  const key = element.key;
  const pendingProps = element.props;
  const fiber = createFiberFromTypeAndProps(type, key, pendingProps, owner, mode, lanes);
  if (isDevelopment) {
    fiber._debugOwner = (element._owner as Fiber | null | undefined) ?? null;
    fiber._debugStack = element._debugStack;
    fiber._debugTask = element._debugTask;
  }
  return fiber;
}

export function createFiberFromFragment(elements: unknown, mode: TypeOfMode, lanes: Lanes, key: ReactKey): Fiber {
  const fiber = createFiber(Fragment, elements, key, mode);
  fiber.lanes = lanes;
  return fiber;
}

function createFiberFromProfiler(pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: ReactKey): Fiber {
  if (isDevelopment) {
    const id = propsOf(pendingProps)["id"];
    if (typeof id !== "string") {
      console.error(
        'Profiler must specify an "id" of type `string` as a prop. Received the type `%s` instead.',
        typeof id,
      );
    }
  }

  const fiber = createFiber(Profiler, pendingProps, key, mode | ProfileMode);
  fiber.elementType = REACT_PROFILER_TYPE;
  fiber.lanes = lanes;

  if (enableProfilerTimer) {
    fiber.stateNode = {
      effectDuration: 0,
      passiveEffectDuration: 0,
    };
  }

  return fiber;
}

export function createFiberFromSuspense(pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: ReactKey): Fiber {
  const fiber = createFiber(SuspenseComponent, pendingProps, key, mode);
  fiber.elementType = REACT_SUSPENSE_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

export function createFiberFromSuspenseList(
  pendingProps: unknown,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(SuspenseListComponent, pendingProps, key, mode);
  fiber.elementType = REACT_SUSPENSE_LIST_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

export function createFiberFromOffscreen(
  pendingProps: OffscreenProps,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(OffscreenComponent, pendingProps, key, mode);
  fiber.lanes = lanes;
  return fiber;
}

export function createFiberFromActivity(pendingProps: unknown, mode: TypeOfMode, lanes: Lanes, key: ReactKey): Fiber {
  const fiber = createFiber(ActivityComponent, pendingProps, key, mode);
  fiber.elementType = REACT_ACTIVITY_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

export function createFiberFromViewTransition(
  pendingProps: unknown,
  initialMode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  let mode = initialMode;
  if (!enableSuspenseyImages) {
    // Render a ViewTransition component opts into SuspenseyImages mode even
    // when the flag is off.
    mode |= SuspenseyImagesMode;
  }
  const fiber = createFiber(ViewTransitionComponent, pendingProps, key, mode);
  fiber.elementType = REACT_VIEW_TRANSITION_TYPE;
  fiber.lanes = lanes;
  const instance: ViewTransitionState = {
    autoName: null,
    paired: null,
    clones: null,
    ref: null,
  };
  fiber.stateNode = instance;
  return fiber;
}

export function createFiberFromLegacyHidden(
  pendingProps: LegacyHiddenProps,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(LegacyHiddenComponent, pendingProps, key, mode);
  fiber.elementType = REACT_LEGACY_HIDDEN_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

export function createFiberFromTracingMarker(
  pendingProps: unknown,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(TracingMarkerComponent, pendingProps, key, mode);
  fiber.elementType = REACT_TRACING_MARKER_TYPE;
  fiber.lanes = lanes;
  const tracingMarkerInstance: TracingMarkerInstance = {
    tag: TransitionTracingMarker,
    transitions: null,
    pendingBoundaries: null,
    aborts: null,
    name: propsOf(pendingProps)["name"] as string,
  };
  fiber.stateNode = tracingMarkerInstance;
  return fiber;
}

export function createFiberFromText(content: string, mode: TypeOfMode, lanes: Lanes): Fiber {
  const fiber = createFiber(HostText, content, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

export function createFiberFromDehydratedFragment(dehydratedNode: SuspenseInstance | ActivityInstance): Fiber {
  const fiber = createFiber(DehydratedFragment, null, null, NoMode);
  fiber.stateNode = dehydratedNode;
  return fiber;
}

// A portal fiber's `stateNode`.
export interface PortalStateNode {
  containerInfo: unknown;
  // Used by persistent updates.
  pendingChildren: unknown;
  implementation: unknown;
}

export function createFiberFromPortal(portal: ReactPortal, mode: TypeOfMode, lanes: Lanes): Fiber {
  const pendingProps = portal.children !== null ? portal.children : [];
  const fiber = createFiber(HostPortal, pendingProps, portal.key, mode);
  fiber.lanes = lanes;
  const stateNode: PortalStateNode = {
    containerInfo: portal.containerInfo,
    pendingChildren: null, // Used by persistent updates
    implementation: portal.implementation,
  };
  fiber.stateNode = stateNode;
  return fiber;
}

export function createFiberFromThrow(error: unknown, mode: TypeOfMode, lanes: Lanes): Fiber {
  const fiber = createFiber(Throw, error, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

// Hydration: adopting host instances a server rendered instead of creating
// new ones. Every entry point checks `supportsHydration`, so a renderer that
// cannot hydrate never reaches a host hydration call.

import { hydratableInstanceOf } from "./ReactFiberStateNode.ts";
import { isDevelopment } from "shared/Build.ts";
import type { CapturedValue } from "react-reconciler/ReactCapturedValue.ts";
import { createCapturedValueAtFiber } from "react-reconciler/ReactCapturedValue.ts";
import { runWithFiberInDEV } from "./ReactCurrentFiber.ts";
import { createFiberFromDehydratedFragment } from "./ReactFiber.ts";
import type { ActivityState } from "./ReactFiberActivityComponent.ts";
import type {
  ActivityInstance,
  Container,
  HostContext,
  HydratableInstance,
  Instance,
  Props,
  SuspenseInstance,
  TextInstance,
  Type,
} from "react-reconciler/ReactFiberConfig.ts";
import {
  canHydrateActivityInstance,
  canHydrateFormStateMarker,
  canHydrateInstance,
  canHydrateSuspenseInstance,
  canHydrateTextInstance,
  describeHydratableInstanceForDevWarnings,
  diffHydratedPropsForDevWarnings,
  diffHydratedTextForDevWarnings,
  getFirstHydratableChild,
  getFirstHydratableChildWithinActivityInstance,
  getFirstHydratableChildWithinContainer,
  getFirstHydratableChildWithinSingleton,
  getFirstHydratableChildWithinSuspenseInstance,
  getNextHydratableInstanceAfterActivityInstance,
  getNextHydratableInstanceAfterSuspenseInstance,
  getNextHydratableSibling,
  getNextHydratableSiblingAfterSingleton,
  hydrateActivityInstance,
  hydrateInstance,
  hydrateSuspenseInstance,
  hydrateTextInstance,
  isFormStateMarkerMatching,
  resolveSingletonInstance,
  shouldDeleteUnhydratedTailInstances,
  shouldSetTextContent,
  supportsHydration,
  supportsSingletons,
  validateHydratableInstance,
  validateHydratableTextInstance,
} from "react-reconciler/ReactFiberConfig.ts";
import { getHostContext, getRootHostContainer } from "./ReactFiberHostContext.ts";
import type { HydrationDiffNode } from "./ReactFiberHydrationDiffs.ts";
import { describeDiff } from "./ReactFiberHydrationDiffs.ts";
import { OffscreenLane } from "./ReactFiberLane.ts";
import type { SuspenseState } from "./ReactFiberSuspenseComponent.ts";
import type { TreeContext } from "./ReactFiberTreeContext.ts";
import { getSuspendedTreeContext, restoreSuspendedTreeContext } from "./ReactFiberTreeContext.ts";
import { queueRecoverableErrors } from "./ReactFiberWorkLoop.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { ActivityComponent, HostComponent, HostRoot, HostSingleton, SuspenseComponent } from "./ReactWorkTags.ts";

type ServerProps = HydrationDiffNode["serverProps"];
type ServerTailEntry = HydrationDiffNode["serverTail"][number];

// The deepest Fiber on the stack involved in a hydration context.
// This may have been an insertion or a hydration.
let hydrationParentFiber: Fiber | null = null;
let nextHydratableInstance: HydratableInstance | null = null;
let isHydrating = false;

// This flag allows for warning supression when we expect there to be mismatches
// due to earlier mismatches or a suspended fiber.
let didSuspendOrErrorDEV = false;

// Hydration differences found that haven't yet been logged.
let hydrationDiffRootDEV: HydrationDiffNode | null = null;

// Hydration errors that were thrown inside this boundary
let hydrationErrors: CapturedValue<unknown>[] | null = null;

let rootOrSingletonContext = false;

// Builds a common ancestor tree from the root down for collecting diffs.
function buildHydrationDiffNode(fiber: Fiber, distanceFromLeaf: number): HydrationDiffNode {
  if (fiber.return === null) {
    // We're at the root.
    if (hydrationDiffRootDEV === null) {
      hydrationDiffRootDEV = {
        fiber,
        children: [],
        serverProps: undefined,
        serverTail: [],
        distanceFromLeaf,
      };
    } else if (hydrationDiffRootDEV.fiber !== fiber) {
      throw new Error("Saw multiple hydration diff roots in a pass. This is a bug in React.");
    } else if (hydrationDiffRootDEV.distanceFromLeaf > distanceFromLeaf) {
      hydrationDiffRootDEV.distanceFromLeaf = distanceFromLeaf;
    }
    return hydrationDiffRootDEV;
  }
  const siblings = buildHydrationDiffNode(fiber.return, distanceFromLeaf + 1).children;
  // The same node may already exist in the parent. Since we currently always render depth first
  // and rerender if we suspend or terminate early, if a shared ancestor was added we should still
  // be inside of that shared ancestor which means it was the last one to be added. If this changes
  // we may have to scan the whole set.
  const last = siblings.length > 0 ? siblings[siblings.length - 1]! : null;
  if (last !== null && last.fiber === fiber) {
    if (last.distanceFromLeaf > distanceFromLeaf) {
      last.distanceFromLeaf = distanceFromLeaf;
    }
    return last;
  }
  const newNode: HydrationDiffNode = {
    fiber,
    children: [],
    serverProps: undefined,
    serverTail: [],
    distanceFromLeaf,
  };
  siblings.push(newNode);
  return newNode;
}

function warnIfHydrating(): void {
  if (isDevelopment) {
    if (isHydrating) {
      console.error("We should not be hydrating here. This is a bug in React. Please file a bug.");
    }
  }
}

export function markDidThrowWhileHydratingDEV(): void {
  if (isDevelopment) {
    didSuspendOrErrorDEV = true;
  }
}

function enterHydrationState(fiber: Fiber): boolean {
  if (!supportsHydration) {
    return false;
  }
  const parentInstance: Container = (fiber.stateNode as { containerInfo: Container }).containerInfo;
  nextHydratableInstance = getFirstHydratableChildWithinContainer(parentInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  hydrationErrors = null;
  didSuspendOrErrorDEV = false;
  hydrationDiffRootDEV = null;
  rootOrSingletonContext = true;
  return true;
}

function reenterHydrationStateFromDehydratedActivityInstance(
  fiber: Fiber,
  activityInstance: ActivityInstance,
  treeContext: TreeContext | null,
): boolean {
  if (!supportsHydration) {
    return false;
  }
  nextHydratableInstance = getFirstHydratableChildWithinActivityInstance(activityInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  hydrationErrors = null;
  didSuspendOrErrorDEV = false;
  hydrationDiffRootDEV = null;
  rootOrSingletonContext = false;
  if (treeContext !== null) {
    restoreSuspendedTreeContext(fiber, treeContext);
  }
  return true;
}

function reenterHydrationStateFromDehydratedSuspenseInstance(
  fiber: Fiber,
  suspenseInstance: SuspenseInstance,
  treeContext: TreeContext | null,
): boolean {
  if (!supportsHydration) {
    return false;
  }
  nextHydratableInstance = getFirstHydratableChildWithinSuspenseInstance(suspenseInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  hydrationErrors = null;
  didSuspendOrErrorDEV = false;
  hydrationDiffRootDEV = null;
  rootOrSingletonContext = false;
  if (treeContext !== null) {
    restoreSuspendedTreeContext(fiber, treeContext);
  }
  return true;
}

function warnNonHydratedInstance(fiber: Fiber, rejectedCandidate: HydratableInstance | null): void {
  if (isDevelopment) {
    if (didSuspendOrErrorDEV) {
      // Inside a boundary that already suspended. We're currently rendering the
      // siblings of a suspended node. The mismatch may be due to the missing
      // data, so it's probably a false positive.
      return;
    }
    // Add this fiber to the diff tree.
    const diffNode = buildHydrationDiffNode(fiber, 0);
    // We use null as a signal that there was no node to match.
    diffNode.serverProps = null;
    if (rejectedCandidate !== null) {
      const description = describeHydratableInstanceForDevWarnings(rejectedCandidate) as ServerTailEntry;
      diffNode.serverTail.push(description);
    }
  }
}

function tryHydrateInstance(fiber: Fiber, nextInstance: HydratableInstance, hostContext: HostContext): boolean {
  // fiber is a HostComponent Fiber
  const instance = canHydrateInstance(nextInstance, fiber.type as Type, fiber.pendingProps as Props, rootOrSingletonContext);
  if (instance !== null) {
    fiber.stateNode = instance;
    if (isDevelopment) {
      if (!didSuspendOrErrorDEV) {
        const differences = diffHydratedPropsForDevWarnings(instance, fiber.type as Type, fiber.pendingProps as Props, hostContext);
        if (differences !== null) {
          const diffNode = buildHydrationDiffNode(fiber, 0);
          diffNode.serverProps = differences as ServerProps;
        }
      }
    }
    hydrationParentFiber = fiber;
    nextHydratableInstance = getFirstHydratableChild(instance);
    rootOrSingletonContext = false;
    return true;
  }
  return false;
}

function tryHydrateText(fiber: Fiber, nextInstance: HydratableInstance): boolean {
  // fiber is a HostText Fiber
  const text = fiber.pendingProps as string;
  const textInstance = canHydrateTextInstance(nextInstance, text, rootOrSingletonContext);
  if (textInstance !== null) {
    fiber.stateNode = textInstance;
    hydrationParentFiber = fiber;
    // Text Instances don't have children so there's nothing to hydrate.
    nextHydratableInstance = null;
    return true;
  }
  return false;
}

function tryHydrateActivity(fiber: Fiber, nextInstance: HydratableInstance): ActivityInstance | null {
  // fiber is a ActivityComponent Fiber
  const activityInstance = canHydrateActivityInstance(nextInstance, rootOrSingletonContext);
  if (activityInstance !== null) {
    const activityState: ActivityState = {
      dehydrated: activityInstance,
      treeContext: getSuspendedTreeContext(),
      retryLane: OffscreenLane,
      hydrationErrors: null,
    };
    fiber.memoizedState = activityState;
    // Store the dehydrated fragment as a child fiber.
    // This simplifies the code for getHostSibling and deleting nodes,
    // since it doesn't have to consider all Suspense boundaries and
    // check if they're dehydrated ones or not.
    const dehydratedFragment = createFiberFromDehydratedFragment(activityInstance);
    dehydratedFragment.return = fiber;
    fiber.child = dehydratedFragment;
    hydrationParentFiber = fiber;
    // While an Activity Instance does have children, we won't step into
    // it during the first pass. Instead, we'll reenter it later.
    nextHydratableInstance = null;
  }
  return activityInstance;
}

function tryHydrateSuspense(fiber: Fiber, nextInstance: HydratableInstance): SuspenseInstance | null {
  // fiber is a SuspenseComponent Fiber
  const suspenseInstance = canHydrateSuspenseInstance(nextInstance, rootOrSingletonContext);
  if (suspenseInstance !== null) {
    const suspenseState: SuspenseState = {
      dehydrated: suspenseInstance,
      treeContext: getSuspendedTreeContext(),
      retryLane: OffscreenLane,
      hydrationErrors: null,
    };
    fiber.memoizedState = suspenseState;
    // Store the dehydrated fragment as a child fiber.
    // This simplifies the code for getHostSibling and deleting nodes,
    // since it doesn't have to consider all Suspense boundaries and
    // check if they're dehydrated ones or not.
    const dehydratedFragment = createFiberFromDehydratedFragment(suspenseInstance);
    dehydratedFragment.return = fiber;
    fiber.child = dehydratedFragment;
    hydrationParentFiber = fiber;
    // While a Suspense Instance does have children, we won't step into
    // it during the first pass. Instead, we'll reenter it later.
    nextHydratableInstance = null;
  }
  return suspenseInstance;
}

export const HydrationMismatchException: unknown = new Error(
  "Hydration Mismatch Exception: This is not a real error, and should not leak into " +
    "userspace. If you're seeing this, it's likely a bug in React.",
);

function throwOnHydrationMismatch(fiber: Fiber, fromText = false): never {
  let diff = "";
  if (isDevelopment) {
    // Consume the diff root for this mismatch.
    // Any other errors will get their own diffs.
    const diffRoot = hydrationDiffRootDEV;
    if (diffRoot !== null) {
      hydrationDiffRootDEV = null;
      diff = describeDiff(diffRoot);
    }
  }
  const error = new Error(
    `Hydration failed because the server rendered ${fromText ? "text" : "HTML"} didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:
` +
      "\n" +
      "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
      "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
      "- Date formatting in a user's locale which doesn't match the server.\n" +
      "- External changing data without sending a snapshot of it along with the HTML.\n" +
      "- Invalid HTML tag nesting.\n" +
      "\n" +
      "It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n" +
      "\n" +
      "https://react.dev/link/hydration-mismatch" +
      diff,
  );
  queueHydrationError(createCapturedValueAtFiber(error, fiber));
  throw HydrationMismatchException;
}

function claimHydratableSingleton(fiber: Fiber): void {
  if (supportsSingletons) {
    if (!isHydrating) {
      return;
    }
    const currentRootContainer = getRootHostContainer();
    const currentHostContext = getHostContext();
    const instance: Instance = resolveSingletonInstance(
      fiber.type as Type,
      fiber.pendingProps as Props,
      currentRootContainer,
      currentHostContext,
      false,
    );
    fiber.stateNode = instance;

    if (isDevelopment) {
      if (!didSuspendOrErrorDEV) {
        const differences = diffHydratedPropsForDevWarnings(instance, fiber.type as Type, fiber.pendingProps as Props, currentHostContext);
        if (differences !== null) {
          const diffNode = buildHydrationDiffNode(fiber, 0);
          diffNode.serverProps = differences as ServerProps;
        }
      }
    }

    hydrationParentFiber = fiber;
    rootOrSingletonContext = true;
    nextHydratableInstance = getFirstHydratableChildWithinSingleton(fiber.type as Type, instance, nextHydratableInstance);
  }
}

function tryToClaimNextHydratableInstance(fiber: Fiber): void {
  if (!isHydrating) {
    return;
  }
  // Validate that this is ok to render here before any mismatches.
  const currentHostContext = getHostContext();
  const shouldKeepWarning = validateHydratableInstance(fiber.type as Type, fiber.pendingProps as Props, currentHostContext);

  const nextInstance = nextHydratableInstance;
  if (!nextInstance || !tryHydrateInstance(fiber, nextInstance, currentHostContext)) {
    if (shouldKeepWarning) {
      warnNonHydratedInstance(fiber, nextInstance);
    }
    throwOnHydrationMismatch(fiber);
  }
}

function tryToClaimNextHydratableTextInstance(fiber: Fiber): void {
  if (!isHydrating) {
    return;
  }
  const text = fiber.pendingProps as string;
  // Validate that this is ok to render here before any mismatches.
  const currentHostContext = getHostContext();
  const shouldKeepWarning = validateHydratableTextInstance(text, currentHostContext);

  const nextInstance = nextHydratableInstance;
  if (!nextInstance || !tryHydrateText(fiber, nextInstance)) {
    if (shouldKeepWarning) {
      warnNonHydratedInstance(fiber, nextInstance);
    }
    throwOnHydrationMismatch(fiber);
  }
}

function claimNextHydratableActivityInstance(fiber: Fiber): ActivityInstance {
  const nextInstance = nextHydratableInstance;
  const activityInstance = nextInstance ? tryHydrateActivity(fiber, nextInstance) : null;
  if (activityInstance === null) {
    warnNonHydratedInstance(fiber, nextInstance);
    throwOnHydrationMismatch(fiber);
  }
  return activityInstance;
}

function claimNextHydratableSuspenseInstance(fiber: Fiber): SuspenseInstance {
  const nextInstance = nextHydratableInstance;
  const suspenseInstance = nextInstance ? tryHydrateSuspense(fiber, nextInstance) : null;
  if (suspenseInstance === null) {
    warnNonHydratedInstance(fiber, nextInstance);
    throwOnHydrationMismatch(fiber);
  }
  return suspenseInstance;
}

export function tryToClaimNextHydratableFormMarkerInstance(fiber: Fiber): boolean {
  if (!isHydrating) {
    return false;
  }
  if (nextHydratableInstance) {
    const markerInstance = canHydrateFormStateMarker(nextHydratableInstance, rootOrSingletonContext);
    if (markerInstance) {
      // Found the marker instance.
      nextHydratableInstance = getNextHydratableSibling(markerInstance);
      // Return true if this marker instance should use the state passed
      // to hydrateRoot.
      // TODO: As an optimization, Fizz should only emit these markers if form
      // state is passed at the root.
      return isFormStateMarkerMatching(markerInstance);
    }
  }
  // Should have found a marker instance. Throw an error to trigger client
  // rendering. We don't bother to check if we're in a concurrent root because
  // useActionState is a new API, so backwards compat is not an issue.
  throwOnHydrationMismatch(fiber);
}

function prepareToHydrateHostInstance(fiber: Fiber, hostContext: HostContext): void {
  if (!supportsHydration) {
    throw new Error(
      "Expected prepareToHydrateHostInstance() to never be called. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  const instance = fiber.stateNode as Instance;
  const didHydrate = hydrateInstance(instance, fiber.type as Type, fiber.memoizedProps as Props, hostContext, fiber);
  if (!didHydrate) {
    throwOnHydrationMismatch(fiber, true);
  }
}

function prepareToHydrateHostTextInstance(fiber: Fiber): void {
  if (!supportsHydration) {
    throw new Error(
      "Expected prepareToHydrateHostTextInstance() to never be called. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  const textInstance = fiber.stateNode as TextInstance;
  const textContent = fiber.memoizedProps as string;
  const shouldWarnIfMismatchDev = !didSuspendOrErrorDEV;
  let parentProps: Props | null = null;
  // We assume that prepareToHydrateHostTextInstance is called in a context where the
  // hydration parent is the parent host component of this host text.
  const returnFiber = hydrationParentFiber;
  if (returnFiber !== null) {
    switch (returnFiber.tag) {
      case HostRoot: {
        if (isDevelopment) {
          if (shouldWarnIfMismatchDev) {
            const difference = diffHydratedTextForDevWarnings(textInstance, textContent, parentProps);
            if (difference !== null) {
              const diffNode = buildHydrationDiffNode(fiber, 0);
              diffNode.serverProps = difference as ServerProps;
            }
          }
        }
        break;
      }
      case HostSingleton:
      case HostComponent: {
        parentProps = returnFiber.memoizedProps as Props;
        if (isDevelopment) {
          if (shouldWarnIfMismatchDev) {
            const difference = diffHydratedTextForDevWarnings(textInstance, textContent, parentProps);
            if (difference !== null) {
              const diffNode = buildHydrationDiffNode(fiber, 0);
              diffNode.serverProps = difference as ServerProps;
            }
          }
        }
        break;
      }
    }
    // TODO: What if it's a SuspenseInstance?
  }

  const didHydrate = hydrateTextInstance(textInstance, textContent, fiber, parentProps);
  if (!didHydrate) {
    throwOnHydrationMismatch(fiber, true);
  }
}

function prepareToHydrateHostActivityInstance(fiber: Fiber): void {
  if (!supportsHydration) {
    throw new Error(
      "Expected prepareToHydrateHostActivityInstance() to never be called. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  const activityState = fiber.memoizedState as ActivityState | null;
  const activityInstance = activityState !== null ? activityState.dehydrated : null;
  if (!activityInstance) {
    throw new Error(
      "Expected to have a hydrated activity instance. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  hydrateActivityInstance(activityInstance, fiber);
}

function prepareToHydrateHostSuspenseInstance(fiber: Fiber): void {
  if (!supportsHydration) {
    throw new Error(
      "Expected prepareToHydrateHostSuspenseInstance() to never be called. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  const suspenseState = fiber.memoizedState as SuspenseState | null;
  const suspenseInstance = suspenseState !== null ? suspenseState.dehydrated : null;
  if (!suspenseInstance) {
    throw new Error(
      "Expected to have a hydrated suspense instance. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  hydrateSuspenseInstance(suspenseInstance, fiber);
}

function skipPastDehydratedActivityInstance(fiber: Fiber): HydratableInstance | null {
  const activityState = fiber.memoizedState as ActivityState | null;
  const activityInstance = activityState !== null ? activityState.dehydrated : null;
  if (!activityInstance) {
    throw new Error(
      "Expected to have a hydrated suspense instance. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  return getNextHydratableInstanceAfterActivityInstance(activityInstance);
}

function skipPastDehydratedSuspenseInstance(fiber: Fiber): HydratableInstance | null {
  if (!supportsHydration) {
    throw new Error(
      "Expected skipPastDehydratedSuspenseInstance() to never be called. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  const suspenseState = fiber.memoizedState as SuspenseState | null;
  const suspenseInstance = suspenseState !== null ? suspenseState.dehydrated : null;
  if (!suspenseInstance) {
    throw new Error(
      "Expected to have a hydrated suspense instance. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
  }
  return getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance);
}

function popToNextHostParent(fiber: Fiber): void {
  hydrationParentFiber = fiber.return;
  while (hydrationParentFiber) {
    switch (hydrationParentFiber.tag) {
      case HostComponent:
      case ActivityComponent:
      case SuspenseComponent:
        rootOrSingletonContext = false;
        return;
      case HostSingleton:
      case HostRoot:
        rootOrSingletonContext = true;
        return;
      default:
        hydrationParentFiber = hydrationParentFiber.return;
    }
  }
}

function popHydrationState(fiber: Fiber): boolean {
  if (!supportsHydration) {
    return false;
  }
  if (fiber !== hydrationParentFiber) {
    // We're deeper than the current hydration context, inside an inserted
    // tree.
    return false;
  }
  if (!isHydrating) {
    // If we're not currently hydrating but we're in a hydration context, then
    // we were an insertion and now need to pop up reenter hydration of our
    // siblings.
    popToNextHostParent(fiber);
    isHydrating = true;
    return false;
  }

  const tag = fiber.tag;

  if (supportsSingletons) {
    // With float we never clear the Root, or Singleton instances. We also do not clear Instances
    // that have singleton text content
    if (
      tag !== HostRoot &&
      tag !== HostSingleton &&
      !(
        tag === HostComponent &&
        (!shouldDeleteUnhydratedTailInstances(fiber.type as Type) ||
          shouldSetTextContent(fiber.type as Type, fiber.memoizedProps as Props))
      )
    ) {
      const nextInstance = nextHydratableInstance;
      if (nextInstance) {
        warnIfUnhydratedTailNodes(fiber);
        throwOnHydrationMismatch(fiber);
      }
    }
  } else {
    // If we have any remaining hydratable nodes, we need to delete them now.
    // We only do this deeper than head and body since they tend to have random
    // other nodes in them. We also ignore components with pure text content in
    // side of them. We also don't delete anything inside the root container.
    if (
      tag !== HostRoot &&
      (tag !== HostComponent ||
        (shouldDeleteUnhydratedTailInstances(fiber.type as Type) &&
          !shouldSetTextContent(fiber.type as Type, fiber.memoizedProps as Props)))
    ) {
      const nextInstance = nextHydratableInstance;
      if (nextInstance) {
        warnIfUnhydratedTailNodes(fiber);
        throwOnHydrationMismatch(fiber);
      }
    }
  }
  popToNextHostParent(fiber);
  if (tag === SuspenseComponent) {
    nextHydratableInstance = skipPastDehydratedSuspenseInstance(fiber);
  } else if (tag === ActivityComponent) {
    nextHydratableInstance = skipPastDehydratedActivityInstance(fiber);
  } else if (supportsSingletons && tag === HostSingleton) {
    nextHydratableInstance = getNextHydratableSiblingAfterSingleton(fiber.type as Type, nextHydratableInstance);
  } else {
    nextHydratableInstance = hydrationParentFiber ? getNextHydratableSibling(hydratableInstanceOf(fiber)) : null;
  }
  return true;
}

function warnIfUnhydratedTailNodes(fiber: Fiber): void {
  if (isDevelopment) {
    let nextInstance = nextHydratableInstance;
    while (nextInstance) {
      const diffNode = buildHydrationDiffNode(fiber, 0);
      const description = describeHydratableInstanceForDevWarnings(nextInstance) as ServerTailEntry;
      diffNode.serverTail.push(description);
      if (typeof description !== "string" && description.type === "Suspense") {
        const suspenseInstance: SuspenseInstance = nextInstance;
        nextInstance = getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance);
      } else {
        nextInstance = getNextHydratableSibling(nextInstance);
      }
    }
  }
}

function resetHydrationState(): void {
  if (!supportsHydration) {
    return;
  }
  hydrationParentFiber = null;
  nextHydratableInstance = null;
  isHydrating = false;
  didSuspendOrErrorDEV = false;
}

// Restore the hydration cursor when unwinding a HostComponent that already
// claimed a DOM node. This is a fork of popHydrationState that does all the
// same validity checks but restores the cursor to this fiber's DOM node
// instead of advancing past it. It also does NOT clear unhydrated tail nodes
// or throw on mismatches since we're unwinding, not completing.
//
// This is needed when replaySuspendedUnitOfWork calls unwindInterruptedWork
// before re-running beginWork on the same fiber, or when throwAndUnwindWorkLoop
// calls unwindWork on ancestor fibers.
function popHydrationStateOnInterruptedWork(fiber: Fiber): void {
  if (!supportsHydration) {
    return;
  }
  if (fiber !== hydrationParentFiber) {
    // We're deeper than the current hydration context, inside an inserted
    // tree. Don't touch the cursor.
    return;
  }
  if (!isHydrating) {
    // If we're not currently hydrating but we're in a hydration context, then
    // we were an insertion and now need to pop up to reenter hydration of our
    // siblings. Same as popHydrationState.
    popToNextHostParent(fiber);
    isHydrating = true;
    return;
  }
  // We're in a valid hydration context. Restore the cursor to this fiber's
  // DOM node so that when beginWork re-runs, it can claim the same node.
  // Unlike popHydrationState, we do NOT check for unhydrated tail nodes
  // or advance the cursor - we're restoring, not completing.
  popToNextHostParent(fiber);
  if (fiber.tag === HostComponent && fiber.stateNode != null) {
    nextHydratableInstance = hydratableInstanceOf(fiber);
  }
}

export function upgradeHydrationErrorsToRecoverable(): CapturedValue<unknown>[] | null {
  const queuedErrors = hydrationErrors;
  if (queuedErrors !== null) {
    // Successfully completed a forced client render. The errors that occurred
    // during the hydration attempt are now recovered. We will log them in
    // commit phase, once the entire tree has finished.
    queueRecoverableErrors(queuedErrors);
    hydrationErrors = null;
  }
  return queuedErrors;
}

function getIsHydrating(): boolean {
  return isHydrating;
}

export function queueHydrationError(error: CapturedValue<unknown>): void {
  if (hydrationErrors === null) {
    hydrationErrors = [error];
  } else {
    hydrationErrors.push(error);
  }
}

export function emitPendingHydrationWarnings(): void {
  if (isDevelopment) {
    // If we haven't yet thrown any hydration errors by the time we reach the end we've successfully
    // hydrated, however, we might still have DEV-only mismatches that we log now.
    const diffRoot = hydrationDiffRootDEV;
    if (diffRoot !== null) {
      hydrationDiffRootDEV = null;
      const diff = describeDiff(diffRoot);
      // Just pick the DFS-first leaf as the owner.
      // Should be good enough since most warnings only have a single error.
      let diffOwner: HydrationDiffNode = diffRoot;
      while (diffOwner.children.length > 0) {
        diffOwner = diffOwner.children[0]!;
      }
      runWithFiberInDEV(diffOwner.fiber, () => {
        console.error(
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. " +
            "This can happen if a SSR-ed Client Component used:\n" +
            "\n" +
            "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
            "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
            "- Date formatting in a user's locale which doesn't match the server.\n" +
            "- External changing data without sending a snapshot of it along with the HTML.\n" +
            "- Invalid HTML tag nesting.\n" +
            "\n" +
            "It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n" +
            "\n" +
            "%s%s",
          "https://react.dev/link/hydration-mismatch",
          diff,
        );
      });
    }
  }
}

export {
  claimHydratableSingleton,
  claimNextHydratableActivityInstance,
  claimNextHydratableSuspenseInstance,
  enterHydrationState,
  getIsHydrating,
  popHydrationState,
  popHydrationStateOnInterruptedWork,
  prepareToHydrateHostActivityInstance,
  prepareToHydrateHostInstance,
  prepareToHydrateHostSuspenseInstance,
  prepareToHydrateHostTextInstance,
  reenterHydrationStateFromDehydratedActivityInstance,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  tryToClaimNextHydratableInstance,
  tryToClaimNextHydratableTextInstance,
  warnIfHydrating,
};

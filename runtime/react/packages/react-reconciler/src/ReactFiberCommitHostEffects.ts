// The commit phase's host operations: each wraps one host config call with
// the fiber set as current in development and the error captured as a
// commit-phase error of that fiber. Also placement: finding the host parent
// and the host sibling to insert before.
//
// Port of upstream's ReactFiberCommitHostEffects.js (stable channel).

import type {
  ActivityInstance,
  ChildSet,
  Container,
  FragmentInstanceType,
  Instance,
  Props,
  SuspenseInstance,
  TextInstance,
} from "react-reconciler/ReactFiberConfig.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";

import { isDevelopment } from "shared/Build.ts";
import { enableFragmentRefs } from "shared/ReactFeatureFlags.ts";
import { DehydratedFragment, HostComponent, HostHoistable, HostPortal, HostRoot, HostSingleton, HostText } from "./ReactWorkTags.ts";
import { ContentReset, Placement } from "./ReactFiberFlags.ts";
import {
  acquireSingletonInstance,
  appendChild,
  appendChildToContainer,
  commitHydratedActivityInstance,
  commitHydratedContainer,
  commitHydratedInstance,
  commitHydratedSuspenseInstance,
  commitMount,
  commitTextUpdate,
  commitUpdate,
  hideDehydratedBoundary,
  hideInstance,
  hideTextInstance,
  insertBefore,
  insertInContainerBefore,
  isSingletonScope,
  releaseSingletonInstance,
  removeChild,
  removeChildFromContainer,
  replaceContainerChildren,
  resetTextContent,
  supportsMutation,
  supportsResources,
  supportsSingletons,
  unhideDehydratedBoundary,
  unhideInstance,
  unhideTextInstance,
} from "react-reconciler/ReactFiberConfig.ts";
import { captureCommitPhaseError } from "./ReactFiberWorkLoop.ts";
import { trackHostMutation } from "./ReactFiberMutationTracking.ts";
import { runWithFiberInDEV } from "./ReactCurrentFiber.ts";
import { commitNewChildToFragmentInstances, getParentFragmentInstances } from "./ReactFiberFragmentInstance.ts";

// A portal's stateNode: its container, and the child set persistent mode
// builds for it.
export interface PortalStateNode {
  containerInfo: Container;
  pendingChildren: ChildSet;
}

// Runs a host operation with the fiber as the current fiber in development,
// where component stacks in warnings need it.
function runHostOperation<Args extends unknown[]>(fiber: Fiber, operation: (...args: Args) => void, ...args: Args): void {
  if (isDevelopment) {
    runWithFiberInDEV(fiber, operation, ...args);
  } else {
    operation(...args);
  }
}

export function commitHostMount(finishedWork: Fiber): void {
  const type = finishedWork.type as string;
  const props = finishedWork.memoizedProps as Props;
  const instance = finishedWork.stateNode as Instance;
  try {
    runHostOperation(finishedWork, commitMount, instance, type, props, finishedWork);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostHydratedInstance(finishedWork: Fiber): void {
  const type = finishedWork.type as string;
  const props = finishedWork.memoizedProps as Props;
  const instance = finishedWork.stateNode as Instance;
  try {
    runHostOperation(finishedWork, commitHydratedInstance, instance, type, props, finishedWork);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostUpdate(finishedWork: Fiber, newProps: Props, oldProps: Props): void {
  try {
    runHostOperation(
      finishedWork,
      commitUpdate,
      finishedWork.stateNode as Instance,
      finishedWork.type as string,
      oldProps,
      newProps,
      finishedWork,
    );
    // Mutations are tracked manually from within commitUpdate.
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostTextUpdate(finishedWork: Fiber, newText: string, oldText: string): void {
  const textInstance = finishedWork.stateNode as TextInstance;
  try {
    runHostOperation(finishedWork, commitTextUpdate, textInstance, oldText, newText);
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostResetTextContent(finishedWork: Fiber): void {
  const instance = finishedWork.stateNode as Instance;
  try {
    runHostOperation(finishedWork, resetTextContent, instance);
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitShowHideSuspenseBoundary(node: Fiber, isHidden: boolean): void {
  try {
    const instance = node.stateNode as SuspenseInstance;
    if (isHidden) {
      runHostOperation(node, hideDehydratedBoundary, instance);
    } else {
      runHostOperation(node, unhideDehydratedBoundary, instance);
    }
  } catch (error) {
    captureCommitPhaseError(node, node.return, error);
  }
}

export function commitShowHideHostInstance(node: Fiber, isHidden: boolean): void {
  try {
    const instance = node.stateNode as Instance;
    if (isHidden) {
      runHostOperation(node, hideInstance, instance);
    } else {
      runHostOperation(node, unhideInstance, instance, node.memoizedProps as Props);
    }
  } catch (error) {
    captureCommitPhaseError(node, node.return, error);
  }
}

export function commitShowHideHostTextInstance(node: Fiber, isHidden: boolean): void {
  try {
    const instance = node.stateNode as TextInstance;
    if (isHidden) {
      runHostOperation(node, hideTextInstance, instance);
    } else {
      runHostOperation(node, unhideTextInstance, instance, node.memoizedProps as string);
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(node, node.return, error);
  }
}

function isHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    (supportsResources ? fiber.tag === HostHoistable : false) ||
    (supportsSingletons ? fiber.tag === HostSingleton && isSingletonScope(fiber.type as string) : false) ||
    fiber.tag === HostPortal
  );
}

function getHostSibling(fiber: Fiber): Instance | null {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next
  // sibling.
  // TODO: Find a more efficient way to do this.
  let node: Fiber = fiber;
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // If we pop out of the root or hit the parent the fiber we are the
        // last sibling.
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
    while (node.tag !== HostComponent && node.tag !== HostText && node.tag !== DehydratedFragment) {
      // If this is a host singleton we go deeper if it's not a special
      // singleton scope. If it is a singleton scope we skip over it because
      // you only insert against this scope when you are already inside of it
      if (supportsSingletons && node.tag === HostSingleton && isSingletonScope(node.type as string)) {
        continue siblings;
      }

      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      if (node.flags & Placement) {
        // If we don't have a child, try the siblings instead.
        continue siblings;
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }
    // Check if this host node is stable or about to be placed.
    if (!(node.flags & Placement)) {
      // Found it!
      return node.stateNode as Instance;
    }
  }
}

function insertOrAppendPlacementNodeIntoContainer(
  node: Fiber,
  before: Instance | null,
  parent: Container,
  parentFragmentInstances: FragmentInstanceType[] | null,
): void {
  const { tag } = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode as Instance | TextInstance;
    if (before) {
      insertInContainerBefore(parent, stateNode, before);
    } else {
      appendChildToContainer(parent, stateNode);
    }
    if (enableFragmentRefs) {
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
    }
    trackHostMutation();
    return;
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
    return;
  }

  if (supportsSingletons ? tag === HostSingleton : false) {
    if (enableFragmentRefs) {
      // The singleton is the fragment child. Its own children are not
      // attributed to the fragment instances above it.
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
      parentFragmentInstances = null;
    }
    if (isSingletonScope(node.type as string)) {
      // This singleton is the parent of deeper nodes and needs to become the
      // parent for child insertions and appends
      parent = node.stateNode as Container;
      before = null;
    }
  }

  const child = node.child;
  if (child !== null) {
    insertOrAppendPlacementNodeIntoContainer(child, before, parent, parentFragmentInstances);
    let sibling = child.sibling;
    while (sibling !== null) {
      insertOrAppendPlacementNodeIntoContainer(sibling, before, parent, parentFragmentInstances);
      sibling = sibling.sibling;
    }
  }
}

function insertOrAppendPlacementNode(
  node: Fiber,
  before: Instance | null,
  parent: Instance,
  parentFragmentInstances: FragmentInstanceType[] | null,
): void {
  const { tag } = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode as Instance | TextInstance;
    if (before) {
      insertBefore(parent, stateNode, before);
    } else {
      appendChild(parent, stateNode);
    }
    if (enableFragmentRefs) {
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
    }
    trackHostMutation();
    return;
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
    return;
  }

  if (supportsSingletons ? tag === HostSingleton : false) {
    if (enableFragmentRefs) {
      // The singleton is the fragment child. Its own children are not
      // attributed to the fragment instances above it.
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
      parentFragmentInstances = null;
    }
    if (isSingletonScope(node.type as string)) {
      // This singleton is the parent of deeper nodes and needs to become the
      // parent for child insertions and appends
      parent = node.stateNode as Instance;
    }
  }

  const child = node.child;
  if (child !== null) {
    insertOrAppendPlacementNode(child, before, parent, parentFragmentInstances);
    let sibling = child.sibling;
    while (sibling !== null) {
      insertOrAppendPlacementNode(sibling, before, parent, parentFragmentInstances);
      sibling = sibling.sibling;
    }
  }
}

function commitPlacement(finishedWork: Fiber): void {
  // Recursively insert all host nodes into the parent.
  let hostParentFiber: Fiber | null = null;
  let parentFiber = finishedWork.return;
  while (parentFiber !== null) {
    if (isHostParent(parentFiber)) {
      hostParentFiber = parentFiber;
      break;
    }
    parentFiber = parentFiber.return;
  }
  // Fragment ancestry is collected separately so portals remain placement
  // parents while fragment bookkeeping still walks past them to ancestors.
  const parentFragmentInstances = enableFragmentRefs ? getParentFragmentInstances(finishedWork) : null;

  if (!supportsMutation) {
    if (enableFragmentRefs) {
      commitImmutablePlacementNodeToFragmentInstances(finishedWork, parentFragmentInstances);
    }
    return;
  }

  if (hostParentFiber == null) {
    throw new Error(
      "Expected to find a host parent. This error is likely caused by a bug " + "in React. Please file an issue.",
    );
  }

  switch (hostParentFiber.tag) {
    case HostSingleton:
    case HostComponent: {
      // Upstream's HostSingleton case falls through to HostComponent when
      // the renderer does not support singletons.
      if (hostParentFiber.tag === HostSingleton && supportsSingletons) {
        const parent = hostParentFiber.stateNode as Instance;
        const before = getHostSibling(finishedWork);
        // We only have the top Fiber that was inserted but we need to
        // recurse down its children to find all the terminal nodes.
        insertOrAppendPlacementNode(finishedWork, before, parent, parentFragmentInstances);
        break;
      }
      const parent = hostParentFiber.stateNode as Instance;
      if (hostParentFiber.flags & ContentReset) {
        // Reset the text content of the parent before doing any insertions
        resetTextContent(parent);
        // Clear ContentReset from the effect tag
        hostParentFiber.flags &= ~ContentReset;
      }

      const before = getHostSibling(finishedWork);
      // We only have the top Fiber that was inserted but we need to recurse
      // down its children to find all the terminal nodes.
      insertOrAppendPlacementNode(finishedWork, before, parent, parentFragmentInstances);
      break;
    }
    case HostRoot:
    case HostPortal: {
      const parent = (hostParentFiber.stateNode as { containerInfo: Container }).containerInfo;
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent, parentFragmentInstances);
      break;
    }
    default:
      throw new Error(
        "Invalid host parent fiber. This error is likely caused by a bug " + "in React. Please file an issue.",
      );
  }
}

function commitImmutablePlacementNodeToFragmentInstances(
  finishedWork: Fiber,
  parentFragmentInstances: FragmentInstanceType[] | null,
): void {
  if (!enableFragmentRefs) {
    return;
  }
  const isHost =
    finishedWork.tag === HostComponent || (supportsSingletons ? finishedWork.tag === HostSingleton : false);
  if (isHost) {
    // A singleton is the fragment child itself, so its own children are not
    // attributed to the fragment instances above it.
    commitNewChildToFragmentInstances(finishedWork, parentFragmentInstances);
    return;
  } else if (finishedWork.tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
    return;
  }

  const child = finishedWork.child;
  if (child !== null) {
    commitImmutablePlacementNodeToFragmentInstances(child, parentFragmentInstances);
    let sibling = child.sibling;
    while (sibling !== null) {
      commitImmutablePlacementNodeToFragmentInstances(sibling, parentFragmentInstances);
      sibling = sibling.sibling;
    }
  }
}

export function commitHostPlacement(finishedWork: Fiber): void {
  try {
    runHostOperation(finishedWork, commitPlacement, finishedWork);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostRemoveChildFromContainer(
  deletedFiber: Fiber,
  nearestMountedAncestor: Fiber,
  parentContainer: Container,
  hostInstance: Instance | TextInstance,
): void {
  try {
    runHostOperation(deletedFiber, removeChildFromContainer, parentContainer, hostInstance);
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
  }
}

export function commitHostRemoveChild(
  deletedFiber: Fiber,
  nearestMountedAncestor: Fiber,
  parentInstance: Instance,
  hostInstance: Instance | TextInstance,
): void {
  try {
    runHostOperation(deletedFiber, removeChild, parentInstance, hostInstance);
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
  }
}

export function commitHostRootContainerChildren(root: FiberRoot, finishedWork: Fiber): void {
  const containerInfo = root.containerInfo;
  const pendingChildren = root.pendingChildren as ChildSet;
  try {
    runHostOperation(finishedWork, replaceContainerChildren, containerInfo, pendingChildren);
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostPortalContainerChildren(
  portal: PortalStateNode,
  finishedWork: Fiber,
  pendingChildren: ChildSet,
): void {
  const containerInfo = portal.containerInfo;
  try {
    runHostOperation(finishedWork, replaceContainerChildren, containerInfo, pendingChildren);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostHydratedContainer(root: FiberRoot, finishedWork: Fiber): void {
  try {
    runHostOperation(finishedWork, commitHydratedContainer, root.containerInfo);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostHydratedActivity(activityInstance: ActivityInstance, finishedWork: Fiber): void {
  try {
    runHostOperation(finishedWork, commitHydratedActivityInstance, activityInstance);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostHydratedSuspense(suspenseInstance: SuspenseInstance, finishedWork: Fiber): void {
  try {
    runHostOperation(finishedWork, commitHydratedSuspenseInstance, suspenseInstance);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostSingletonAcquisition(finishedWork: Fiber): void {
  const singleton = finishedWork.stateNode as Instance;
  const props = finishedWork.memoizedProps as Props;

  try {
    // This was a new mount, acquire the DOM instance and set initial
    // properties
    runHostOperation(finishedWork, acquireSingletonInstance, finishedWork.type as string, props, singleton, finishedWork);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHostSingletonRelease(releasingWork: Fiber): void {
  // Upstream passes the type and props as well; the host contract only
  // takes the instance, as every upstream host config does.
  runHostOperation(releasingWork, releaseSingletonInstance, releasingWork.stateNode as Instance);
}

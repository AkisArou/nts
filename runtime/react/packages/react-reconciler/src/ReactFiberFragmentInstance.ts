// Fragment refs: keeping each Fragment instance's set of host children in
// step with insertions and deletions below it.
//
// Port of upstream's ReactFiberFragmentInstance.js.

import type { FragmentInstanceType, Instance, TextInstance } from "./ReactFiberConfig.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

import { Fragment, HostComponent, HostRoot, HostSingleton, HostText } from "./ReactWorkTags.ts";
import { commitNewChildToFragmentInstance, deleteChildFromFragmentInstance, supportsSingletons } from "./ReactFiberConfig.ts";
import { enableFragmentRefsTextNodes } from "shared/ReactFeatureFlags.ts";

export function commitNewChildToFragmentInstances(
  fiber: Fiber,
  parentFragmentInstances: FragmentInstanceType[] | null,
): void {
  if (
    (fiber.tag !== HostComponent &&
      fiber.tag !== HostSingleton &&
      !(enableFragmentRefsTextNodes && fiber.tag === HostText)) ||
    // Only run fragment insertion effects for initial insertions
    fiber.alternate !== null ||
    parentFragmentInstances === null
  ) {
    return;
  }
  for (let i = 0; i < parentFragmentInstances.length; i++) {
    const fragmentInstance = parentFragmentInstances[i] as FragmentInstanceType;
    commitNewChildToFragmentInstance(fiber.stateNode as Instance | TextInstance, fragmentInstance);
  }
}

export function commitFragmentInstanceInsertionEffects(fiber: Fiber): void {
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance = parent.stateNode as FragmentInstanceType;
      commitNewChildToFragmentInstance(fiber.stateNode as Instance | TextInstance, fragmentInstance);
    }

    if (isFragmentInstanceHostBoundary(parent)) {
      return;
    }

    parent = parent.return;
  }
}

export function commitFragmentInstanceDeletionEffects(fiber: Fiber): void {
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance = parent.stateNode as FragmentInstanceType;
      deleteChildFromFragmentInstance(fiber.stateNode as Instance | TextInstance, fragmentInstance);
    }

    if (isFragmentInstanceHostBoundary(parent)) {
      return;
    }

    parent = parent.return;
  }
}

export function getParentFragmentInstances(fiber: Fiber): FragmentInstanceType[] | null {
  let parentFragmentInstances: FragmentInstanceType[] | null = null;
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance = parent.stateNode as FragmentInstanceType;
      if (parentFragmentInstances === null) {
        parentFragmentInstances = [fragmentInstance];
      } else {
        parentFragmentInstances.push(fragmentInstance);
      }
    }
    if (isFragmentInstanceHostBoundary(parent)) {
      break;
    }
    parent = parent.return;
  }
  return parentFragmentInstances;
}

// HostPortal / HostHoistable are host parents for placement, but not for
// fragment instance ancestry: commit bookkeeping walks past them so it
// matches getFragmentParentInstanceOrContainerFiber. HostSingleton is a
// fragment host boundary (and a collected child) even when it is not a
// placement scope.
function isFragmentInstanceHostBoundary(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent || fiber.tag === HostRoot || (supportsSingletons ? fiber.tag === HostSingleton : false)
  );
}

function isFragmentInstanceParent(fiber: Fiber): boolean {
  return fiber.tag === Fragment && fiber.stateNode !== null;
}

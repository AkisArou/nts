import type { Wakeable } from "shared/ReactTypes.ts";
import type { CapturedValue } from "./ReactCapturedValue.ts";
import type { SuspenseInstance } from "react-reconciler/ReactFiberConfig.ts";
import { isSuspenseInstanceFallback, isSuspenseInstancePending } from "react-reconciler/ReactFiberConfig.ts";
import { DidCapture, NoFlags } from "./ReactFiberFlags.ts";
import type { Lane } from "./ReactFiberLane.ts";
import type { TreeContext } from "./ReactFiberTreeContext.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { SuspenseComponent, SuspenseListComponent } from "./ReactWorkTags.ts";

export type SuspenseListRevealOrder =
  | "forwards"
  | "backwards"
  | "unstable_legacy-backwards"
  | "together"
  | "independent"
  | undefined;

export type SuspenseListTailMode = "visible" | "collapsed" | "hidden" | undefined;

// A null SuspenseState represents an unsuspended normal Suspense boundary.
// A non-null SuspenseState means that it is blocked for one reason or another.
// - A non-null dehydrated field means it's blocked pending hydration.
//   - A non-null dehydrated field can use isSuspenseInstancePending or
//     isSuspenseInstanceFallback to query the reason for being dehydrated.
// - A null dehydrated field means it's blocked by something suspending and
//   we're currently showing a fallback instead.
export interface SuspenseState {
  // If this boundary is still dehydrated, we store the SuspenseInstance
  // here to indicate that it is dehydrated (flag) and for quick access
  // to check things like isSuspenseInstancePending.
  dehydrated: SuspenseInstance | null;
  treeContext: TreeContext | null;
  // Represents the lane we should attempt to hydrate a dehydrated boundary at.
  // OffscreenLane is the default for dehydrated boundaries.
  // NoLane is the default for normal boundaries, which turns into "normal" pri.
  retryLane: Lane;
  // Stashed Errors that happened while attempting to hydrate this boundary.
  hydrationErrors: CapturedValue<unknown>[] | null;
}

export interface SuspenseListRenderState {
  isBackwards: boolean;
  // The currently rendering tail row.
  rendering: Fiber | null;
  // The absolute time when we started rendering the most recent tail row.
  renderingStartTime: number;
  // The last of the already rendered children.
  last: Fiber | null;
  // Remaining rows on the tail of the list.
  tail: Fiber | null;
  // Tail insertions setting.
  tailMode: SuspenseListTailMode;
  // Keep track of total number of forks during multiple passes
  treeForkCount: number;
}

export type RetryQueue = Set<Wakeable>;

export function findFirstSuspended(row: Fiber): Fiber | null {
  let node: Fiber = row;
  for (;;) {
    if (node.tag === SuspenseComponent) {
      const state = node.memoizedState as SuspenseState | null;
      if (state !== null) {
        const dehydrated = state.dehydrated;
        if (dehydrated === null || isSuspenseInstancePending(dehydrated) || isSuspenseInstanceFallback(dehydrated)) {
          return node;
        }
      }
    } else if (
      node.tag === SuspenseListComponent &&
      // Independent revealOrder can't be trusted because it doesn't
      // keep track of whether it suspended or not.
      (node.memoizedProps as { revealOrder?: unknown }).revealOrder !== "independent"
    ) {
      const didSuspend = (node.flags & DidCapture) !== NoFlags;
      if (didSuspend) {
        return node;
      }
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === row) {
      return null;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === row) {
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

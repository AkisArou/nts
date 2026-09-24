// Updates scheduled while a render may be in progress. They are queued here
// and only linked into their fiber's or hook's queue once the current render
// is over (finished or interrupted), so a render never sees an update land in
// the middle of processing a queue.

import { isDevelopment } from "shared/Build.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { UpdateQueue as HookQueue, Update as HookUpdate } from "./ReactFiberHooks.ts";
import type { SharedQueue as ClassQueue, Update as ClassUpdate } from "./ReactFiberClassUpdateQueue.ts";
import type { Lane, LanedUpdate, Lanes } from "./ReactFiberLane.ts";
import type { OffscreenInstance } from "./ReactFiberOffscreenComponent.ts";
import {
  getWorkInProgressRoot,
  throwIfInfiniteUpdateLoopDetected,
  warnAboutUpdateOnNotYetMountedFiberInDEV,
} from "./ReactFiberWorkLoop.ts";
import { markHiddenUpdate, mergeLanes, NoLane, NoLanes } from "./ReactFiberLane.ts";
import { Hydrating, NoFlags, Placement } from "./ReactFiberFlags.ts";
import { HostRoot, OffscreenComponent } from "./ReactWorkTags.ts";
import { OffscreenVisible } from "./ReactFiberOffscreenComponent.ts";

// If a render is in progress, and we receive an update from a concurrent event,
// we wait until the current render is over (either finished or interrupted)
// before adding it to the fiber/hook queue. Push to these arrays so we can
// access the queue, fiber, update, et al later. Upstream interleaves fiber,
// queue, update and lane in one array; here each has its own typed array, and
// the queue and update have one per kind. Entry `i` fills the pair for its
// kind and leaves the other null; a render-only entry leaves both null. One
// index across all of them keeps upstream's order.
const queuedFibers: (Fiber | null)[] = [];
const queuedHookQueues: (HookQueue | null)[] = [];
const queuedHookUpdates: (HookUpdate | null)[] = [];
const queuedClassQueues: (ClassQueue | null)[] = [];
const queuedClassUpdates: (ClassUpdate | null)[] = [];
const queuedLanes: Lane[] = [];
let concurrentQueuesIndex = 0;

let concurrentlyUpdatedLanes: Lanes = NoLanes;

export function finishQueueingConcurrentUpdates(): void {
  const endIndex = concurrentQueuesIndex;
  concurrentQueuesIndex = 0;

  concurrentlyUpdatedLanes = NoLanes;

  for (let i = 0; i < endIndex; i++) {
    const fiber = queuedFibers[i]!;
    queuedFibers[i] = null;
    const hookQueue = queuedHookQueues[i] ?? null;
    queuedHookQueues[i] = null;
    const hookUpdate = queuedHookUpdates[i] ?? null;
    queuedHookUpdates[i] = null;
    const classQueue = queuedClassQueues[i] ?? null;
    queuedClassQueues[i] = null;
    const classUpdate = queuedClassUpdates[i] ?? null;
    queuedClassUpdates[i] = null;
    const lane = queuedLanes[i]!;
    queuedLanes[i] = NoLane;

    let update: LanedUpdate | null = null;
    if (hookQueue !== null && hookUpdate !== null) {
      const pending = hookQueue.pending;
      if (pending === null) {
        // This is the first update. Create a circular list.
        hookUpdate.next = hookUpdate;
      } else {
        hookUpdate.next = pending.next;
        pending.next = hookUpdate;
      }
      hookQueue.pending = hookUpdate;
      update = hookUpdate;
    } else if (classQueue !== null && classUpdate !== null) {
      const pending = classQueue.pending;
      if (pending === null) {
        // This is the first update. Create a circular list.
        classUpdate.next = classUpdate;
      } else {
        classUpdate.next = pending.next;
        pending.next = classUpdate;
      }
      classQueue.pending = classUpdate;
      update = classUpdate;
    }

    if (lane !== NoLane) {
      markUpdateLaneFromFiberToRoot(fiber, update, lane);
    }
  }
}

export function getConcurrentlyUpdatedLanes(): Lanes {
  return concurrentlyUpdatedLanes;
}

function enqueueUpdate(fiber: Fiber, lane: Lane): void {
  // Don't update the `childLanes` on the return path yet. If we already in
  // the middle of rendering, wait until after it has completed.
  const index = concurrentQueuesIndex++;
  queuedFibers[index] = fiber;
  queuedHookQueues[index] = null;
  queuedHookUpdates[index] = null;
  queuedClassQueues[index] = null;
  queuedClassUpdates[index] = null;
  queuedLanes[index] = lane;

  concurrentlyUpdatedLanes = mergeLanes(concurrentlyUpdatedLanes, lane);

  // The fiber's `lane` field is used in some places to check if any work is
  // scheduled, to perform an eager bailout, so we need to update it immediately.
  // TODO: We should probably move this to the "shared" queue instead.
  fiber.lanes = mergeLanes(fiber.lanes, lane);
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
}

function enqueueHookUpdate(fiber: Fiber, queue: HookQueue, update: HookUpdate, lane: Lane): void {
  const index = concurrentQueuesIndex;
  enqueueUpdate(fiber, lane);
  queuedHookQueues[index] = queue;
  queuedHookUpdates[index] = update;
}

export function enqueueConcurrentHookUpdate(
  fiber: Fiber,
  queue: HookQueue,
  update: HookUpdate,
  lane: Lane,
): FiberRoot | null {
  enqueueHookUpdate(fiber, queue, update, lane);
  return getRootForUpdatedFiber(fiber);
}

export function enqueueConcurrentHookUpdateAndEagerlyBailout(
  fiber: Fiber,
  queue: HookQueue,
  update: HookUpdate,
): void {
  // This function is used to queue an update that doesn't need a rerender. The
  // only reason we queue it is in case there's a subsequent higher priority
  // update that causes it to be rebased.
  const lane = NoLane;
  enqueueHookUpdate(fiber, queue, update, lane);

  // Usually we can rely on the upcoming render phase to process the concurrent
  // queue. However, since this is a bail out, we're not scheduling any work
  // here. So the update we just queued will leak until something else happens
  // to schedule work (if ever).
  //
  // Check if we're currently in the middle of rendering a tree, and if not,
  // process the queue immediately to prevent a leak.
  const isConcurrentlyRendering = getWorkInProgressRoot() !== null;
  if (!isConcurrentlyRendering) {
    finishQueueingConcurrentUpdates();
  }
}

export function enqueueConcurrentClassUpdate(
  fiber: Fiber,
  queue: ClassQueue,
  update: ClassUpdate,
  lane: Lane,
): FiberRoot | null {
  const index = concurrentQueuesIndex;
  enqueueUpdate(fiber, lane);
  queuedClassQueues[index] = queue;
  queuedClassUpdates[index] = update;
  return getRootForUpdatedFiber(fiber);
}

export function enqueueConcurrentRenderForLane(fiber: Fiber, lane: Lane): FiberRoot | null {
  enqueueUpdate(fiber, lane);
  return getRootForUpdatedFiber(fiber);
}

// Calling this function outside this module should only be done for backwards
// compatibility and should always be accompanied by a warning.
export function unsafe_markUpdateLaneFromFiberToRoot(sourceFiber: Fiber, lane: Lane): FiberRoot | null {
  // NOTE: For Hyrum's Law reasons, if an infinite update loop is detected, it
  // should throw before `markUpdateLaneFromFiberToRoot` is called. But this is
  // undefined behavior and we can change it if we need to; it just so happens
  // that, at the time of this writing, there's an internal product test that
  // happens to rely on this.
  const root = getRootForUpdatedFiber(sourceFiber);
  markUpdateLaneFromFiberToRoot(sourceFiber, null, lane);
  return root;
}

function markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber,
  update: LanedUpdate | null,
  lane: Lane,
): FiberRoot | null {
  // Update the source fiber's lanes
  sourceFiber.lanes = mergeLanes(sourceFiber.lanes, lane);
  let alternate = sourceFiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
  // Walk the parent path to the root and update the child lanes.
  let isHidden = false;
  let parent = sourceFiber.return;
  let node = sourceFiber;
  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane);
    alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane);
    }

    if (parent.tag === OffscreenComponent) {
      // Check if this offscreen boundary is currently hidden.
      //
      // The instance may be null if the Offscreen parent was unmounted. Usually
      // the parent wouldn't be reachable in that case because we disconnect
      // fibers from the tree when they are deleted. However, there's a weird
      // edge case where setState is called on a fiber that was interrupted
      // before it ever mounted. Because it never mounts, it also never gets
      // deleted. Because it never gets deleted, its return pointer never gets
      // disconnected. Which means it may be attached to a deleted Offscreen
      // parent node. (This discovery suggests it may be better for memory usage
      // if we don't attach the `return` pointer until the commit phase, though
      // in order to do that we'd need some other way to track the return
      // pointer during the initial render, like on the stack.)
      //
      // This case is always accompanied by a warning, but we still need to
      // account for it. (There may be other cases that we haven't discovered,
      // too.)
      const offscreenInstance = parent.stateNode as OffscreenInstance | null;
      if (offscreenInstance !== null && !(offscreenInstance._visibility & OffscreenVisible)) {
        isHidden = true;
      }
    }

    node = parent;
    parent = parent.return;
  }

  if (node.tag === HostRoot) {
    const root = node.stateNode as FiberRoot;
    if (isHidden && update !== null) {
      markHiddenUpdate(root, update, lane);
    }
    return root;
  }
  return null;
}

function getRootForUpdatedFiber(sourceFiber: Fiber): FiberRoot | null {
  // TODO: We will detect and infinite update loop and throw even if this fiber
  // has already unmounted. This isn't really necessary but it happens to be the
  // current behavior we've used for several release cycles. Consider not
  // performing this check if the updated fiber already unmounted, since it's
  // not possible for that to cause an infinite update loop.
  throwIfInfiniteUpdateLoopDetected(false);

  // When a setState happens, we must ensure the root is scheduled. Because
  // update queues do not have a backpointer to the root, the only way to do
  // this currently is to walk up the return path. This used to not be a big
  // deal because we would have to walk up the return path to set
  // the `childLanes`, anyway, but now those two traversals happen at
  // different times.
  // TODO: Consider adding a `root` backpointer on the update queue.
  detectUpdateOnUnmountedFiber(sourceFiber, sourceFiber);
  let node = sourceFiber;
  let parent = node.return;
  while (parent !== null) {
    detectUpdateOnUnmountedFiber(sourceFiber, node);
    node = parent;
    parent = node.return;
  }
  return node.tag === HostRoot ? (node.stateNode as FiberRoot) : null;
}

function detectUpdateOnUnmountedFiber(sourceFiber: Fiber, parent: Fiber): void {
  if (isDevelopment) {
    const alternate = parent.alternate;
    if (alternate === null && (parent.flags & (Placement | Hydrating)) !== NoFlags) {
      warnAboutUpdateOnNotYetMountedFiberInDEV(sourceFiber);
    }
  }
}

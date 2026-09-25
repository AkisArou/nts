
// UpdateQueue is a linked list of prioritized updates.
//
// Like fibers, update queues come in pairs: a current queue, which represents
// the visible state of the screen, and a work-in-progress queue, which can be
// mutated and processed asynchronously before it is committed — a form of
// double buffering. If a work-in-progress render is discarded before finishing,
// we create a new work-in-progress by cloning the current queue.
//
// Both queues share a persistent, singly-linked list structure. To schedule an
// update, we append it to the end of both queues. Each queue maintains a
// pointer to first update in the persistent list that hasn't been processed.
// The work-in-progress pointer always has a position equal to or greater than
// the current queue, since we always work on that one. The current queue's
// pointer is only updated during the commit phase, when we swap in the
// work-in-progress.
//
// For example:
//
//   Current pointer:           A - B - C - D - E - F
//   Work-in-progress pointer:              D - E - F
//                                          ^
//                                          The work-in-progress queue has
//                                          processed more updates than current.
//
// The reason we append to both queues is because otherwise we might drop
// updates without ever processing them. For example, if we only add updates to
// the work-in-progress queue, some updates could be lost whenever a work-in
// -progress render restarts by cloning from current. Similarly, if we only add
// updates to the current queue, the updates will be lost whenever an already
// in-progress queue commits and swaps with the current queue. However, by
// adding to both queues, we guarantee that the update will be part of the next
// work-in-progress. (And because the work-in-progress queue becomes the
// current queue once it commits, there's no danger of applying the same
// update twice.)
//
// Prioritization
// --------------
//
// Updates are not sorted by priority, but by insertion; new updates are always
// appended to the end of the list.
//
// The priority is still important, though. When processing the update queue
// during the render phase, only the updates with sufficient priority are
// included in the result. If we skip an update because it has insufficient
// priority, it remains in the queue to be processed later, during a lower
// priority render. Crucially, all updates subsequent to a skipped update also
// remain in the queue *regardless of their priority*. That means high priority
// updates are sometimes processed twice, at two separate priorities. We also
// keep track of a base state, that represents the state before the first
// update in the queue is applied.
//
// For example:
//
//   Given a base state of '', and the following queue of updates
//
//     A1 - B2 - C1 - D2
//
//   where the number indicates the priority, and the update is applied to the
//   previous state by appending a letter, React will process these updates as
//   two separate renders, one per distinct priority level:
//
//   First render, at priority 1:
//     Base state: ''
//     Updates: [A1, C1]
//     Result state: 'AC'
//
//   Second render, at priority 2:
//     Base state: 'A'            <-  The base state does not include C1,
//                                    because B2 was skipped.
//     Updates: [B2, C1, D2]      <-  C1 was rebased on top of B2
//     Result state: 'ABCD'
//
// Because we process updates in insertion order, and rebase high priority
// updates when preceding updates are skipped, the final result is deterministic
// regardless of priority. Intermediate state may vary according to system
// resources, but the final state is always the same.

import { mergeState } from "react-reconciler/ReactFiberClassComponentHost.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { Lanes, Lane } from "./ReactFiberLane.ts";

import { isDevelopment } from "shared/Build.ts";
import {
  NoLane,
  NoLanes,
  OffscreenLane,
  isSubsetOfLanes,
  mergeLanes,
  removeLanes,
  isTransitionLane,
  intersectLanes,
  markRootEntangled,
  LanedUpdate,
} from "./ReactFiberLane.ts";
import { enterDisallowedContextReadInDEV, exitDisallowedContextReadInDEV } from "./ReactFiberNewContext.ts";
import { Callback, Visibility, ShouldCapture, DidCapture } from "./ReactFiberFlags.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";

import { StrictLegacyMode } from "./ReactTypeOfMode.ts";
import {
  markSkippedUpdateLanes,
  isUnsafeClassRenderPhaseUpdate,
  getWorkInProgressRootRenderLanes,
} from "./ReactFiberWorkLoop.ts";
import { enqueueConcurrentClassUpdate, unsafe_markUpdateLaneFromFiberToRoot } from "./ReactFiberConcurrentUpdates.ts";
import { setIsStrictModeForDevtools } from "./ReactFiberDevToolsHook.ts";

import { peekEntangledActionLane, peekEntangledActionThenable } from "./ReactFiberAsyncAction.ts";

export type UpdateTag = 0 | 1 | 2 | 3;

export const UpdateState = 0;
export const ReplaceState = 1;
export const ForceUpdate = 2;
export const CaptureUpdate = 3;

// A class component's (or the root's) update, in the circular list on its
// queue. Not generic: the state it produces is erased, and each reader
// projects it (see runtime/react/spikes/hook-storage/README.md).
export class Update extends LanedUpdate {
  tag: UpdateTag = UpdateState;
  // A partial state object, a replacement state, or a function of the
  // previous state and props (see getStateFromUpdate).
  payload: unknown = null;
  callback: (() => unknown) | null = null;

  next: Update | null = null;

  constructor(lane: Lane) {
    super(lane);
  }
}

export class SharedQueue {
  pending: Update | null = null;
  lanes: Lanes = NoLanes;
  hiddenCallbacks: (() => unknown)[] | null = null;
}

export class UpdateQueue {
  baseState: unknown;
  firstBaseUpdate: Update | null;
  lastBaseUpdate: Update | null;
  shared: SharedQueue;
  callbacks: (() => unknown)[] | null = null;

  constructor(baseState: unknown, firstBaseUpdate: Update | null, lastBaseUpdate: Update | null, shared: SharedQueue) {
    this.baseState = baseState;
    this.firstBaseUpdate = firstBaseUpdate;
    this.lastBaseUpdate = lastBaseUpdate;
    this.shared = shared;
  }
}


// An updater function, called with the instance as `this`.
type UpdaterFunction<State> = (this: unknown, prevState: State, nextProps: unknown) => unknown;

// Global state that is reset at the beginning of calling `processUpdateQueue`.
// It should only be read right after calling `processUpdateQueue`, via
// `checkHasForceUpdateAfterProcessing`.
let hasForceUpdate = false;

let didWarnUpdateInsideUpdate = false;
let currentlyProcessingQueue: SharedQueue | null = null;
export function resetCurrentlyProcessingQueue(): void {
  if (isDevelopment) {
    currentlyProcessingQueue = null;
  }
}

// The queue holds whatever state the fiber has (a class's state, the root's
// element): erased here, typed by the code that reads the state.
export function initializeUpdateQueue(fiber: Fiber): void {
  const queue = new UpdateQueue(fiber.memoizedState, null, null, new SharedQueue());
  fiber.updateQueue = queue;
}

export function cloneUpdateQueue(current: Fiber, workInProgress: Fiber): void {
  // Clone the update queue from current. Unless it's already a clone.
  const queue = workInProgress.updateQueue as UpdateQueue;
  const currentQueue = current.updateQueue as UpdateQueue;
  if (queue === currentQueue) {
    const clone = new UpdateQueue(
      currentQueue.baseState,
      currentQueue.firstBaseUpdate,
      currentQueue.lastBaseUpdate,
      currentQueue.shared,
    );
    workInProgress.updateQueue = clone;
  }
}

// A copy of an update for a rebased or captured list. `callback` is null when
// the copy must not fire the original's callback again.
function cloneUpdate(lane: Lane, tag: UpdateTag, payload: unknown, callback: (() => unknown) | null): Update {
  const clone = new Update(lane);
  clone.tag = tag;
  clone.payload = payload;
  clone.callback = callback;
  return clone;
}

export function createUpdate(lane: Lane): Update {
  return new Update(lane);
}

export function enqueueUpdate(fiber: Fiber, update: Update, lane: Lane): FiberRoot | null {
  const updateQueue = fiber.updateQueue as UpdateQueue | null;
  if (updateQueue === null) {
    // Only occurs if the fiber has been unmounted.
    return null;
  }

  const sharedQueue: SharedQueue = updateQueue.shared;

  if (isDevelopment) {
    if (currentlyProcessingQueue === sharedQueue && !didWarnUpdateInsideUpdate) {
      const componentName = getComponentNameFromFiber(fiber);
      console.error(
        "An update (setState, replaceState, or forceUpdate) was scheduled " +
          "from inside an update function. Update functions should be pure, " +
          "with zero side-effects. Consider using componentDidUpdate or a " +
          "callback.\n\nPlease update the following component: %s",
        componentName,
      );
      didWarnUpdateInsideUpdate = true;
    }
  }

  if (isUnsafeClassRenderPhaseUpdate(fiber)) {
    // This is an unsafe render phase update. Add directly to the update
    // queue so we can process it immediately during the current render.
    const pending = sharedQueue.pending;
    if (pending === null) {
      // This is the first update. Create a circular list.
      update.next = update;
    } else {
      update.next = pending.next;
      pending.next = update;
    }
    sharedQueue.pending = update;

    // Update the childLanes even though we're most likely already rendering
    // this fiber. This is for backwards compatibility in the case where you
    // update a different component during render phase than the one that is
    // currently renderings (a pattern that is accompanied by a warning).
    return unsafe_markUpdateLaneFromFiberToRoot(fiber, lane);
  } else {
    return enqueueConcurrentClassUpdate(fiber, sharedQueue, update, lane);
  }
}

export function entangleTransitions(root: FiberRoot, fiber: Fiber, lane: Lane): void {
  const updateQueue = fiber.updateQueue as UpdateQueue | null;
  if (updateQueue === null) {
    // Only occurs if the fiber has been unmounted.
    return;
  }

  const sharedQueue: SharedQueue = updateQueue.shared;
  if (isTransitionLane(lane)) {
    let queueLanes = sharedQueue.lanes;

    // If any entangled lanes are no longer pending on the root, then they must
    // have finished. We can remove them from the shared queue, which represents
    // a superset of the actually pending lanes. In some cases we may entangle
    // more than we need to, but that's OK. In fact it's worse if we *don't*
    // entangle when we should.
    queueLanes = intersectLanes(queueLanes, root.pendingLanes);

    // Entangle the new transition lane with the other transition lanes.
    const newQueueLanes = mergeLanes(queueLanes, lane);
    sharedQueue.lanes = newQueueLanes;
    // Even if queue.lanes already include lane, we don't know for certain if
    // the lane finished since the last time we entangled it. So we need to
    // entangle it again, just to be sure.
    markRootEntangled(root, newQueueLanes);
  }
}

export function enqueueCapturedUpdate(workInProgress: Fiber, capturedUpdate: Update): void {
  // Captured updates are updates that are thrown by a child during the render
  // phase. They should be discarded if the render is aborted. Therefore,
  // we should only put them on the work-in-progress queue, not the current one.
  let queue = workInProgress.updateQueue as UpdateQueue;

  // Check if the work-in-progress queue is a clone.
  const current = workInProgress.alternate;
  if (current !== null) {
    const currentQueue = current.updateQueue as UpdateQueue;
    if (queue === currentQueue) {
      // The work-in-progress queue is the same as current. This happens when
      // we bail out on a parent fiber that then captures an error thrown by
      // a child. Since we want to append the update only to the work-in
      // -progress queue, we need to clone the updates. We usually clone during
      // processUpdateQueue, but that didn't happen in this case because we
      // skipped over the parent when we bailed out.
      let newFirst: Update | null = null;
      let newLast: Update | null = null;
      const firstBaseUpdate = queue.firstBaseUpdate;
      if (firstBaseUpdate !== null) {
        // Loop through the updates and clone them.
        let update: Update | null = firstBaseUpdate;
        do {
          const clone = cloneUpdate(update.lane, update.tag, update.payload, null);
          if (newLast === null) {
            newFirst = newLast = clone;
          } else {
            newLast.next = clone;
            newLast = clone;
          }
          update = update.next;
        } while (update !== null);

        // Append the captured update the end of the cloned list.
        if (newLast === null) {
          newFirst = newLast = capturedUpdate;
        } else {
          newLast.next = capturedUpdate;
          newLast = capturedUpdate;
        }
      } else {
        // There are no base updates.
        newFirst = newLast = capturedUpdate;
      }
      queue = {
        baseState: currentQueue.baseState,
        firstBaseUpdate: newFirst,
        lastBaseUpdate: newLast,
        shared: currentQueue.shared,
        callbacks: currentQueue.callbacks,
      };
      workInProgress.updateQueue = queue;
      return;
    }
  }

  // Append the update to the end of the list.
  const lastBaseUpdate = queue.lastBaseUpdate;
  if (lastBaseUpdate === null) {
    queue.firstBaseUpdate = capturedUpdate;
  } else {
    lastBaseUpdate.next = capturedUpdate;
  }
  queue.lastBaseUpdate = capturedUpdate;
}

function callUpdater<State>(workInProgress: Fiber, payload: UpdaterFunction<State>, instance: unknown, prevState: State, nextProps: unknown): unknown {
  if (isDevelopment) {
    enterDisallowedContextReadInDEV();
  }
  const result = payload.call(instance, prevState, nextProps);
  if (isDevelopment) {
    if (workInProgress.mode & StrictLegacyMode) {
      setIsStrictModeForDevtools(true);
      try {
        payload.call(instance, prevState, nextProps);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
    exitDisallowedContextReadInDEV();
  }
  return result;
}

function getStateFromUpdate<State>(
  workInProgress: Fiber,
  _queue: UpdateQueue,
  update: Update,
  prevState: State,
  nextProps: unknown,
  instance: unknown,
): State {
  switch (update.tag) {
    case ReplaceState: {
      const payload = update.payload;
      if (typeof payload === "function") {
        // Updater function
        return callUpdater(workInProgress, payload as UpdaterFunction<State>, instance, prevState, nextProps) as State;
      }
      // State object
      return payload as State;
    }
    case CaptureUpdate:
    case UpdateState: {
      if (update.tag === CaptureUpdate) {
        workInProgress.flags = (workInProgress.flags & ~ShouldCapture) | DidCapture;
      }
      const payload = update.payload;
      let partialState: unknown;
      if (typeof payload === "function") {
        // Updater function
        partialState = callUpdater(workInProgress, payload as UpdaterFunction<State>, instance, prevState, nextProps);
      } else {
        // Partial state object
        partialState = payload;
      }
      if (partialState === null || partialState === undefined) {
        // Null and undefined are treated as no-ops.
        return prevState;
      }
      // Merge the partial state and the previous state.
      return mergeState(workInProgress.type, prevState, partialState) as State;
    }
    case ForceUpdate: {
      hasForceUpdate = true;
      return prevState;
    }
  }
  return prevState;
}

let didReadFromEntangledAsyncAction: boolean = false;

// Each call to processUpdateQueue should be accompanied by a call to this. It's
// only in a separate function because in updateHostRoot, it must happen after
// all the context stacks have been pushed to, to prevent a stack mismatch. A
// bit unfortunate.
export function suspendIfUpdateReadFromEntangledAsyncAction(): void {
  // Check if this update is part of a pending async action. If so, we'll
  // need to suspend until the action has finished, so that it's batched
  // together with future updates in the same action.
  // TODO: Once we support hooks inside useMemo (or an equivalent
  // memoization boundary like Forget), hoist this logic so that it only
  // suspends if the memo boundary produces a new value.
  if (didReadFromEntangledAsyncAction) {
    const entangledActionThenable = peekEntangledActionThenable();
    if (entangledActionThenable !== null) {
      // TODO: Instead of the throwing the thenable directly, throw a
      // special object like `use` does so we can detect if it's captured
      // by userspace.
      throw entangledActionThenable;
    }
  }
}

export function processUpdateQueue(workInProgress: Fiber, props: unknown, instance: unknown, renderLanes: Lanes): void {
  didReadFromEntangledAsyncAction = false;

  // This is always non-null on a ClassComponent or HostRoot
  const queue = workInProgress.updateQueue as UpdateQueue;

  hasForceUpdate = false;

  if (isDevelopment) {
    currentlyProcessingQueue = queue.shared as SharedQueue;
  }

  let firstBaseUpdate = queue.firstBaseUpdate;
  let lastBaseUpdate = queue.lastBaseUpdate;

  // Check if there are pending updates. If so, transfer them to the base queue.
  let pendingQueue = queue.shared.pending;
  if (pendingQueue !== null) {
    queue.shared.pending = null;

    // The pending queue is circular. Disconnect the pointer between first
    // and last so that it's non-circular.
    const lastPendingUpdate = pendingQueue;
    const firstPendingUpdate = lastPendingUpdate.next;
    lastPendingUpdate.next = null;
    // Append pending updates to base queue
    if (lastBaseUpdate === null) {
      firstBaseUpdate = firstPendingUpdate;
    } else {
      lastBaseUpdate.next = firstPendingUpdate;
    }
    lastBaseUpdate = lastPendingUpdate;

    // If there's a current queue, and it's different from the base queue, then
    // we need to transfer the updates to that queue, too. Because the base
    // queue is a singly-linked list with no cycles, we can append to both
    // lists and take advantage of structural sharing.
    // TODO: Pass `current` as argument
    const current = workInProgress.alternate;
    if (current !== null) {
      // This is always non-null on a ClassComponent or HostRoot
      const currentQueue = current.updateQueue as UpdateQueue;
      const currentLastBaseUpdate = currentQueue.lastBaseUpdate;
      if (currentLastBaseUpdate !== lastBaseUpdate) {
        if (currentLastBaseUpdate === null) {
          currentQueue.firstBaseUpdate = firstPendingUpdate;
        } else {
          currentLastBaseUpdate.next = firstPendingUpdate;
        }
        currentQueue.lastBaseUpdate = lastPendingUpdate;
      }
    }
  }

  // These values may change as we process the queue.
  if (firstBaseUpdate !== null) {
    // Iterate through the list of updates to compute the result.
    let newState = queue.baseState;
    // TODO: Don't need to accumulate this. Instead, we can remove renderLanes
    // from the original lanes.
    let newLanes: Lanes = NoLanes;

    let newBaseState: unknown = null;
    let newFirstBaseUpdate = null as Update | null;
    let newLastBaseUpdate = null as Update | null;

    let update: Update = firstBaseUpdate;
    for (;;) {
      // An extra OffscreenLane bit is added to updates that were made to
      // a hidden tree, so that we can distinguish them from updates that were
      // already there when the tree was hidden.
      const updateLane = removeLanes(update.lane, OffscreenLane);
      const isHiddenUpdate = updateLane !== update.lane;

      // Check if this update was made while the tree was hidden. If so, then
      // it's not a "base" update and we should disregard the extra base lanes
      // that were added to renderLanes when we entered the Offscreen tree.
      const shouldSkipUpdate = isHiddenUpdate
        ? !isSubsetOfLanes(getWorkInProgressRootRenderLanes(), updateLane)
        : !isSubsetOfLanes(renderLanes, updateLane);

      if (shouldSkipUpdate) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        const clone = cloneUpdate(updateLane, update.tag, update.payload, update.callback);
        if (newLastBaseUpdate === null) {
          newFirstBaseUpdate = newLastBaseUpdate = clone;
          newBaseState = newState;
        } else {
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }
        // Update the remaining priority in the queue.
        newLanes = mergeLanes(newLanes, updateLane);
      } else {
        // This update does have sufficient priority.

        // Check if this update is part of a pending async action. If so,
        // we'll need to suspend until the action has finished, so that it's
        // batched together with future updates in the same action.
        if (updateLane !== NoLane && updateLane === peekEntangledActionLane()) {
          didReadFromEntangledAsyncAction = true;
        }

        if (newLastBaseUpdate !== null) {
          const clone = cloneUpdate(NoLane, update.tag, update.payload, null);
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }

        // Process this update.
        newState = getStateFromUpdate(workInProgress, queue, update, newState, props, instance);
        const callback = update.callback;
        if (callback !== null) {
          workInProgress.flags |= Callback;
          if (isHiddenUpdate) {
            workInProgress.flags |= Visibility;
          }
          const callbacks = queue.callbacks;
          if (callbacks === null) {
            queue.callbacks = [callback];
          } else {
            callbacks.push(callback);
          }
        }
      }
      const next: Update | null = update.next;
      if (next !== null) {
        update = next;
        continue;
      }
      pendingQueue = queue.shared.pending;
      if (pendingQueue === null) {
        break;
      }
      // An update was scheduled from inside a reducer. Add the new
      // pending updates to the end of the list and keep processing.
      const lastPendingUpdate = pendingQueue;
      // Intentionally unsound. Pending updates form a circular list, but we
      // unravel them when transferring them to the base queue.
      const firstPendingUpdate = lastPendingUpdate.next as Update;
      lastPendingUpdate.next = null;
      update = firstPendingUpdate;
      queue.lastBaseUpdate = lastPendingUpdate;
      queue.shared.pending = null;
    }

    if (newLastBaseUpdate === null) {
      newBaseState = newState;
    }

    queue.baseState = newBaseState;
    queue.firstBaseUpdate = newFirstBaseUpdate;
    queue.lastBaseUpdate = newLastBaseUpdate;

    // Upstream compares `firstBaseUpdate === null` here, which cannot hold in
    // this branch, so `queue.shared.lanes` is never reset by it. Kept as is.

    // Set the remaining expiration time to be whatever is remaining in the queue.
    // This should be fine because the only two other things that contribute to
    // expiration time are props and context. We're already in the middle of the
    // begin phase by the time we start processing the queue, so we've already
    // dealt with the props. Context in components that specify
    // shouldComponentUpdate is tricky; but we'll have to account for
    // that regardless.
    markSkippedUpdateLanes(newLanes);
    workInProgress.lanes = newLanes;
    workInProgress.memoizedState = newState;
  }

  if (isDevelopment) {
    currentlyProcessingQueue = null;
  }
}

function callCallback(callback: unknown, context: unknown): void {
  if (typeof callback !== "function") {
    throw new Error(
      "Invalid argument passed as callback. Expected a function. Instead " + `received: ${String(callback)}`,
    );
  }

  (callback as (this: unknown) => unknown).call(context);
}

export function resetHasForceUpdateBeforeProcessing(): void {
  hasForceUpdate = false;
}

export function checkHasForceUpdateAfterProcessing(): boolean {
  return hasForceUpdate;
}

export function deferHiddenCallbacks(updateQueue: UpdateQueue): void {
  // When an update finishes on a hidden component, its callback should not
  // be fired until/unless the component is made visible again. Stash the
  // callback on the shared queue object so it can be fired later.
  const newHiddenCallbacks = updateQueue.callbacks;
  if (newHiddenCallbacks !== null) {
    const existingHiddenCallbacks = updateQueue.shared.hiddenCallbacks;
    if (existingHiddenCallbacks === null) {
      updateQueue.shared.hiddenCallbacks = newHiddenCallbacks;
    } else {
      updateQueue.shared.hiddenCallbacks = existingHiddenCallbacks.concat(newHiddenCallbacks);
    }
  }
}

export function commitHiddenCallbacks(updateQueue: UpdateQueue, context: unknown): void {
  // This component is switching from hidden -> visible. Commit any callbacks
  // that were previously deferred.
  const hiddenCallbacks = updateQueue.shared.hiddenCallbacks;
  if (hiddenCallbacks !== null) {
    updateQueue.shared.hiddenCallbacks = null;
    for (let i = 0; i < hiddenCallbacks.length; i++) {
      const callback = hiddenCallbacks[i];
      callCallback(callback, context);
    }
  }
}

export function commitCallbacks(updateQueue: UpdateQueue, context: unknown): void {
  const callbacks = updateQueue.callbacks;
  if (callbacks !== null) {
    updateQueue.callbacks = null;
    for (let i = 0; i < callbacks.length; i++) {
      const callback = callbacks[i];
      callCallback(callback, context);
    }
  }
}

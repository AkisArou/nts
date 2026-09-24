// The commit phase's view transition work: naming host instances below
// <ViewTransition> boundaries for enter, exit, update and shared-element
// pairs, measuring them to decide what actually animates, and restoring the
// names afterwards.
//
// Port of upstream's ReactFiberCommitViewTransitions.js (stable channel).
// enableGestureTransition is off, so the gesture event paths are not ported;
// the `gesture` parameters stay for upstream's signatures and are false in
// every stable caller.

import type { Instance, InstanceMeasurement, Props } from "./ReactFiberConfig.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import type { ViewTransitionProps, ViewTransitionState } from "./ReactFiberViewTransitionComponent.ts";

import { HostComponent, OffscreenComponent, ViewTransitionComponent } from "./ReactWorkTags.ts";
import {
  AffectedParentLayout,
  NoFlags,
  Update,
  ViewTransitionNamedStatic,
  ViewTransitionStatic,
  ViewTransitionStaticParent,
} from "./ReactFiberFlags.ts";
import {
  applyViewTransitionName,
  hasInstanceAffectedParent,
  hasInstanceChanged,
  measureClonedInstance,
  measureInstance,
  restoreViewTransitionName,
  supportsMutation,
  wasInstanceInViewport,
} from "./ReactFiberConfig.ts";
import { scheduleViewTransitionEvent } from "./ReactFiberWorkLoop.ts";
import { getViewTransitionClassName, getViewTransitionName } from "./ReactFiberViewTransitionComponent.ts";
import { trackAnimatingTask } from "./ReactProfilerTimer.ts";
import {
  enableComponentPerformanceTrack,
  enableProfilerTimer,
  enableViewTransitionForPersistenceMode,
  enableViewTransitionParentEnterExit,
} from "shared/ReactFeatureFlags.ts";

// A view-transition class name: a name, or none when it is null or
// undefined (getViewTransitionClassName returns both).
type ClassName = string | null | undefined;

export let shouldStartViewTransition = false;

export function resetShouldStartViewTransition(): void {
  shouldStartViewTransition = false;
}

// This tracks named ViewTransition components found in the
// accumulateSuspenseyCommit phase that might need to find deleted pairs in
// the beforeMutation phase.
export let appearingViewTransitions: Map<string, ViewTransitionState> | null = null;

export function resetAppearingViewTransitions(): void {
  appearingViewTransitions = null;
}

export function trackAppearingViewTransition(name: string, state: ViewTransitionState): void {
  if (appearingViewTransitions === null) {
    appearingViewTransitions = new Map();
  }
  appearingViewTransitions.set(name, state);
}

export function trackEnterViewTransitions(placement: Fiber): void {
  if (placement.tag === ViewTransitionComponent || (placement.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    // If an inserted or appearing Fiber is a ViewTransition component or has
    // one as an immediate child, then that will trigger as an "Enter" in
    // future passes. We don't do anything else for that case in the "before
    // mutation" phase but we still have to mark it as needing to call
    // startViewTransition if nothing else updates.
    shouldStartViewTransition = true;
  }
}

// We can't cancel view transition children until we know that their parent
// also don't need to transition. A tupled array where each entry is
// [instance: Instance, oldName: string, props: Props].
export let viewTransitionCancelableChildren: (Instance | string | Props)[] | null = null;

export function pushViewTransitionCancelableScope(): (Instance | string | Props)[] | null {
  const prevChildren = viewTransitionCancelableChildren;
  viewTransitionCancelableChildren = null;
  return prevChildren;
}

export function popViewTransitionCancelableScope(prevChildren: (Instance | string | Props)[] | null): void {
  viewTransitionCancelableChildren = prevChildren;
}

let viewTransitionHostInstanceIdx = 0;

// The name of the idx-th host instance below a boundary: the boundary's name,
// with a suffix for every instance after the first so each one is unique.
function nameForHostInstance(name: string, idx: number): string {
  return idx === 0 ? name : name + "_" + idx;
}

function applyViewTransitionToHostInstances(
  fiber: Fiber,
  name: string,
  className: ClassName,
  collectMeasurements: InstanceMeasurement[] | null,
  stopAtNestedViewTransitions: boolean,
): boolean {
  viewTransitionHostInstanceIdx = 0;
  const inViewport = applyViewTransitionToHostInstancesRecursive(
    fiber.child,
    name,
    className,
    collectMeasurements,
    stopAtNestedViewTransitions,
  );
  if (enableProfilerTimer && enableComponentPerformanceTrack && inViewport) {
    if (fiber._debugTask != null) {
      trackAnimatingTask(fiber._debugTask);
    }
  }
  return inViewport;
}

function applyViewTransitionToHostInstancesRecursive(
  child: Fiber | null,
  name: string,
  className: ClassName,
  collectMeasurements: InstanceMeasurement[] | null,
  stopAtNestedViewTransitions: boolean,
): boolean {
  if (!supportsMutation) {
    if (enableViewTransitionForPersistenceMode) {
      while (child !== null) {
        if (child.tag === HostComponent) {
          const instance = child.stateNode as Instance;
          // TODO: calculate whether component is in viewport
          shouldStartViewTransition = true;
          applyViewTransitionName(instance, nameForHostInstance(name, viewTransitionHostInstanceIdx), className ?? null);
          viewTransitionHostInstanceIdx++;
        } else if (child.tag === OffscreenComponent && child.memoizedState !== null) {
          // Skip any hidden subtrees. They were or are effectively not there.
        } else if (child.tag === ViewTransitionComponent && stopAtNestedViewTransitions) {
          // Skip any nested view transitions for updates since in that case
          // the inner most one is the one that handles the update.
        } else {
          applyViewTransitionToHostInstancesRecursive(
            child.child,
            name,
            className,
            collectMeasurements,
            stopAtNestedViewTransitions,
          );
        }
        child = child.sibling;
      }
      return true;
    } else {
      return false;
    }
  }
  let inViewport = false;
  while (child !== null) {
    if (child.tag === HostComponent) {
      const instance = child.stateNode as Instance;
      if (collectMeasurements !== null) {
        const measurement = measureInstance(instance);
        collectMeasurements.push(measurement);
        if (wasInstanceInViewport(measurement)) {
          inViewport = true;
        }
      } else if (!inViewport) {
        if (wasInstanceInViewport(measureInstance(instance))) {
          inViewport = true;
        }
      }
      shouldStartViewTransition = true;
      applyViewTransitionName(instance, nameForHostInstance(name, viewTransitionHostInstanceIdx), className ?? null);
      viewTransitionHostInstanceIdx++;
    } else if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // Skip any hidden subtrees. They were or are effectively not there.
    } else if (child.tag === ViewTransitionComponent && stopAtNestedViewTransitions) {
      // Skip any nested view transitions for updates since in that case the
      // inner most one is the one that handles the update.
    } else {
      if (
        applyViewTransitionToHostInstancesRecursive(
          child.child,
          name,
          className,
          collectMeasurements,
          stopAtNestedViewTransitions,
        )
      ) {
        inViewport = true;
      }
    }
    child = child.sibling;
  }
  return inViewport;
}

function restoreViewTransitionOnHostInstances(child: Fiber | null, stopAtNestedViewTransitions: boolean): void {
  if (!supportsMutation) {
    return;
  }
  while (child !== null) {
    if (child.tag === HostComponent) {
      const instance = child.stateNode as Instance;
      restoreViewTransitionName(instance, child.memoizedProps as Props);
    } else if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // Skip any hidden subtrees. They were or are effectively not there.
    } else if (child.tag === ViewTransitionComponent && stopAtNestedViewTransitions) {
      // Skip any nested view transitions for updates since in that case the
      // inner most one is the one that handles the update.
    } else {
      restoreViewTransitionOnHostInstances(child.child, stopAtNestedViewTransitions);
    }
    child = child.sibling;
  }
}

function commitAppearingPairViewTransitions(placement: Fiber): void {
  if ((placement.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // This has no named view transitions in its subtree.
    return;
  }
  let child = placement.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // This tree was already hidden so we skip it.
    } else {
      commitAppearingPairViewTransitions(child);
      if (child.tag === ViewTransitionComponent && (child.flags & ViewTransitionNamedStatic) !== NoFlags) {
        const instance = child.stateNode as ViewTransitionState;
        if (instance.paired) {
          const props = child.memoizedProps as ViewTransitionProps;
          if (props.name == null || props.name === "auto") {
            throw new Error("Found a pair with an auto name. This is a bug in React.");
          }
          const name = props.name;
          const className = getViewTransitionClassName(props.default, props.share);
          if (className !== "none") {
            // We found a new appearing view transition with the same name as
            // this deletion. We'll transition between them.
            const inViewport = applyViewTransitionToHostInstances(child, name, className, null, false);
            if (!inViewport) {
              // This boundary is exiting within the viewport but is going to
              // leave the viewport. Instead, we treat this as an exit of the
              // previous entry by reverting the new name. Ideally we could
              // undo the old transition but it's now too late. It's also on
              // its on snapshot. We have know was for it to paint onto the
              // original group.
              // TODO: This will lead to things unexpectedly having exit
              // animations that normally wouldn't happen. Consider if we
              // should just let this fly off the screen instead.
              restoreViewTransitionOnHostInstances(child.child, false);
            }
          }
        }
      }
    }
    child = child.sibling;
  }
}

export function commitParentEnterViewTransitions(parent: Fiber, gesture: boolean): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // Skip hidden subtrees.
    } else if (child.tag === ViewTransitionComponent) {
      const props = child.memoizedProps as ViewTransitionProps;
      const hasParentClass = props.parentEnter !== undefined;
      // enableGestureTransition: gesture handlers are not ported.
      const hasParentHandler = gesture ? false : props.onParentEnter != null;
      if (hasParentClass || hasParentHandler) {
        let relay = true;
        if (hasParentClass) {
          const state = child.stateNode as ViewTransitionState;
          const name = getViewTransitionName(props, state);
          const className = getViewTransitionClassName(props.default, props.parentEnter);
          if (className === "none") {
            relay = false;
          } else {
            applyViewTransitionToHostInstances(child, name, className, null, false);
            if (hasParentHandler) {
              scheduleViewTransitionEvent(child, props.onParentEnter);
            }
          }
        } else {
          scheduleViewTransitionEvent(child, props.onParentEnter);
        }
        if (relay) {
          commitParentEnterViewTransitions(child, gesture);
        }
      }
    } else if ((child.subtreeFlags & ViewTransitionStaticParent) !== NoFlags) {
      commitParentEnterViewTransitions(child, gesture);
    }
    child = child.sibling;
  }
}

export function commitParentExitViewTransitions(parent: Fiber, gesture: boolean): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // Skip hidden subtrees.
    } else if (child.tag === ViewTransitionComponent) {
      const props = child.memoizedProps as ViewTransitionProps;
      const hasParentClass = props.parentExit !== undefined;
      // enableGestureTransition: gesture handlers are not ported.
      const hasParentHandler = gesture ? false : props.onParentExit != null;
      if (hasParentClass || hasParentHandler) {
        let relay = true;
        if (hasParentClass) {
          const state = child.stateNode as ViewTransitionState;
          const name = getViewTransitionName(props, state);
          const className = getViewTransitionClassName(props.default, props.parentExit);
          if (className === "none") {
            relay = false;
          } else {
            applyViewTransitionToHostInstances(child, name, className, null, false);
            if (hasParentHandler) {
              scheduleViewTransitionEvent(child, props.onParentExit);
            }
          }
        } else {
          scheduleViewTransitionEvent(child, props.onParentExit);
        }
        if (relay) {
          commitParentExitViewTransitions(child, gesture);
        }
      }
    } else if ((child.subtreeFlags & ViewTransitionStaticParent) !== NoFlags) {
      commitParentExitViewTransitions(child, gesture);
    }
    child = child.sibling;
  }
}

function restoreParentEnterOrExitViewTransitions(parent: Fiber): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // Skip hidden subtrees.
    } else if (child.tag === ViewTransitionComponent) {
      const props = child.memoizedProps as ViewTransitionProps;
      const hasParentClass = props.parentEnter !== undefined || props.parentExit !== undefined;
      // enableGestureTransition: gesture handlers are not ported.
      const hasParentHandler = props.onParentEnter != null || props.onParentExit != null;
      if (hasParentClass) {
        restoreViewTransitionOnHostInstances(child.child, false);
      }
      if (hasParentClass || hasParentHandler) {
        restoreParentEnterOrExitViewTransitions(child);
      }
    } else if ((child.subtreeFlags & ViewTransitionStaticParent) !== NoFlags) {
      restoreParentEnterOrExitViewTransitions(child);
    }
    child = child.sibling;
  }
}

export function commitEnterViewTransitions(placement: Fiber, gesture: boolean): void {
  if (placement.tag === ViewTransitionComponent) {
    const state = placement.stateNode as ViewTransitionState;
    const props = placement.memoizedProps as ViewTransitionProps;
    const name = getViewTransitionName(props, state);
    const className = getViewTransitionClassName(props.default, state.paired ? props.share : props.enter);
    if (className !== "none") {
      const inViewport = applyViewTransitionToHostInstances(placement, name, className, null, false);
      if (!inViewport) {
        // TODO: If this was part of a pair we will still run the onShare
        // callback. Revert the transition names. This boundary is not in the
        // viewport so we won't bother animating it.
        restoreViewTransitionOnHostInstances(placement.child, false);
        // TODO: Should we still visit the children in case a named one was
        // in the viewport?
      } else {
        commitAppearingPairViewTransitions(placement);

        if (!state.paired) {
          // enableGestureTransition: the gesture event is not ported.
          if (!gesture) {
            scheduleViewTransitionEvent(placement, props.onEnter);
          }
          if (enableViewTransitionParentEnterExit) {
            commitParentEnterViewTransitions(placement, gesture);
          }
        }
      }
    } else {
      commitAppearingPairViewTransitions(placement);
    }
  } else if ((placement.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = placement.child;
    while (child !== null) {
      commitEnterViewTransitions(child, gesture);
      child = child.sibling;
    }
  } else {
    commitAppearingPairViewTransitions(placement);
  }
}

function commitDeletedPairViewTransitions(deletion: Fiber): void {
  if (appearingViewTransitions === null || appearingViewTransitions.size === 0) {
    // We've found all.
    return;
  }
  const pairs = appearingViewTransitions;
  if ((deletion.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // This has no named view transitions in its subtree.
    return;
  }
  let child = deletion.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // This tree was already hidden so we skip it.
    } else {
      if (child.tag === ViewTransitionComponent && (child.flags & ViewTransitionNamedStatic) !== NoFlags) {
        const props = child.memoizedProps as ViewTransitionProps;
        const name = props.name;
        if (name != null && name !== "auto") {
          const pair = pairs.get(name);
          if (pair !== undefined) {
            const className = getViewTransitionClassName(props.default, props.share);
            if (className !== "none") {
              // We found a new appearing view transition with the same name as
              // this deletion.
              const inViewport = applyViewTransitionToHostInstances(child, name, className, null, false);
              if (!inViewport) {
                // This boundary is not in the viewport so we won't treat it as
                // a matched pair. Revert the transition names. This avoids it
                // flying onto the screen which can be disruptive and doesn't
                // really preserve any continuity anyway.
                restoreViewTransitionOnHostInstances(child.child, false);
              } else {
                // We'll transition between them.
                const oldInstance = child.stateNode as ViewTransitionState;
                const newInstance: ViewTransitionState = pair;
                newInstance.paired = oldInstance;
                oldInstance.paired = newInstance;
                // Note: If the other side ends up outside the viewport, we'll
                // still run this. Therefore it's possible for onShare to be
                // called with only an old snapshot.
                scheduleViewTransitionEvent(child, props.onShare);
              }
            }
            // Delete the entry so that we know when we've found all of them
            // and can stop searching (size reaches zero).
            pairs.delete(name);
            if (pairs.size === 0) {
              break;
            }
          }
        }
      }
      commitDeletedPairViewTransitions(child);
    }
    child = child.sibling;
  }
}

export function commitExitViewTransitions(deletion: Fiber): void {
  if (deletion.tag === ViewTransitionComponent) {
    const props = deletion.memoizedProps as ViewTransitionProps;
    const name = getViewTransitionName(props, deletion.stateNode as ViewTransitionState);
    const pair = appearingViewTransitions !== null ? appearingViewTransitions.get(name) : undefined;
    const className = getViewTransitionClassName(props.default, pair !== undefined ? props.share : props.exit);
    if (className !== "none") {
      const inViewport = applyViewTransitionToHostInstances(deletion, name, className, null, false);
      if (!inViewport) {
        // Revert the transition names. This boundary is not in the viewport
        // so we won't bother animating it.
        restoreViewTransitionOnHostInstances(deletion.child, false);
        // TODO: Should we still visit the children in case a named one was
        // in the viewport?
      } else if (pair !== undefined) {
        // We found a new appearing view transition with the same name as this
        // deletion. We'll transition between them instead of running the
        // normal exit.
        const oldInstance = deletion.stateNode as ViewTransitionState;
        const newInstance: ViewTransitionState = pair;
        newInstance.paired = oldInstance;
        oldInstance.paired = newInstance;
        // Delete the entry so that we know when we've found all of them and
        // can stop searching (size reaches zero).
        appearingViewTransitions!.delete(name);
        // Note: If the other side ends up outside the viewport, we'll still
        // run this. Therefore it's possible for onShare to be called with
        // only an old snapshot.
        scheduleViewTransitionEvent(deletion, props.onShare);
      } else {
        scheduleViewTransitionEvent(deletion, props.onExit);
        if (enableViewTransitionParentEnterExit) {
          commitParentExitViewTransitions(deletion, false);
        }
      }
    }
    if (appearingViewTransitions !== null) {
      // Look for more pairs deeper in the tree.
      commitDeletedPairViewTransitions(deletion);
    }
  } else if ((deletion.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = deletion.child;
    while (child !== null) {
      commitExitViewTransitions(child);
      child = child.sibling;
    }
  } else {
    if (appearingViewTransitions !== null) {
      commitDeletedPairViewTransitions(deletion);
    }
  }
}

export function commitBeforeUpdateViewTransition(current: Fiber, finishedWork: Fiber): void {
  // The way we deal with multiple HostInstances as children of a View
  // Transition in an update can get tricky. The important bit is that if you
  // swap out n HostInstances from n HostInstances then they match up in
  // order. Similarly, if you don't swap any HostInstances each instance just
  // transitions as is.
  //
  // We call this function twice. First we apply the view transition names on
  // the "current" tree in the snapshot phase. Then in the mutation phase we
  // apply view transition names to the "finishedWork" tree.
  //
  // This means that if there were insertions or deletions before an updated
  // Instance that same Instance might get different names in the "old" and
  // the "new" state. For example if you swap two HostInstances inside a
  // ViewTransition they don't animate to swap position but rather cross-fade
  // into the other instance. This might be unexpected but it is in line with
  // the semantics that the ViewTransition is its own layer that cross-fades
  // its content when it updates. If you want to reorder then each child needs
  // its own ViewTransition.
  const oldProps = current.memoizedProps as ViewTransitionProps;
  const oldName = getViewTransitionName(oldProps, current.stateNode as ViewTransitionState);
  const newProps = finishedWork.memoizedProps as ViewTransitionProps;
  // This className applies only if there are fewer child DOM nodes than
  // before or if this update should've been cancelled but we ended up with a
  // parent animating so we need to animate the child too. For example, if
  // update="foo" layout="none" and it turns out this was a layout only
  // change, then the "foo" class will be applied even though it was not
  // actually an update. Which is a bug.
  const className = getViewTransitionClassName(newProps.default, newProps.update);
  if (className === "none") {
    // If update is "none" then we don't have to apply a name. Since we won't
    // animate this boundary.
    return;
  }
  // The measurements are stashed on the current fiber's memoizedState until
  // the after mutation phase reads them.
  const measurements: InstanceMeasurement[] = [];
  current.memoizedState = measurements;
  applyViewTransitionToHostInstances(current, oldName, className, measurements, true);
}

export function commitNestedViewTransitions(changedParent: Fiber): void {
  let child = changedParent.child;
  while (child !== null) {
    if (child.tag === ViewTransitionComponent) {
      // In this case the outer ViewTransition component wins but if there was
      // an update through this component then the inner one wins.
      const props = child.memoizedProps as ViewTransitionProps;
      const name = getViewTransitionName(props, child.stateNode as ViewTransitionState);
      const className = getViewTransitionClassName(props.default, props.update);
      // "Nested" view transitions are in subtrees that didn't update so this
      // is a "current". We normally clear this upon rerendering but we use
      // this flag to track changes from layout in the commit. So we need it
      // to be cleared before we do that.
      // TODO: Use some other temporary state to track this.
      child.flags &= ~Update;
      if (className !== "none") {
        const measurements: InstanceMeasurement[] = [];
        child.memoizedState = measurements;
        applyViewTransitionToHostInstances(child, name, className, measurements, false);
      }
    } else if ((child.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
      commitNestedViewTransitions(child);
    }
    child = child.sibling;
  }
}

function restorePairedViewTransitions(parent: Fiber): void {
  if ((parent.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // This has no named view transitions in its subtree.
    return;
  }
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // This tree was already hidden so we skip it.
    } else {
      if (child.tag === ViewTransitionComponent && (child.flags & ViewTransitionNamedStatic) !== NoFlags) {
        const instance = child.stateNode as ViewTransitionState;
        if (instance.paired !== null) {
          instance.paired = null;
          restoreViewTransitionOnHostInstances(child.child, false);
        }
      }
      restorePairedViewTransitions(child);
    }
    child = child.sibling;
  }
}

export function restoreEnterOrExitViewTransitions(fiber: Fiber): void {
  if (fiber.tag === ViewTransitionComponent) {
    const instance = fiber.stateNode as ViewTransitionState;
    instance.paired = null;
    restoreViewTransitionOnHostInstances(fiber.child, false);
    if (enableViewTransitionParentEnterExit) {
      restoreParentEnterOrExitViewTransitions(fiber);
    }
    restorePairedViewTransitions(fiber);
  } else if ((fiber.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = fiber.child;
    while (child !== null) {
      restoreEnterOrExitViewTransitions(child);
      child = child.sibling;
    }
  } else {
    restorePairedViewTransitions(fiber);
  }
}

export function restoreUpdateViewTransition(current: Fiber, finishedWork: Fiber): void {
  restoreViewTransitionOnHostInstances(current.child, true);
  restoreViewTransitionOnHostInstances(finishedWork.child, true);
}

export function restoreUpdateViewTransitionForGesture(current: Fiber, _finishedWork: Fiber): void {
  // For gestures we don't need to reset "finishedWork" because those would
  // have all been clones that got deleted.
  restoreViewTransitionOnHostInstances(current.child, true);
}

export function restoreNestedViewTransitions(changedParent: Fiber): void {
  let child = changedParent.child;
  while (child !== null) {
    if (child.tag === ViewTransitionComponent) {
      restoreViewTransitionOnHostInstances(child.child, false);
    } else if ((child.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
      restoreNestedViewTransitions(child);
    }
    child = child.sibling;
  }
}

export function measureViewTransitionHostInstances(
  parentViewTransition: Fiber,
  child: Fiber | null,
  newName: string,
  oldName: string,
  className: ClassName,
  previousMeasurements: InstanceMeasurement[] | null,
  stopAtNestedViewTransitions: boolean,
): boolean {
  viewTransitionHostInstanceIdx = 0;
  return measureViewTransitionHostInstancesRecursive(
    parentViewTransition,
    child,
    newName,
    oldName,
    className,
    previousMeasurements,
    stopAtNestedViewTransitions,
  );
}

function measureViewTransitionHostInstancesRecursive(
  parentViewTransition: Fiber,
  child: Fiber | null,
  newName: string,
  oldName: string,
  className: ClassName,
  previousMeasurements: InstanceMeasurement[] | null,
  stopAtNestedViewTransitions: boolean,
): boolean {
  if (!supportsMutation) {
    if (enableViewTransitionForPersistenceMode) {
      while (child !== null) {
        if (child.tag === HostComponent) {
          const instance = child.stateNode as Instance;
          if (previousMeasurements == null || viewTransitionHostInstanceIdx >= previousMeasurements.length) {
            // If there was an insertion of extra nodes, we have to assume
            // they affected the parent. It should have already been marked as
            // an Update due to the mutation.
            parentViewTransition.flags |= AffectedParentLayout;
          }
          // TODO: check if instance is out of viewport
          if ((parentViewTransition.flags & Update) !== NoFlags) {
            applyViewTransitionName(
              instance,
              nameForHostInstance(newName, viewTransitionHostInstanceIdx),
              className ?? null,
            );
          }
          // TODO: cancel transition by pushing into
          // viewTransitionCancelableChildren
          viewTransitionHostInstanceIdx++;
        } else if (child.tag === OffscreenComponent && child.memoizedState !== null) {
          // Skip any hidden subtrees. They were or are effectively not there.
        } else if (child.tag === ViewTransitionComponent && stopAtNestedViewTransitions) {
          // Skip any nested view transitions for updates since in that case
          // the inner most one is the one that handles the update. If this
          // inner boundary resized we need to bubble that information up.
          parentViewTransition.flags |= child.flags & AffectedParentLayout;
        } else {
          measureViewTransitionHostInstancesRecursive(
            parentViewTransition,
            child.child,
            newName,
            oldName,
            className,
            previousMeasurements,
            stopAtNestedViewTransitions,
          );
        }
        child = child.sibling;
      }
      return true;
    } else {
      return false;
    }
  }
  let inViewport = false;
  while (child !== null) {
    if (child.tag === HostComponent) {
      const instance = child.stateNode as Instance;
      if (previousMeasurements !== null && viewTransitionHostInstanceIdx < previousMeasurements.length) {
        // The previous measurement of the Instance in this location within
        // the ViewTransition. Note that this might not be the same exact
        // Instance if the Instances within the ViewTransition changed.
        const previousMeasurement = previousMeasurements[viewTransitionHostInstanceIdx];
        const nextMeasurement = measureInstance(instance);
        if (wasInstanceInViewport(previousMeasurement) || wasInstanceInViewport(nextMeasurement)) {
          // If either the old or new state was within the viewport we have
          // to animate this. But if it turns out that none of them were we'll
          // be able to skip it.
          inViewport = true;
        }
        if (
          (parentViewTransition.flags & Update) === NoFlags &&
          hasInstanceChanged(previousMeasurement, nextMeasurement)
        ) {
          parentViewTransition.flags |= Update;
        }
        if (hasInstanceAffectedParent(previousMeasurement, nextMeasurement)) {
          // If this instance size within its parent has changed it might have
          // caused the parent to relayout which needs a cross fade.
          parentViewTransition.flags |= AffectedParentLayout;
        }
      } else {
        // If there was an insertion of extra nodes, we have to assume they
        // affected the parent. It should have already been marked as an
        // Update due to the mutation.
        parentViewTransition.flags |= AffectedParentLayout;
      }
      if ((parentViewTransition.flags & Update) !== NoFlags) {
        // We might update this node so we need to apply its new name for the
        // new state. Additionally in the ApplyGesture case we also need to do
        // this because the clone will have the name but this one won't.
        applyViewTransitionName(instance, nameForHostInstance(newName, viewTransitionHostInstanceIdx), className ?? null);
      }
      if (!inViewport || (parentViewTransition.flags & Update) === NoFlags) {
        // It turns out that we had no other deeper mutations, the child
        // transitions didn't affect the parent layout and this instance
        // hasn't changed size. So we can skip animating it. However, in the
        // current model this only works if the parent also doesn't animate.
        // So we have to queue these and wait until we complete the parent to
        // cancel them.
        if (viewTransitionCancelableChildren === null) {
          viewTransitionCancelableChildren = [];
        }
        viewTransitionCancelableChildren.push(
          instance,
          nameForHostInstance(oldName, viewTransitionHostInstanceIdx),
          child.memoizedProps as Props,
        );
      }
      viewTransitionHostInstanceIdx++;
    } else if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // Skip any hidden subtrees. They were or are effectively not there.
    } else if (child.tag === ViewTransitionComponent && stopAtNestedViewTransitions) {
      // Skip any nested view transitions for updates since in that case the
      // inner most one is the one that handles the update. If this inner
      // boundary resized we need to bubble that information up.
      parentViewTransition.flags |= child.flags & AffectedParentLayout;
    } else {
      if (
        measureViewTransitionHostInstancesRecursive(
          parentViewTransition,
          child.child,
          newName,
          oldName,
          className,
          previousMeasurements,
          stopAtNestedViewTransitions,
        )
      ) {
        inViewport = true;
      }
    }
    child = child.sibling;
  }
  return inViewport;
}

export function measureUpdateViewTransition(current: Fiber, finishedWork: Fiber, gesture: boolean): boolean {
  // If this was a gesture then which Fiber was used for the "old" vs "new"
  // state is reversed. We still need to treat "finishedWork" as the Fiber
  // that contains the flags for this commmit.
  const oldFiber = gesture ? finishedWork : current;
  const newFiber = gesture ? current : finishedWork;
  const props = newFiber.memoizedProps as ViewTransitionProps;
  const state = newFiber.stateNode as ViewTransitionState;
  const newName = getViewTransitionName(props, state);
  const oldName = getViewTransitionName(oldFiber.memoizedProps as ViewTransitionProps, state);
  // Whether it ends up having been updated or relayout we apply the update
  // class name.
  const className = getViewTransitionClassName(props.default, props.update);
  if (className === "none") {
    // If update is "none" then we don't have to apply a name. Since we won't
    // animate this boundary.
    return false;
  }
  // If nothing changed due to a mutation, or children changing size and the
  // measurements end up unchanged, we should restore it to not animate.
  let previousMeasurements: InstanceMeasurement[] | null;
  if (gesture) {
    const clones = state.clones;
    if (clones === null) {
      previousMeasurements = null;
    } else {
      previousMeasurements = clones.map(measureClonedInstance);
    }
  } else {
    previousMeasurements = oldFiber.memoizedState as InstanceMeasurement[] | null;
    oldFiber.memoizedState = null; // Clear it. We won't need it anymore.
  }
  const inViewport = measureViewTransitionHostInstances(
    finishedWork, // This is always finishedWork since it's used to assign flags.
    newFiber.child, // This either current or finishedWork depending on if was a gesture.
    newName,
    oldName,
    className,
    previousMeasurements,
    true,
  );
  const previousCount = previousMeasurements === null ? 0 : previousMeasurements.length;
  if (viewTransitionHostInstanceIdx !== previousCount) {
    // If we found a different number of child DOM nodes we need to assume
    // that the parent layout may have changed as a result. This is not
    // necessarily true if those nodes were absolutely positioned.
    finishedWork.flags |= AffectedParentLayout;
  }
  return inViewport;
}

export function measureNestedViewTransitions(changedParent: Fiber, gesture: boolean): void {
  let child = changedParent.child;
  while (child !== null) {
    if (child.tag === ViewTransitionComponent) {
      const props = child.memoizedProps as ViewTransitionProps;
      const state = child.stateNode as ViewTransitionState;
      const name = getViewTransitionName(props, state);
      const className = getViewTransitionClassName(props.default, props.update);
      let previousMeasurements: InstanceMeasurement[] | null;
      if (gesture) {
        const clones = state.clones;
        if (clones === null) {
          previousMeasurements = null;
        } else {
          previousMeasurements = clones.map(measureClonedInstance);
        }
      } else {
        previousMeasurements = child.memoizedState as InstanceMeasurement[] | null;
        child.memoizedState = null; // Clear it. We won't need it anymore.
      }
      const inViewport = measureViewTransitionHostInstances(
        child,
        child.child,
        name,
        name, // Since this is unchanged, new and old name is the same.
        className,
        previousMeasurements,
        false,
      );
      if ((child.flags & Update) === NoFlags || !inViewport) {
        // Nothing changed.
      } else {
        // enableGestureTransition: the gesture event is not ported.
        if (!gesture) {
          scheduleViewTransitionEvent(child, props.onUpdate);
        }
      }
    } else if ((child.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
      measureNestedViewTransitions(child, gesture);
    }
    child = child.sibling;
  }
}

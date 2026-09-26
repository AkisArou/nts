// The commit phase's calls into user code: hook effect lists (insertion,
// layout, passive; mount and unmount), class lifecycles and callbacks, refs,
// and Profiler callbacks. Each catches what the user code throws and
// records it as a commit-phase error of the fiber.
//
// Port of upstream's ReactFiberCommitEffects.js (stable channel).

import { defines, invoke } from "react-reconciler/ReactFiberClassComponentHost.ts";
import { ComponentDidMount, ComponentDidUpdate, ComponentWillUnmount, GetSnapshotBeforeUpdate } from "shared/ReactClassComponentType.ts";
import { hostInstanceOf, hostNodeOf } from "./ReactFiberStateNode.ts";
import type { Props } from "shared/ReactTypes.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import type { UpdateQueue } from "./ReactFiberClassUpdateQueue.ts";
import type { FunctionComponentUpdateQueue } from "./ReactFiberHooks.ts";
import type { HookFlags } from "./ReactHookEffectTags.ts";
import type { FragmentInstanceType } from "react-reconciler/ReactFiberConfig.ts";
import type { ViewTransitionProps, ViewTransitionState } from "./ReactFiberViewTransitionComponent.ts";
import type { ClassInstance } from "./ReactFiberCallUserSpace.ts";

import { isDevelopment } from "shared/Build.ts";
import {
  enableFragmentRefs,
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableProfilerTimer,
  enableSchedulingProfiler,
  enableViewTransition,
} from "shared/ReactFeatureFlags.ts";
import { getViewTransitionName } from "./ReactFiberViewTransitionComponent.ts";
import { ClassComponent, Fragment, HostComponent, HostHoistable, HostSingleton, ViewTransitionComponent } from "./ReactWorkTags.ts";
import { NoFlags } from "./ReactFiberFlags.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";
import { resolveClassComponentProps } from "./ReactFiberClassComponent.ts";
import { isCurrentUpdateNested, recordEffectDuration, startEffectTimer } from "./ReactProfilerTimer.ts";
import { NoMode, ProfileMode } from "./ReactTypeOfMode.ts";
import { commitCallbacks, commitHiddenCallbacks } from "./ReactFiberClassUpdateQueue.ts";
import { createFragmentInstance, createViewTransitionInstance, getPublicInstance } from "react-reconciler/ReactFiberConfig.ts";
import { captureCommitPhaseError, setIsRunningInsertionEffect } from "./ReactFiberWorkLoop.ts";
import {
  Insertion as HookInsertion,
  Layout as HookLayout,
  NoFlags as NoHookEffect,
  Passive as HookPassive,
} from "./ReactHookEffectTags.ts";
import { didWarnAboutReassigningProps } from "./ReactFiberBeginWork.ts";
import {
  markComponentLayoutEffectMountStarted,
  markComponentLayoutEffectMountStopped,
  markComponentLayoutEffectUnmountStarted,
  markComponentLayoutEffectUnmountStopped,
  markComponentPassiveEffectMountStarted,
  markComponentPassiveEffectMountStopped,
  markComponentPassiveEffectUnmountStarted,
  markComponentPassiveEffectUnmountStopped,
} from "./ReactFiberDevToolsHook.ts";
import {
  callComponentDidMountInDEV,
  callComponentDidUpdateInDEV,
  callComponentWillUnmountInDEV,
  callCreateInDEV,
  callDestroyInDEV,
} from "./ReactFiberCallUserSpace.ts";
import { runWithFiberInDEV } from "./ReactCurrentFiber.ts";

// A class component instance as the commit phase uses it: its lifecycles,
// the props and state it rendered with, and the snapshot
// getSnapshotBeforeUpdate returned, which React keeps on the instance until
// componentDidUpdate receives it.
export type CommitClassInstance = ClassInstance;

// What a Profiler's props can hold.
type ProfilerPhase = "mount" | "update" | "nested-update";
interface ProfilerProps {
  id?: string;
  onRender?: (
    id: string | undefined,
    phase: ProfilerPhase,
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
  ) => void;
  onCommit?: (id: string | undefined, phase: ProfilerPhase, effectDuration: number, commitTime: number) => void;
  onPostCommit?: (id: string | undefined, phase: ProfilerPhase, passiveEffectDuration: number, commitTime: number) => void;
}

function shouldProfile(current: Fiber): boolean {
  return enableProfilerTimer && enableProfilerCommitHooks && (current.mode & ProfileMode) !== NoMode;
}

export function commitHookLayoutEffects(finishedWork: Fiber, hookFlags: HookFlags): void {
  // At this point layout effects have already been destroyed (during
  // mutation phase). This is done to prevent sibling component effects from
  // interfering with each other, e.g. a destroy function in one component
  // should never override a ref set by a create function in another
  // component during the same commit.
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListMount(hookFlags, finishedWork);
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListMount(hookFlags, finishedWork);
  }
}

export function commitHookLayoutUnmountEffects(
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
  hookFlags: HookFlags,
): void {
  // Layout effects are destroyed during the mutation phase so that all
  // destroy functions for all fibers are called before any create
  // functions. This prevents sibling component effects from interfering
  // with each other, e.g. a destroy function in one component should never
  // override a ref set by a create function in another component during the
  // same commit.
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
  }
}

// The development warning for an effect that returned something other than
// a cleanup function.
function warnAboutInvalidEffectReturn(finishedWork: Fiber, effectTag: HookFlags, destroy: unknown): void {
  let hookName: string;
  if ((effectTag & HookLayout) !== NoFlags) {
    hookName = "useLayoutEffect";
  } else if ((effectTag & HookInsertion) !== NoFlags) {
    hookName = "useInsertionEffect";
  } else {
    hookName = "useEffect";
  }
  let addendum: string;
  if (destroy === null) {
    addendum = " You returned null. If your effect does not require clean " + "up, return undefined (or nothing).";
  } else if (typeof (destroy as { then?: unknown }).then === "function") {
    addendum =
      "\n\nIt looks like you wrote " +
      hookName +
      "(async () => ...) or returned a Promise. " +
      "Instead, write the async function inside your effect " +
      "and call it immediately:\n\n" +
      hookName +
      "(() => {\n" +
      "  async function fetchData() {\n" +
      "    // You can await here\n" +
      "    const response = await MyAPI.getData(someId);\n" +
      "    // ...\n" +
      "  }\n" +
      "  fetchData();\n" +
      `}, [someId]); // Or [] if effect doesn't need props or state\n\n` +
      "Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching";
  } else {
    addendum = " You returned: " + String(destroy);
  }
  runWithFiberInDEV(
    finishedWork,
    (n: string, a: string) => {
      console.error("%s must not return anything besides a function, " + "which is used for clean-up.%s", n, a);
    },
    hookName,
    addendum,
  );
}

export function commitHookEffectListMount(flags: HookFlags, finishedWork: Fiber): void {
  try {
    const updateQueue = finishedWork.updateQueue as FunctionComponentUpdateQueue | null;
    const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
    if (lastEffect !== null) {
      const firstEffect = lastEffect.next;
      let effect = firstEffect;
      do {
        if ((effect.tag & flags) === flags) {
          if (enableSchedulingProfiler) {
            if ((flags & HookPassive) !== NoHookEffect) {
              markComponentPassiveEffectMountStarted(finishedWork);
            } else if ((flags & HookLayout) !== NoHookEffect) {
              markComponentLayoutEffectMountStarted(finishedWork);
            }
          }

          // Mount
          let destroy: unknown;
          if (isDevelopment) {
            if ((flags & HookInsertion) !== NoHookEffect) {
              setIsRunningInsertionEffect(true);
            }
            destroy = runWithFiberInDEV(finishedWork, callCreateInDEV, effect);
            if ((flags & HookInsertion) !== NoHookEffect) {
              setIsRunningInsertionEffect(false);
            }
          } else {
            const create = effect.create;
            const inst = effect.inst;
            destroy = create();
            inst.destroy = destroy as (() => void) | undefined;
          }

          if (enableSchedulingProfiler) {
            if ((flags & HookPassive) !== NoHookEffect) {
              markComponentPassiveEffectMountStopped();
            } else if ((flags & HookLayout) !== NoHookEffect) {
              markComponentLayoutEffectMountStopped();
            }
          }

          if (isDevelopment) {
            if (destroy !== undefined && typeof destroy !== "function") {
              warnAboutInvalidEffectReturn(finishedWork, effect.tag, destroy);
            }
          }
        }
        effect = effect.next;
      } while (effect !== firstEffect);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHookEffectListUnmount(
  flags: HookFlags,
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
): void {
  try {
    const updateQueue = finishedWork.updateQueue as FunctionComponentUpdateQueue | null;
    const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
    if (lastEffect !== null) {
      const firstEffect = lastEffect.next;
      let effect = firstEffect;
      do {
        if ((effect.tag & flags) === flags) {
          // Unmount
          const inst = effect.inst;
          const destroy = inst.destroy;
          if (destroy !== undefined) {
            inst.destroy = undefined;
            if (enableSchedulingProfiler) {
              if ((flags & HookPassive) !== NoHookEffect) {
                markComponentPassiveEffectUnmountStarted(finishedWork);
              } else if ((flags & HookLayout) !== NoHookEffect) {
                markComponentLayoutEffectUnmountStarted(finishedWork);
              }
            }

            if (isDevelopment) {
              if ((flags & HookInsertion) !== NoHookEffect) {
                setIsRunningInsertionEffect(true);
              }
            }
            safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy);
            if (isDevelopment) {
              if ((flags & HookInsertion) !== NoHookEffect) {
                setIsRunningInsertionEffect(false);
              }
            }

            if (enableSchedulingProfiler) {
              if ((flags & HookPassive) !== NoHookEffect) {
                markComponentPassiveEffectUnmountStopped();
              } else if ((flags & HookLayout) !== NoHookEffect) {
                markComponentLayoutEffectUnmountStopped();
              }
            }
          }
        }
        effect = effect.next;
      } while (effect !== firstEffect);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitHookPassiveMountEffects(finishedWork: Fiber, hookFlags: HookFlags): void {
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListMount(hookFlags, finishedWork);
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListMount(hookFlags, finishedWork);
  }
}

export function commitHookPassiveUnmountEffects(
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
  hookFlags: HookFlags,
): void {
  if (shouldProfile(finishedWork)) {
    startEffectTimer();
    commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
    recordEffectDuration(finishedWork);
  } else {
    commitHookEffectListUnmount(hookFlags, finishedWork, nearestMountedAncestor);
  }
}

// In development, check that the instance still holds the props and state
// React last rendered with, before calling a lifecycle that reads them.
function warnIfInstancePropsOrStateChanged(finishedWork: Fiber, instance: CommitClassInstance, beforeWhat: string): void {
  if (
    !(finishedWork.type as { defaultProps?: unknown }).defaultProps &&
    !("ref" in (finishedWork.memoizedProps as object)) &&
    !didWarnAboutReassigningProps
  ) {
    if (instance.props !== finishedWork.memoizedProps) {
      console.error(
        "Expected %s props to match memoized props before " +
          beforeWhat +
          ". " +
          "This might either be because of a bug in React, or because " +
          "a component reassigns its own `this.props`. " +
          "Please file an issue.",
        getComponentNameFromFiber(finishedWork) || "instance",
      );
    }
    if (instance.state !== finishedWork.memoizedState) {
      console.error(
        "Expected %s state to match memoized state before " +
          beforeWhat +
          ". " +
          "This might either be because of a bug in React, or because " +
          "a component reassigns its own `this.state`. " +
          "Please file an issue.",
        getComponentNameFromFiber(finishedWork) || "instance",
      );
    }
  }
}

function callComponentDidMount(finishedWork: Fiber, instance: CommitClassInstance): void {
  if (isDevelopment) {
    runWithFiberInDEV(finishedWork, callComponentDidMountInDEV, finishedWork, instance);
  } else {
    try {
      invoke(instance, ComponentDidMount, undefined, undefined, undefined);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

function callComponentDidUpdate(
  finishedWork: Fiber,
  instance: CommitClassInstance,
  prevProps: unknown,
  prevState: unknown,
): void {
  if (isDevelopment) {
    runWithFiberInDEV(
      finishedWork,
      callComponentDidUpdateInDEV,
      finishedWork,
      instance,
      prevProps,
      prevState,
      instance.__reactInternalSnapshotBeforeUpdate,
    );
  } else {
    try {
      invoke(instance, ComponentDidUpdate, prevProps, prevState, instance.__reactInternalSnapshotBeforeUpdate);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

export function commitClassLayoutLifecycles(finishedWork: Fiber, current: Fiber | null): void {
  const instance = finishedWork.stateNode as CommitClassInstance;
  if (current === null) {
    // We could update instance props and state here, but instead we rely on
    // them being set during last render.
    // TODO: revisit this when we implement resuming.
    if (isDevelopment) {
      warnIfInstancePropsOrStateChanged(finishedWork, instance, "componentDidMount");
    }
    if (shouldProfile(finishedWork)) {
      startEffectTimer();
      callComponentDidMount(finishedWork, instance);
      recordEffectDuration(finishedWork);
    } else {
      callComponentDidMount(finishedWork, instance);
    }
  } else {
    const prevProps = resolveClassComponentProps(finishedWork.type, current.memoizedProps as Props);
    const prevState = current.memoizedState;
    // We could update instance props and state here, but instead we rely on
    // them being set during last render.
    // TODO: revisit this when we implement resuming.
    if (isDevelopment) {
      warnIfInstancePropsOrStateChanged(finishedWork, instance, "componentDidUpdate");
    }
    if (shouldProfile(finishedWork)) {
      startEffectTimer();
      callComponentDidUpdate(finishedWork, instance, prevProps, prevState);
      recordEffectDuration(finishedWork);
    } else {
      callComponentDidUpdate(finishedWork, instance, prevProps, prevState);
    }
  }
}

export function commitClassDidMount(finishedWork: Fiber): void {
  // TODO: Check for LayoutStatic flag
  const instance = finishedWork.stateNode as CommitClassInstance;
  if (defines(finishedWork.type, instance, ComponentDidMount)) {
    callComponentDidMount(finishedWork, instance);
  }
}

export function commitClassCallbacks(finishedWork: Fiber): void {
  // TODO: I think this is now always non-null by the time it reaches the
  // commit phase. Consider removing the type check.
  const updateQueue = finishedWork.updateQueue as UpdateQueue | null;
  if (updateQueue !== null) {
    const instance = finishedWork.stateNode as CommitClassInstance;
    if (isDevelopment) {
      warnIfInstancePropsOrStateChanged(finishedWork, instance, "processing the update queue");
    }
    // We could update instance props and state here, but instead we rely on
    // them being set during last render.
    // TODO: revisit this when we implement resuming.
    try {
      if (isDevelopment) {
        runWithFiberInDEV(finishedWork, commitCallbacks, updateQueue, instance);
      } else {
        commitCallbacks(updateQueue, instance);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

export function commitClassHiddenCallbacks(finishedWork: Fiber): void {
  // Commit any callbacks that would have fired while the component was
  // hidden.
  const updateQueue = finishedWork.updateQueue as UpdateQueue | null;
  if (updateQueue !== null) {
    const instance = finishedWork.stateNode;
    try {
      if (isDevelopment) {
        runWithFiberInDEV(finishedWork, commitHiddenCallbacks, updateQueue, instance);
      } else {
        commitHiddenCallbacks(updateQueue, instance);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

export function commitRootCallbacks(finishedWork: Fiber): void {
  // TODO: I think this is now always non-null by the time it reaches the
  // commit phase. Consider removing the type check.
  const updateQueue = finishedWork.updateQueue as UpdateQueue | null;
  if (updateQueue !== null) {
    let instance: unknown = null;
    if (finishedWork.child !== null) {
      switch (finishedWork.child.tag) {
        case HostSingleton:
        case HostComponent:
          instance = getPublicInstance(hostNodeOf(finishedWork.child));
          break;
        case ClassComponent:
          instance = finishedWork.child.stateNode;
          break;
      }
    }
    try {
      if (isDevelopment) {
        runWithFiberInDEV(finishedWork, commitCallbacks, updateQueue, instance);
      } else {
        commitCallbacks(updateQueue, instance);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

let didWarnAboutUndefinedSnapshotBeforeUpdate: Set<unknown> | null = null;
if (isDevelopment) {
  didWarnAboutUndefinedSnapshotBeforeUpdate = new Set<unknown>();
}

function callGetSnapshotBeforeUpdates(instance: CommitClassInstance, prevProps: unknown, prevState: unknown): unknown {
  return invoke(instance, GetSnapshotBeforeUpdate, prevProps, prevState, undefined);
}

export function commitClassSnapshot(finishedWork: Fiber, current: Fiber): void {
  const prevProps = current.memoizedProps;
  const prevState = current.memoizedState;
  const instance = finishedWork.stateNode as CommitClassInstance;
  // We could update instance props and state here, but instead we rely on
  // them being set during last render.
  // TODO: revisit this when we implement resuming.
  if (isDevelopment) {
    warnIfInstancePropsOrStateChanged(finishedWork, instance, "getSnapshotBeforeUpdate");
  }
  try {
    const resolvedPrevProps = resolveClassComponentProps(finishedWork.type, prevProps as Props);
    let snapshot: unknown;
    if (isDevelopment) {
      snapshot = runWithFiberInDEV(finishedWork, callGetSnapshotBeforeUpdates, instance, resolvedPrevProps, prevState);
      const didWarnSet = didWarnAboutUndefinedSnapshotBeforeUpdate as Set<unknown>;
      if (snapshot === undefined && !didWarnSet.has(finishedWork.type)) {
        didWarnSet.add(finishedWork.type);
        runWithFiberInDEV(finishedWork, () => {
          console.error(
            "%s.getSnapshotBeforeUpdate(): A snapshot value (or null) " + "must be returned. You have returned undefined.",
            getComponentNameFromFiber(finishedWork),
          );
        });
      }
    } else {
      snapshot = callGetSnapshotBeforeUpdates(instance, resolvedPrevProps, prevState);
    }
    instance.__reactInternalSnapshotBeforeUpdate = snapshot;
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

function callComponentWillUnmount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: CommitClassInstance,
): void {
  if (isDevelopment) {
    runWithFiberInDEV(current, callComponentWillUnmountInDEV, current, nearestMountedAncestor, instance);
  } else {
    try {
      invoke(instance, ComponentWillUnmount, undefined, undefined, undefined);
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
}

// Capture errors so they don't interrupt unmounting.
export function safelyCallComponentWillUnmount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: CommitClassInstance,
): void {
  instance.props = resolveClassComponentProps(current.type, current.memoizedProps as Props);
  instance.state = current.memoizedState;
  if (shouldProfile(current)) {
    startEffectTimer();
    callComponentWillUnmount(current, nearestMountedAncestor, instance);
    recordEffectDuration(current);
  } else {
    callComponentWillUnmount(current, nearestMountedAncestor, instance);
  }
}

function commitAttachRef(finishedWork: Fiber): void {
  const ref = finishedWork.ref;
  if (ref !== null) {
    let instanceToUse: unknown;
    switch (finishedWork.tag) {
      case HostHoistable:
      case HostSingleton:
      case HostComponent:
        instanceToUse = getPublicInstance(hostInstanceOf(finishedWork));
        break;
      case ViewTransitionComponent: {
        if (enableViewTransition) {
          const instance = finishedWork.stateNode as ViewTransitionState;
          const props = finishedWork.memoizedProps as ViewTransitionProps;
          const name = getViewTransitionName(props, instance);
          if (instance.ref === null || instance.ref.name !== name) {
            instance.ref = createViewTransitionInstance(name);
          }
          instanceToUse = instance.ref;
          break;
        }
        instanceToUse = finishedWork.stateNode;
        break;
      }
      case Fragment:
        if (enableFragmentRefs) {
          const instance = finishedWork.stateNode as FragmentInstanceType | null;
          if (instance === null) {
            finishedWork.stateNode = createFragmentInstance(finishedWork);
          }
          instanceToUse = finishedWork.stateNode;
          break;
        }
        instanceToUse = finishedWork.stateNode;
        break;
      default:
        instanceToUse = finishedWork.stateNode;
    }
    if (typeof ref === "function") {
      if (shouldProfile(finishedWork)) {
        try {
          startEffectTimer();
          finishedWork.refCleanup = ref(instanceToUse) ?? null;
        } finally {
          recordEffectDuration(finishedWork);
        }
      } else {
        finishedWork.refCleanup = ref(instanceToUse) ?? null;
      }
    } else {
      if (isDevelopment) {
        // TODO: We should move these warnings to happen during the render
        // phase (markRef).
        if (typeof (ref as unknown) === "string") {
          console.error("String refs are no longer supported.");
        } else if (!Object.prototype.hasOwnProperty.call(ref, "current")) {
          console.error(
            "Unexpected ref object provided for %s. " + "Use either a ref-setter function or React.createRef().",
            getComponentNameFromFiber(finishedWork),
          );
        }
      }

      ref.current = instanceToUse;
    }
  }
}

// Capture errors so they don't interrupt mounting.
export function safelyAttachRef(current: Fiber, nearestMountedAncestor: Fiber | null): void {
  try {
    if (isDevelopment) {
      runWithFiberInDEV(current, commitAttachRef, current);
    } else {
      commitAttachRef(current);
    }
  } catch (error) {
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

export function safelyDetachRef(current: Fiber, nearestMountedAncestor: Fiber | null): void {
  const ref = current.ref;
  const refCleanup = current.refCleanup;

  if (ref !== null) {
    if (typeof refCleanup === "function") {
      try {
        if (shouldProfile(current)) {
          try {
            startEffectTimer();
            if (isDevelopment) {
              runWithFiberInDEV(current, refCleanup);
            } else {
              refCleanup();
            }
          } finally {
            recordEffectDuration(current);
          }
        } else {
          if (isDevelopment) {
            runWithFiberInDEV(current, refCleanup);
          } else {
            refCleanup();
          }
        }
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      } finally {
        // `refCleanup` has been called. Nullify all references to it to
        // prevent double invocation.
        current.refCleanup = null;
        const finishedWork = current.alternate;
        if (finishedWork != null) {
          finishedWork.refCleanup = null;
        }
      }
    } else if (typeof ref === "function") {
      try {
        if (shouldProfile(current)) {
          try {
            startEffectTimer();
            if (isDevelopment) {
              runWithFiberInDEV(current, ref, null);
            } else {
              ref(null);
            }
          } finally {
            recordEffectDuration(current);
          }
        } else {
          if (isDevelopment) {
            runWithFiberInDEV(current, ref, null);
          } else {
            ref(null);
          }
        }
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      }
    } else {
      ref.current = null;
    }
  }
}

function safelyCallDestroy(current: Fiber, nearestMountedAncestor: Fiber | null, destroy: () => void): void {
  // Upstream binds a CRUD effect's resource here; that experiment is gone
  // from the stable build, so the destroy function is called as it is.
  if (isDevelopment) {
    runWithFiberInDEV(current, callDestroyInDEV, current, nearestMountedAncestor, destroy);
  } else {
    try {
      destroy();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
}

function commitProfiler(finishedWork: Fiber, current: Fiber | null, commitStartTime: number, effectDuration: number): void {
  const { id, onCommit, onRender } = finishedWork.memoizedProps as ProfilerProps;

  let phase: ProfilerPhase = current === null ? "mount" : "update";
  if (enableProfilerNestedUpdatePhase) {
    if (isCurrentUpdateNested()) {
      phase = "nested-update";
    }
  }

  if (typeof onRender === "function") {
    onRender(
      id,
      phase,
      finishedWork.actualDuration,
      finishedWork.treeBaseDuration,
      finishedWork.actualStartTime,
      commitStartTime,
    );
  }

  if (enableProfilerCommitHooks) {
    if (typeof onCommit === "function") {
      onCommit(id, phase, effectDuration, commitStartTime);
    }
  }
}

export function commitProfilerUpdate(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  effectDuration: number,
): void {
  if (enableProfilerTimer) {
    try {
      if (isDevelopment) {
        runWithFiberInDEV(finishedWork, commitProfiler, finishedWork, current, commitStartTime, effectDuration);
      } else {
        commitProfiler(finishedWork, current, commitStartTime, effectDuration);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

function commitProfilerPostCommitImpl(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  passiveEffectDuration: number,
): void {
  const { id, onPostCommit } = finishedWork.memoizedProps as ProfilerProps;

  let phase: ProfilerPhase = current === null ? "mount" : "update";
  if (enableProfilerNestedUpdatePhase) {
    if (isCurrentUpdateNested()) {
      phase = "nested-update";
    }
  }

  if (typeof onPostCommit === "function") {
    onPostCommit(id, phase, passiveEffectDuration, commitStartTime);
  }
}

export function commitProfilerPostCommit(
  finishedWork: Fiber,
  current: Fiber | null,
  commitStartTime: number,
  passiveEffectDuration: number,
): void {
  try {
    if (isDevelopment) {
      runWithFiberInDEV(
        finishedWork,
        commitProfilerPostCommitImpl,
        finishedWork,
        current,
        commitStartTime,
        passiveEffectDuration,
      );
    } else {
      commitProfilerPostCommitImpl(finishedWork, current, commitStartTime, passiveEffectDuration);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

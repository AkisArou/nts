// The connection to React DevTools, through the global hook DevTools
// installs before React loads. Without that hook, every function here does
// nothing.

import { isDevelopment } from "shared/Build.ts";
import { enableProfilerTimer, enableSchedulingProfiler } from "shared/ReactFeatureFlags.ts";
import type { Wakeable } from "shared/ReactTypes.ts";
import type { EventPriority } from "./ReactEventPriorities.ts";
import {
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  IdleEventPriority,
} from "./ReactEventPriorities.ts";
import { DidCapture } from "./ReactFiberFlags.ts";
import type { Lane, Lanes } from "./ReactFiberLane.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import {
  IdlePriority as IdleSchedulerPriority,
  ImmediatePriority as ImmediateSchedulerPriority,
  isMockScheduler,
  NormalPriority as NormalSchedulerPriority,
  setDisableYieldValue,
  UserBlockingPriority as UserBlockingSchedulerPriority,
} from "./Scheduler.ts";

// The parts of `__REACT_DEVTOOLS_GLOBAL_HOOK__` React calls. DevTools'
// own types depend on the DOM renderer, so this describes only the surface.
interface DevToolsHook {
  isDisabled?: boolean;
  supportsFiber?: boolean;
  checkDCE?: unknown;
  inject(internals: object): number;
  onScheduleFiberRoot?: (rendererID: number | null, root: FiberRoot, children: unknown) => void;
  onCommitFiberRoot?: (
    rendererID: number | null,
    root: FiberRoot,
    schedulerPriority: number | undefined,
    didError: boolean,
  ) => void;
  onPostCommitFiberRoot?: (rendererID: number | null, root: FiberRoot) => void;
  onCommitFiberUnmount?: (rendererID: number | null, fiber: Fiber) => void;
  setStrictMode?: (rendererID: number | null, isStrictMode: boolean) => void;
}

// The scheduling profiler's hooks, injected by DevTools. Each is optional.
export interface DevToolsProfilingHooks {
  markCommitStarted?: (lanes: Lanes) => void;
  markCommitStopped?: () => void;
  markComponentRenderStarted?: (fiber: Fiber) => void;
  markComponentRenderStopped?: () => void;
  markComponentPassiveEffectMountStarted?: (fiber: Fiber) => void;
  markComponentPassiveEffectMountStopped?: () => void;
  markComponentPassiveEffectUnmountStarted?: (fiber: Fiber) => void;
  markComponentPassiveEffectUnmountStopped?: () => void;
  markComponentLayoutEffectMountStarted?: (fiber: Fiber) => void;
  markComponentLayoutEffectMountStopped?: () => void;
  markComponentLayoutEffectUnmountStarted?: (fiber: Fiber) => void;
  markComponentLayoutEffectUnmountStopped?: () => void;
  markComponentErrored?: (fiber: Fiber, thrownValue: unknown, lanes: Lanes) => void;
  markComponentSuspended?: (fiber: Fiber, wakeable: Wakeable, lanes: Lanes) => void;
  markLayoutEffectsStarted?: (lanes: Lanes) => void;
  markLayoutEffectsStopped?: () => void;
  markPassiveEffectsStarted?: (lanes: Lanes) => void;
  markPassiveEffectsStopped?: () => void;
  markRenderStarted?: (lanes: Lanes) => void;
  markRenderYielded?: () => void;
  markRenderStopped?: () => void;
  markRenderScheduled?: (lane: Lane) => void;
  markForceUpdateScheduled?: (fiber: Fiber, lane: Lane) => void;
  markStateUpdateScheduled?: (fiber: Fiber, lane: Lane) => void;
}

function readGlobalHook(): DevToolsHook | undefined {
  return (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

let rendererID: number | null = null;
let injectedHook: DevToolsHook | null = null;
let injectedProfilingHooks: DevToolsProfilingHooks | null = null;
let hasLoggedError = false;

export { isDevToolsPresent } from "react-reconciler/ReactFiberDevToolsPresence.ts";

function logInstrumentationError(err: unknown): void {
  if (isDevelopment && !hasLoggedError) {
    hasLoggedError = true;
    console.error("React instrumentation encountered an error: %o", err);
  }
}

export function injectInternals(internals: object): boolean {
  const hook = readGlobalHook();
  if (typeof hook === "undefined") {
    // No DevTools
    return false;
  }
  if (hook.isDisabled) {
    // This isn't a real property on the hook, but it can be set to opt out
    // of DevTools integration and associated warnings and logs.
    // https://github.com/facebook/react/issues/3877
    return true;
  }
  if (!hook.supportsFiber) {
    if (isDevelopment) {
      console.error(
        "The installed version of React DevTools is too old and will not work " +
          "with the current version of React. Please update React DevTools. " +
          "https://react.dev/link/react-devtools",
      );
    }
    // DevTools exists, even though it doesn't support Fiber.
    return true;
  }
  try {
    rendererID = hook.inject(internals);

    // We have successfully injected, so now it is safe to set up hooks.
    injectedHook = hook;
  } catch (err) {
    // Catch all errors because it is unsafe to throw during initialization.
    if (isDevelopment) {
      console.error("React instrumentation encountered an error: %o.", err);
    }
  }
  if (hook.checkDCE) {
    // This is the real DevTools.
    return true;
  } else {
    // This is likely a hook installed by Fast Refresh runtime.
    return false;
  }
}

export function onScheduleRoot(root: FiberRoot, children: unknown): void {
  if (isDevelopment) {
    if (injectedHook && typeof injectedHook.onScheduleFiberRoot === "function") {
      try {
        injectedHook.onScheduleFiberRoot(rendererID, root, children);
      } catch (err) {
        logInstrumentationError(err);
      }
    }
  }
}

export function onCommitRoot(root: FiberRoot, eventPriority: EventPriority): void {
  if (injectedHook && typeof injectedHook.onCommitFiberRoot === "function") {
    try {
      const didError = (root.current.flags & DidCapture) === DidCapture;
      if (enableProfilerTimer) {
        let schedulerPriority;
        switch (eventPriority) {
          case DiscreteEventPriority:
            schedulerPriority = ImmediateSchedulerPriority;
            break;
          case ContinuousEventPriority:
            schedulerPriority = UserBlockingSchedulerPriority;
            break;
          case DefaultEventPriority:
            schedulerPriority = NormalSchedulerPriority;
            break;
          case IdleEventPriority:
            schedulerPriority = IdleSchedulerPriority;
            break;
          default:
            schedulerPriority = NormalSchedulerPriority;
            break;
        }
        injectedHook.onCommitFiberRoot(rendererID, root, schedulerPriority, didError);
      } else {
        injectedHook.onCommitFiberRoot(rendererID, root, undefined, didError);
      }
    } catch (err) {
      logInstrumentationError(err);
    }
  }
}

export function onPostCommitRoot(root: FiberRoot): void {
  if (injectedHook && typeof injectedHook.onPostCommitFiberRoot === "function") {
    try {
      injectedHook.onPostCommitFiberRoot(rendererID, root);
    } catch (err) {
      logInstrumentationError(err);
    }
  }
}

export function onCommitUnmount(fiber: Fiber): void {
  if (injectedHook && typeof injectedHook.onCommitFiberUnmount === "function") {
    try {
      injectedHook.onCommitFiberUnmount(rendererID, fiber);
    } catch (err) {
      logInstrumentationError(err);
    }
  }
}

export function setIsStrictModeForDevtools(newIsStrictMode: boolean): void {
  if (isMockScheduler()) {
    // We're in a test because Scheduler.log only exists
    // in SchedulerMock. To reduce the noise in strict mode tests,
    // suppress warnings and disable scheduler yielding during the double render
    setDisableYieldValue(newIsStrictMode);
  }

  if (injectedHook && typeof injectedHook.setStrictMode === "function") {
    try {
      injectedHook.setStrictMode(rendererID, newIsStrictMode);
    } catch (err) {
      logInstrumentationError(err);
    }
  }
}

// Profiler API hooks. The scheduling profiler is off in the stable channel
// (enableSchedulingProfiler), so these only forward when it is on.

export function injectProfilingHooks(profilingHooks: DevToolsProfilingHooks): void {
  injectedProfilingHooks = profilingHooks;
}

function profilingHooks(): DevToolsProfilingHooks | null {
  return enableSchedulingProfiler ? injectedProfilingHooks : null;
}

export function markCommitStarted(lanes: Lanes): void {
  profilingHooks()?.markCommitStarted?.(lanes);
}

export function markCommitStopped(): void {
  profilingHooks()?.markCommitStopped?.();
}

export function markComponentRenderStarted(fiber: Fiber): void {
  profilingHooks()?.markComponentRenderStarted?.(fiber);
}

export function markComponentRenderStopped(): void {
  profilingHooks()?.markComponentRenderStopped?.();
}

export function markComponentPassiveEffectMountStarted(fiber: Fiber): void {
  profilingHooks()?.markComponentPassiveEffectMountStarted?.(fiber);
}

export function markComponentPassiveEffectMountStopped(): void {
  profilingHooks()?.markComponentPassiveEffectMountStopped?.();
}

export function markComponentPassiveEffectUnmountStarted(fiber: Fiber): void {
  profilingHooks()?.markComponentPassiveEffectUnmountStarted?.(fiber);
}

export function markComponentPassiveEffectUnmountStopped(): void {
  profilingHooks()?.markComponentPassiveEffectUnmountStopped?.();
}

export function markComponentLayoutEffectMountStarted(fiber: Fiber): void {
  profilingHooks()?.markComponentLayoutEffectMountStarted?.(fiber);
}

export function markComponentLayoutEffectMountStopped(): void {
  profilingHooks()?.markComponentLayoutEffectMountStopped?.();
}

export function markComponentLayoutEffectUnmountStarted(fiber: Fiber): void {
  profilingHooks()?.markComponentLayoutEffectUnmountStarted?.(fiber);
}

export function markComponentLayoutEffectUnmountStopped(): void {
  profilingHooks()?.markComponentLayoutEffectUnmountStopped?.();
}

export function markComponentErrored(fiber: Fiber, thrownValue: unknown, lanes: Lanes): void {
  profilingHooks()?.markComponentErrored?.(fiber, thrownValue, lanes);
}

export function markComponentSuspended(fiber: Fiber, wakeable: Wakeable, lanes: Lanes): void {
  profilingHooks()?.markComponentSuspended?.(fiber, wakeable, lanes);
}

export function markLayoutEffectsStarted(lanes: Lanes): void {
  profilingHooks()?.markLayoutEffectsStarted?.(lanes);
}

export function markLayoutEffectsStopped(): void {
  profilingHooks()?.markLayoutEffectsStopped?.();
}

export function markPassiveEffectsStarted(lanes: Lanes): void {
  profilingHooks()?.markPassiveEffectsStarted?.(lanes);
}

export function markPassiveEffectsStopped(): void {
  profilingHooks()?.markPassiveEffectsStopped?.();
}

export function markRenderStarted(lanes: Lanes): void {
  profilingHooks()?.markRenderStarted?.(lanes);
}

export function markRenderYielded(): void {
  profilingHooks()?.markRenderYielded?.();
}

export function markRenderStopped(): void {
  profilingHooks()?.markRenderStopped?.();
}

export function markRenderScheduled(lane: Lane): void {
  profilingHooks()?.markRenderScheduled?.(lane);
}

export function markForceUpdateScheduled(fiber: Fiber, lane: Lane): void {
  profilingHooks()?.markForceUpdateScheduled?.(fiber, lane);
}

export function markStateUpdateScheduled(fiber: Fiber, lane: Lane): void {
  profilingHooks()?.markStateUpdateScheduled?.(fiber, lane);
}

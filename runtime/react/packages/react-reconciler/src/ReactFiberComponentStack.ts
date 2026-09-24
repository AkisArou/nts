import { isDevelopment } from "shared/Build.ts";
import { enableViewTransition } from "shared/ReactFeatureFlags.ts";
import {
  type ComponentFunction,
  describeBuiltInComponentFrame,
  describeClassComponentFrame,
  describeDebugInfoFrame,
  describeFunctionComponentFrame,
} from "shared/ReactComponentStackFrame.ts";
import { formatOwnerStack } from "shared/ReactOwnerStackFrames.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import {
  ActivityComponent,
  ClassComponent,
  ForwardRef,
  FunctionComponent,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  LazyComponent,
  SimpleMemoComponent,
  SuspenseComponent,
  SuspenseListComponent,
  ViewTransitionComponent,
} from "./ReactWorkTags.ts";

// A Server Component's debug info: an owner that is not a fiber.
interface ReactComponentInfo {
  readonly name?: unknown;
  readonly env?: string | null;
  readonly debugLocation?: Error | null;
  readonly debugStack?: Error | null;
  readonly owner?: Fiber | ReactComponentInfo | null;
  readonly tag?: undefined;
}

function renderOf(type: unknown): ComponentFunction {
  return (type as { render: ComponentFunction }).render;
}

function describeFiber(fiber: Fiber, childFiber: Fiber | null): string {
  switch (fiber.tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      return describeBuiltInComponentFrame(fiber.type as string);
    case LazyComponent:
      // TODO: When we support Thenables as component types we should rename this.
      return describeBuiltInComponentFrame("Lazy");
    case SuspenseComponent:
      if (fiber.child !== childFiber && childFiber !== null) {
        // If we came from the second Fiber then we're in the Suspense Fallback.
        return describeBuiltInComponentFrame("Suspense Fallback");
      }
      return describeBuiltInComponentFrame("Suspense");
    case SuspenseListComponent:
      return describeBuiltInComponentFrame("SuspenseList");
    case FunctionComponent:
    case SimpleMemoComponent:
      return describeFunctionComponentFrame(fiber.type as ComponentFunction, ReactSharedInternals);
    case ForwardRef:
      return describeFunctionComponentFrame(renderOf(fiber.type), ReactSharedInternals);
    case ClassComponent:
      return describeClassComponentFrame(fiber.type as ComponentFunction, ReactSharedInternals);
    case ActivityComponent:
      return describeBuiltInComponentFrame("Activity");
    case ViewTransitionComponent:
      if (enableViewTransition) {
        return describeBuiltInComponentFrame("ViewTransition");
      }
      return "";
    default:
      return "";
  }
}

function errorDetails(x: unknown): string {
  const error = x as { message?: unknown; stack?: unknown };
  return "\nError generating stack: " + String(error.message) + "\n" + String(error.stack);
}

export function getStackByFiberInDevAndProd(workInProgress: Fiber): string {
  try {
    let info = "";
    let node: Fiber | null = workInProgress;
    let previous: Fiber | null = null;
    do {
      info += describeFiber(node, previous);
      if (isDevelopment) {
        // Add any Server Component stack frames in reverse order.
        const debugInfo = node._debugInfo;
        if (debugInfo) {
          for (let i = debugInfo.length - 1; i >= 0; i--) {
            const entry = debugInfo[i] as ReactComponentInfo;
            if (typeof entry.name === "string") {
              info += describeDebugInfoFrame(entry.name, entry.env, entry.debugLocation);
            }
          }
        }
      }
      previous = node;
      node = node.return;
    } while (node);
    return info;
  } catch (x) {
    return errorDetails(x);
  }
}

function describeFunctionComponentFrameWithoutLineNumber(fn: ComponentFunction | null | undefined): string {
  // We use this because we don't actually want to describe the line of the component
  // but just the component name.
  const name = fn ? (fn.displayName ? String(fn.displayName) : fn.name) : "";
  return name ? describeBuiltInComponentFrame(name) : "";
}

export function getOwnerStackByFiberInDev(start: Fiber): string {
  if (!isDevelopment) {
    return "";
  }
  try {
    let info = "";
    let workInProgress = start;

    if (workInProgress.tag === HostText) {
      // Text nodes never have an owner/stack because they're not created through JSX.
      // We use the parent since text nodes are always created through a host parent.
      workInProgress = workInProgress.return!;
    }

    // The owner stack of the current fiber will be where it was created, i.e. inside its owner.
    // There's no actual name of the currently executing component. Instead, that is available
    // on the regular stack that's currently executing. However, for built-ins there is no such
    // named stack frame and it would be ignored as being internal anyway. Therefore we add
    // add one extra frame just to describe the "current" built-in component by name.
    // Similarly, if there is no owner at all, then there's no stack frame so we add the name
    // of the root component to the stack to know which component is currently executing.
    switch (workInProgress.tag) {
      case HostHoistable:
      case HostSingleton:
      case HostComponent:
        info += describeBuiltInComponentFrame(workInProgress.type as string);
        break;
      case SuspenseComponent:
        info += describeBuiltInComponentFrame("Suspense");
        break;
      case SuspenseListComponent:
        info += describeBuiltInComponentFrame("SuspenseList");
        break;
      case ActivityComponent:
        info += describeBuiltInComponentFrame("Activity");
        break;
      case ViewTransitionComponent:
        if (enableViewTransition) {
          info += describeBuiltInComponentFrame("ViewTransition");
          break;
        }
        info += describeRootComponentName(workInProgress, info);
        break;
      case FunctionComponent:
      case SimpleMemoComponent:
      case ClassComponent:
        info += describeRootComponentName(workInProgress, info);
        break;
      case ForwardRef:
        if (!workInProgress._debugOwner && info === "") {
          info += describeFunctionComponentFrameWithoutLineNumber(renderOf(workInProgress.type));
        }
        break;
    }

    let owner: Fiber | ReactComponentInfo | null | undefined = workInProgress;

    while (owner) {
      if (typeof owner.tag === "number") {
        const fiber = owner as Fiber;
        owner = fiber._debugOwner;
        const debugStack = fiber._debugStack;
        // If we don't actually print the stack if there is no owner of this JSX element.
        // In a real app it's typically not useful since the root app is always controlled
        // by the framework. These also tend to have noisy stacks because they're not rooted
        // in a React render but in some imperative bootstrapping code. It could be useful
        // if the element was created in module scope. E.g. hoisted. We could add a a single
        // stack frame for context for example but it doesn't say much if that's a wrapper.
        if (owner && debugStack) {
          const formattedStack = formatOwnerStack(debugStack as Error);
          if (formattedStack !== "") {
            info += "\n" + formattedStack;
          }
        }
      } else {
        const componentInfo = owner as ReactComponentInfo;
        if (componentInfo.debugStack != null) {
          // Server Component
          const ownerStack: Error = componentInfo.debugStack;
          owner = componentInfo.owner;
          if (owner && ownerStack) {
            // TODO: Should we stash this somewhere for caching purposes?
            info += "\n" + formatOwnerStack(ownerStack);
          }
        } else {
          break;
        }
      }
    }
    return info;
  } catch (x) {
    return errorDetails(x);
  }
}

// Only if we have no other data about the callsite do we add the component
// name as the single stack frame.
function describeRootComponentName(workInProgress: Fiber, info: string): string {
  if (!workInProgress._debugOwner && info === "") {
    return describeFunctionComponentFrameWithoutLineNumber(workInProgress.type as ComponentFunction);
  }
  return "";
}

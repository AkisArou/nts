import { isDevelopment } from "shared/Build.ts";
import { ClassComponentType } from "shared/ReactClassComponentType.ts";
import { disableLegacyMode, enableLegacyHidden, enableViewTransition } from "shared/ReactFeatureFlags.ts";
import { getComponentNameFromType } from "shared/getComponentNameFromType.ts";
import { REACT_STRICT_MODE_TYPE } from "shared/ReactSymbols.ts";
import type { ReactContextConsumer, ReactContextBase } from "shared/ReactTypes.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import {
  ActivityComponent,
  CacheComponent,
  ClassComponent,
  ContextConsumer,
  ContextProvider,
  DehydratedFragment,
  ForwardRef,
  Fragment,
  FunctionComponent,
  HostComponent,
  HostHoistable,
  HostPortal,
  HostRoot,
  HostSingleton,
  HostText,
  IncompleteClassComponent,
  IncompleteFunctionComponent,
  LazyComponent,
  LegacyHiddenComponent,
  MemoComponent,
  Mode,
  OffscreenComponent,
  Profiler,
  ScopeComponent,
  SimpleMemoComponent,
  SuspenseComponent,
  SuspenseListComponent,
  Throw,
  TracingMarkerComponent,
  ViewTransitionComponent,
} from "./ReactWorkTags.ts";

// A Server Component's debug info, the other kind of owner.
export interface ReactComponentInfo {
  readonly name: string;
  readonly tag?: undefined;
}

interface Named {
  readonly displayName?: unknown;
  readonly name?: unknown;
}

function nameOf(value: unknown): string {
  if ((typeof value === "function" || typeof value === "object") && value !== null) {
    const named = value as Named;
    if (typeof named.displayName === "string" && named.displayName !== "") {
      return named.displayName;
    }
    if (typeof named.name === "string") {
      return named.name;
    }
  }
  return "";
}

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(outerType: unknown, innerType: unknown, wrapperName: string): string {
  const functionName = nameOf(innerType);
  const outerDisplayName = (outerType as Named).displayName;
  if (typeof outerDisplayName === "string" && outerDisplayName !== "") {
    return outerDisplayName;
  }
  return functionName !== "" ? `${wrapperName}(${functionName})` : wrapperName;
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContextBase): string {
  return type.displayName || "Context";
}

export function getComponentNameFromOwner(owner: Fiber | ReactComponentInfo): string | null {
  if (typeof owner.tag === "number") {
    return getComponentNameFromFiber(owner as Fiber);
  }
  if (typeof owner.name === "string") {
    return owner.name;
  }
  return null;
}

// The name of a component the user wrote: a function's display name or
// name, or a string type.
function getUserTypeName(type: unknown): string | null {
  if (typeof type === "function" || type instanceof ClassComponentType) {
    return nameOf(type) || null;
  }
  if (typeof type === "string") {
    return type;
  }
  return null;
}

export function getComponentNameFromFiber(fiber: Fiber): string | null {
  const { tag, type } = fiber;
  switch (tag) {
    case ActivityComponent:
      return "Activity";
    case CacheComponent:
      return "Cache";
    case ContextConsumer: {
      const consumer = type as ReactContextConsumer;
      return getContextName(consumer._context) + ".Consumer";
    }
    case ContextProvider: {
      const context = type as ReactContextBase;
      return getContextName(context);
    }
    case DehydratedFragment:
      return "DehydratedFragment";
    case ForwardRef:
      return getWrappedName(type, (type as { render?: unknown }).render, "ForwardRef");
    case Fragment:
      return "Fragment";
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      // Host component type is the display name (e.g. "div", "View")
      return type as string;
    case HostPortal:
      return "Portal";
    case HostRoot:
      return "Root";
    case HostText:
      return "Text";
    case LazyComponent:
      // Name comes from the type in this case; we don't have a tag.
      return getComponentNameFromType(type);
    case Mode:
      if (type === REACT_STRICT_MODE_TYPE) {
        // Don't be less specific than shared/getComponentNameFromType
        return "StrictMode";
      }
      return "Mode";
    case OffscreenComponent:
      if (fiber.return !== null) {
        return getComponentNameFromFiber(fiber.return);
      }
      return null;
    case Profiler:
      return "Profiler";
    case ScopeComponent:
      return "Scope";
    case SuspenseComponent:
      return "Suspense";
    case SuspenseListComponent:
      return "SuspenseList";
    case TracingMarkerComponent:
      return "TracingMarker";
    case ViewTransitionComponent:
      if (enableViewTransition) {
        return "ViewTransition";
      }
      // The display name for these tags come from the user-provided type.
      return disableLegacyMode ? null : getUserTypeName(type);
    case IncompleteClassComponent:
    case IncompleteFunctionComponent:
      return disableLegacyMode ? null : getUserTypeName(type);
    case ClassComponent:
    case FunctionComponent:
    case MemoComponent:
    case SimpleMemoComponent:
      return getUserTypeName(type);
    case LegacyHiddenComponent:
      if (enableLegacyHidden) {
        return "LegacyHidden";
      }
      break;
    case Throw: {
      if (isDevelopment) {
        // For an error in child position we use the name of the inner most parent component.
        // Whether a Server Component or the parent Fiber.
        const debugInfo = fiber._debugInfo;
        if (debugInfo != null) {
          for (let i = debugInfo.length - 1; i >= 0; i--) {
            const name = (debugInfo[i] as { name?: unknown }).name;
            if (typeof name === "string") {
              return name;
            }
          }
        }
        if (fiber.return === null) {
          return null;
        }
        return getComponentNameFromFiber(fiber.return);
      }
      return null;
    }
  }

  return null;
}

export default getComponentNameFromFiber;

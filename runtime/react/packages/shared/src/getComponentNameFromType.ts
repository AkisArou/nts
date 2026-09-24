import {
  REACT_ACTIVITY_TYPE,
  REACT_CLIENT_REFERENCE,
  REACT_CONSUMER_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_LAZY_TYPE,
  REACT_MEMO_TYPE,
  REACT_PORTAL_TYPE,
  REACT_PROFILER_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_VIEW_TRANSITION_TYPE,
} from "./ReactSymbols.ts";
import type { LazyComponent } from "./ReactTypes.ts";

// A named value: a function or one of React's exotic component objects.
interface Named {
  readonly $$typeof?: unknown;
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

function getWrappedName(outerType: Named, innerType: unknown, wrapperName: string): string {
  if (typeof outerType.displayName === "string" && outerType.displayName !== "") {
    return outerType.displayName;
  }
  const functionName = nameOf(innerType);
  return functionName !== "" ? `${wrapperName}(${functionName})` : wrapperName;
}

function getContextName(context: Named): string {
  return typeof context.displayName === "string" && context.displayName !== ""
    ? context.displayName
    : "Context";
}

// The display name of an element type, for warnings and tooling. The
// reconciler prefers getComponentNameFromFiber.
export function getComponentNameFromType(type: unknown): string | null {
  if (type == null) {
    return null;
  }
  if (typeof type === "function") {
    if ((type as Named).$$typeof === REACT_CLIENT_REFERENCE) {
      return null;
    }
    return nameOf(type) || null;
  }
  if (typeof type === "string") {
    return type;
  }
  switch (type) {
    case REACT_FRAGMENT_TYPE:
      return "Fragment";
    case REACT_PROFILER_TYPE:
      return "Profiler";
    case REACT_STRICT_MODE_TYPE:
      return "StrictMode";
    case REACT_SUSPENSE_TYPE:
      return "Suspense";
    case REACT_SUSPENSE_LIST_TYPE:
      return "SuspenseList";
    case REACT_ACTIVITY_TYPE:
      return "Activity";
    case REACT_VIEW_TRANSITION_TYPE:
      return "ViewTransition";
  }
  if (typeof type === "object") {
    const exotic = type as Named & {
      readonly _context?: Named;
      readonly render?: unknown;
      readonly type?: unknown;
    };
    switch (exotic.$$typeof) {
      case REACT_PORTAL_TYPE:
        return "Portal";
      case REACT_CONTEXT_TYPE:
        return getContextName(exotic);
      case REACT_CONSUMER_TYPE:
        return getContextName(exotic._context ?? {}) + ".Consumer";
      case REACT_FORWARD_REF_TYPE:
        return getWrappedName(exotic, exotic.render, "ForwardRef");
      case REACT_MEMO_TYPE: {
        if (typeof exotic.displayName === "string" && exotic.displayName !== "") {
          return exotic.displayName;
        }
        return getComponentNameFromType(exotic.type) || "Memo";
      }
      case REACT_LAZY_TYPE: {
        const lazy = type as LazyComponent<unknown, unknown>;
        try {
          return getComponentNameFromType(lazy._init(lazy._payload));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// The native build's twin of ReactComponentStackFrame.ts.
//
// Upstream finds a component's source location by calling it under a fake
// error and reading the VM's stack. A compiled binary keeps no stack frames,
// so a native frame is the component's name, which is what upstream falls
// back to when it cannot read a stack. Its location says so -- `(native)`,
// as V8 wrote for a frame with no source -- so a component stack of names
// only reads as that, not as a stack cut short.

import { ClassComponentType } from "./ReactClassComponentType.ts";

export interface DispatcherHolder {
  H: unknown;
}

export function describeBuiltInComponentFrame(name: string): string {
  return "\n    at " + name + " (native)";
}

export function describeDebugInfoFrame(name: string, env: string | null | undefined, _location: Error | null | undefined): string {
  return describeBuiltInComponentFrame(name + (env ? " [" + env + "]" : ""));
}

// `displayName` if a string was set, otherwise the function's own name. A
// class component's type here is its descriptor (CLASS-COMPONENTS.md), which
// carries both.
function componentName(component: unknown): string {
  if (component instanceof ClassComponentType) {
    return component.displayName ?? component.name;
  }
  if (typeof component === "function") {
    const named = component as { readonly displayName?: unknown; readonly name?: unknown };
    if (typeof named.displayName === "string" && named.displayName !== "") {
      return named.displayName;
    }
    if (typeof named.name === "string") {
      return named.name;
    }
  }
  return "";
}

export function describeNativeComponentFrame(component: unknown, _construct: boolean, _internals: DispatcherHolder): string {
  const name = componentName(component);
  return name === "" ? "" : describeBuiltInComponentFrame(name);
}

export function describeClassComponentFrame(ctor: unknown, internals: DispatcherHolder): string {
  return describeNativeComponentFrame(ctor, true, internals);
}

export function describeFunctionComponentFrame(fn: unknown, internals: DispatcherHolder): string {
  return describeNativeComponentFrame(fn, false, internals);
}

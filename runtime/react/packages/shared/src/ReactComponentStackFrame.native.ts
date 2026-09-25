// The native build's twin of ReactComponentStackFrame.ts.
//
// Upstream finds a component's source location by calling it under a fake
// error and reading the VM's stack. A compiled binary keeps no stack frames,
// so a native frame is the component's name, which is what upstream falls
// back to when it cannot read a stack.

export interface DispatcherHolder {
  H: unknown;
}

export function describeBuiltInComponentFrame(name: string): string {
  return "\n    at " + name;
}

export function describeDebugInfoFrame(name: string, env: string | null | undefined, _location: Error | null | undefined): string {
  return describeBuiltInComponentFrame(name + (env ? " [" + env + "]" : ""));
}

// `displayName` if a string was set, otherwise the function's own name.
function componentName(component: unknown): string {
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

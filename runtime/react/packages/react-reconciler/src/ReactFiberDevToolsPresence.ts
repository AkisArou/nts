// Whether React DevTools is installed, decided once when the module loads.
//
// A leaf module, imported by package path: ReactFiberLane needs this, and
// taking it from ReactFiberDevToolsHook (which imports half the reconciler)
// made a module cycle that reads lane constants before they exist. A native
// build binds the twin, where it is the literal `false`.
export const isDevToolsPresent: boolean =
  typeof (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined";

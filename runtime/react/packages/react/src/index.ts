// The `react` package, stable channel: the same exports as upstream's
// production build. Development adds two (see index.development.ts).

import { REACT_ACTIVITY_TYPE, REACT_FRAGMENT_TYPE, REACT_PROFILER_TYPE, REACT_STRICT_MODE_TYPE, REACT_SUSPENSE_TYPE, REACT_VIEW_TRANSITION_TYPE } from "shared/ReactSymbols.ts";
import { count, forEach, map, only, toArray } from "./ReactChildren.ts";
import * as ReactCompilerRuntime from "./compiler-runtime.ts";

export const Children = { map, forEach, count, toArray, only };
export const Activity: symbol = REACT_ACTIVITY_TYPE;
export const Fragment: symbol = REACT_FRAGMENT_TYPE;
export const Profiler: symbol = REACT_PROFILER_TYPE;
export const StrictMode: symbol = REACT_STRICT_MODE_TYPE;
export const Suspense: symbol = REACT_SUSPENSE_TYPE;
export const ViewTransition: symbol = REACT_VIEW_TRANSITION_TYPE;
export const version = "19.3.0";

export { ReactSharedInternals as __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE } from "./ReactSharedInternalsClient.ts";
export { ReactCompilerRuntime as __COMPILER_RUNTIME };
export { Component, PureComponent } from "./ReactBaseClasses.ts";
export { cache, cacheSignal } from "./ReactCacheClient.ts";
export { createContext } from "./ReactContext.ts";
export { createRef } from "./ReactCreateRef.ts";
export { forwardRef } from "./ReactForwardRef.ts";
export {
  use,
  useActionState,
  useCacheRefresh as unstable_useCacheRefresh,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react/ReactHooks.ts";
export { cloneElement, createElement, isValidElement } from "./jsx/ReactJSXElement.ts";
export { lazy } from "./ReactLazy.ts";
export { memo } from "./ReactMemo.ts";
export { startTransition } from "./ReactStartTransition.ts";
export { addTransitionType } from "./ReactTransitionType.ts";

// Calls into user code (components, class lifecycles, effects, lazy
// initializers) through functions named `react_stack_bottom_frame`, so that
// development stacks can cut every frame below them.
// TODO: Consider marking the whole bundle instead of these boundaries.
//
// Upstream exports these only in development and null otherwise; callers
// only use them in development. Here they are always defined, which costs
// nothing where they are not called.

import type { LazyComponent } from "shared/ReactTypes.ts";
import type { CapturedValue } from "./ReactCapturedValue.ts";
import { isRendering, setIsRendering } from "./ReactCurrentFiber.ts";
import type { Effect } from "./ReactFiberHooks.ts";
import { captureCommitPhaseError } from "./ReactFiberWorkLoop.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

// The lifecycle methods of a class component instance that React calls.
export interface ClassInstance<R> {
  render(): R;
  componentDidMount(): void;
  componentDidUpdate(prevProps: unknown, prevState: unknown, snapshot: unknown): void;
  componentDidCatch(error: unknown, errorInfo: { componentStack: string }): void;
  componentWillUnmount(): void;
}

// Each function is a method named `react_stack_bottom_frame`, bound so the
// name survives: stack filtering looks for it.

const callComponent = {
  react_stack_bottom_frame: function <Props, Arg, R>(
    Component: (p: Props, arg: Arg) => R,
    props: Props,
    secondArg: Arg,
  ): R {
    const wasRendering = isRendering;
    setIsRendering(true);
    try {
      return Component(props, secondArg);
    } finally {
      setIsRendering(wasRendering);
    }
  },
};

export const callComponentInDEV: <Props, Arg, R>(
  Component: (p: Props, arg: Arg) => R,
  props: Props,
  secondArg: Arg,
) => R = callComponent.react_stack_bottom_frame.bind(callComponent);

const callRender = {
  react_stack_bottom_frame: function <R>(instance: ClassInstance<R>): R {
    const wasRendering = isRendering;
    setIsRendering(true);
    try {
      return instance.render();
    } finally {
      setIsRendering(wasRendering);
    }
  },
};

export const callRenderInDEV: <R>(instance: ClassInstance<R>) => R = callRender.react_stack_bottom_frame.bind(callRender);

const callComponentDidMount = {
  react_stack_bottom_frame: function (finishedWork: Fiber, instance: ClassInstance<unknown>): void {
    try {
      instance.componentDidMount();
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  },
};

export const callComponentDidMountInDEV: (finishedWork: Fiber, instance: ClassInstance<unknown>) => void =
  callComponentDidMount.react_stack_bottom_frame.bind(callComponentDidMount);

const callComponentDidUpdate = {
  react_stack_bottom_frame: function (
    finishedWork: Fiber,
    instance: ClassInstance<unknown>,
    prevProps: unknown,
    prevState: unknown,
    snapshot: unknown,
  ): void {
    try {
      instance.componentDidUpdate(prevProps, prevState, snapshot);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  },
};

export const callComponentDidUpdateInDEV: (
  finishedWork: Fiber,
  instance: ClassInstance<unknown>,
  prevProps: unknown,
  prevState: unknown,
  snapshot: unknown,
) => void = callComponentDidUpdate.react_stack_bottom_frame.bind(callComponentDidUpdate);

const callComponentDidCatch = {
  react_stack_bottom_frame: function (instance: ClassInstance<unknown>, errorInfo: CapturedValue<unknown>): void {
    const error = errorInfo.value;
    const stack = errorInfo.stack;
    instance.componentDidCatch(error, {
      componentStack: stack !== null ? stack : "",
    });
  },
};

export const callComponentDidCatchInDEV: (instance: ClassInstance<unknown>, errorInfo: CapturedValue<unknown>) => void =
  callComponentDidCatch.react_stack_bottom_frame.bind(callComponentDidCatch);

const callComponentWillUnmount = {
  react_stack_bottom_frame: function (
    current: Fiber,
    nearestMountedAncestor: Fiber | null,
    instance: ClassInstance<unknown>,
  ): void {
    try {
      instance.componentWillUnmount();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  },
};

export const callComponentWillUnmountInDEV: (
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: ClassInstance<unknown>,
) => void = callComponentWillUnmount.react_stack_bottom_frame.bind(callComponentWillUnmount);

const callCreate = {
  react_stack_bottom_frame: function (effect: Effect): (() => void) | void {
    const create = effect.create;
    const inst = effect.inst;
    const destroy = create();
    inst.destroy = destroy;
    return destroy;
  },
};

export const callCreateInDEV: (effect: Effect) => (() => void) | void = callCreate.react_stack_bottom_frame.bind(callCreate);

const callDestroy = {
  react_stack_bottom_frame: function (current: Fiber, nearestMountedAncestor: Fiber | null, destroy: () => void): void {
    try {
      destroy();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  },
};

export const callDestroyInDEV: (current: Fiber, nearestMountedAncestor: Fiber | null, destroy: () => void) => void =
  callDestroy.react_stack_bottom_frame.bind(callDestroy);

const callLazyInit = {
  react_stack_bottom_frame: function (lazy: LazyComponent<unknown, unknown>): unknown {
    const payload = lazy._payload;
    const init = lazy._init;
    return init(payload);
  },
};

export const callLazyInitInDEV: (lazy: LazyComponent<unknown, unknown>) => unknown =
  callLazyInit.react_stack_bottom_frame.bind(callLazyInit);

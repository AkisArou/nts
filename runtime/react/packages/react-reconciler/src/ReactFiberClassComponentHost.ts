// Where the reconciler relied on the JavaScript object model for a class
// component (see CLASS-COMPONENTS.md): constructing it from the value it holds,
// and asking whether it defines a lifecycle. The native build binds
// ReactFiberClassComponentHost.native.ts, which knows only descriptors.
//
// In this build a fiber's type is the class itself, as upstream has it, or
// the descriptor the React stage wrote for it: both are accepted.

import { ClassComponentType, lifecycleNames, Render } from "shared/ReactClassComponentType.ts";
import type { ClassComponentConstructor, ClassInstance } from "./ReactFiberClassComponent.ts";

/** `new ctor(props, context)`. */
export function construct(ctor: ClassComponentConstructor, props: unknown, context: unknown): ClassInstance {
  if (ctor instanceof ClassComponentType) {
    return ctor.create(props, context) as ClassInstance;
  }
  const Class = ctor as unknown as new (props: unknown, context: unknown) => ClassInstance;
  return new Class(props, context);
}

/** Whether `instance`, of the class `ctor` (a fiber's `type`), defines the lifecycle method `lifecycle` (a bit). */
export function defines(_ctor: unknown, instance: object, lifecycle: number): boolean {
  const name = lifecycleNames[31 - Math.clz32(lifecycle)]!;
  return typeof (instance as unknown as { readonly [name: string]: unknown })[name] === "function";
}

// How many arguments upstream passes each method, by its bit's index:
// `lifecycleNames`, then `render`.
const arity: readonly number[] = [3, 0, 0, 2, 2, 3, 3, 0, 3, 0, 2, 2, 0, 0];

/**
 * Calls the method `lifecycle` (a bit, or `Render`) on `instance`, with as many
 * of `a, b, c` as upstream passes it: `instance.componentDidUpdate(prevProps,
 * prevState, snapshot)`, `instance.render()`.
 */
export function invoke(instance: object, lifecycle: number, a: unknown, b: unknown, c: unknown): unknown {
  const index = 31 - Math.clz32(lifecycle);
  const name = lifecycle === Render ? "render" : lifecycleNames[index]!;
  const method = (instance as { readonly [name: string]: unknown })[name] as (this: object, ...args: unknown[]) => unknown;
  switch (arity[index]) {
    case 0:
      return method.call(instance);
    case 2:
      return method.call(instance, a, b);
    default:
      return method.call(instance, a, b, c);
  }
}

/** `setState`'s merge of `partial` into `prev`, for a class `ctor`: a copy with both. */
export function mergeState(_ctor: unknown, prev: unknown, partial: unknown): unknown {
  return Object.assign({}, prev, partial);
}

/** Whether a fiber's `type` is a class component. */
export function isClassComponentType(type: unknown): boolean {
  if (type instanceof ClassComponentType) {
    return true;
  }
  // Upstream's marker: `isReactComponent` on the prototype.
  const prototype = (type as { prototype?: { isReactComponent?: unknown } }).prototype;
  return typeof type === "function" && !!(prototype && prototype.isReactComponent);
}

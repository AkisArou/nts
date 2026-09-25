// Where the reconciler relied on the JavaScript object model for a class
// component (see CLASS-COMPONENTS.md): constructing it from the value it holds,
// and asking whether it defines a lifecycle. The native build binds
// ReactFiberClassComponentHost.native.ts, which knows only descriptors.
//
// In this build a fiber's type is the class itself, as upstream has it, or
// the descriptor the React stage wrote for it: both are accepted.

import { ClassComponentType, lifecycleNames } from "shared/ReactClassComponentType.ts";
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

/** Whether a fiber's `type` is a class component. */
export function isClassComponentType(type: unknown): boolean {
  if (type instanceof ClassComponentType) {
    return true;
  }
  // Upstream's marker: `isReactComponent` on the prototype.
  const prototype = (type as { prototype?: { isReactComponent?: unknown } }).prototype;
  return typeof type === "function" && !!(prototype && prototype.isReactComponent);
}

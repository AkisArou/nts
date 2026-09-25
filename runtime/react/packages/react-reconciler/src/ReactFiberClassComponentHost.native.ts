// The native build's twin of ReactFiberClassComponentHost.ts: a class
// component's fiber type is always its descriptor, the `$$type` the React
// stage wrote (see CLASS-COMPONENTS.md). There is no class object to
// construct or to ask about its methods, so the descriptor answers both.

import { ClassComponentType } from "shared/ReactClassComponentType.ts";
import type { ClassComponentConstructor, ClassInstance } from "./ReactFiberClassComponent.ts";

export function construct(ctor: ClassComponentConstructor, props: unknown, context: unknown): ClassInstance {
  return ctor.create(props, context) as ClassInstance;
}

export function defines(ctor: unknown, _instance: object, lifecycle: number): boolean {
  return ((ctor as ClassComponentType).lifecycles & lifecycle) !== 0;
}

export function isClassComponentType(type: unknown): boolean {
  return type instanceof ClassComponentType;
}

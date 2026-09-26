// The native build's twin of ReactFiberClassComponentHost.ts: a class
// component's fiber type is always its descriptor, the `$$type` the React
// stage wrote (see CLASS-COMPONENTS.md). There is no class object to
// construct or to ask about its methods, so the descriptor answers both.

import { ClassComponentType } from "shared/ReactClassComponentType.ts";
import type { ClassComponentConstructor, ClassInstance } from "./ReactFiberClassComponent.ts";
import type { ClassComponentInstance } from "shared/ReactClassComponentInstance.ts";
import type { RootState } from "./ReactFiberRoot.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

export function construct(ctor: ClassComponentConstructor, props: unknown, context: unknown): ClassInstance {
  return ctor.create(props, context) as ClassInstance;
}

// A method is called through the class's descriptor, which names the class:
// the reconciler holds instances by their non-generic base, which declares
// no methods, and never calls one directly.
export function invoke(instance: object, lifecycle: number, a: unknown, b: unknown, c: unknown): unknown {
  const fiber = (instance as ClassComponentInstance)._reactInternals as Fiber;
  return (fiber.type as ClassComponentType).invoke(instance, lifecycle, a, b, c);
}

export function defines(ctor: unknown, _instance: object, lifecycle: number): boolean {
  return ((ctor as ClassComponentType).lifecycles & lifecycle) !== 0;
}

// The class update queue serves two kinds of fiber: a class component, whose
// descriptor merges its own state type, and the root, whose type is null
// and whose updates carry part of a RootState.
export function mergeState(ctor: unknown, prev: unknown, partial: unknown): unknown {
  if (!(ctor instanceof ClassComponentType)) {
    return mergeRootState(prev as RootState, partial as Partial<RootState>);
  }
  const merge = ctor.mergeState;
  if (merge === null) {
    throw new Error(`${ctor.name} sets state but declares no state type: extend Component<Props, State>.`);
  }
  return merge(prev, partial);
}

export function isClassComponentType(type: unknown): boolean {
  return type instanceof ClassComponentType;
}

function mergeRootState(prev: RootState, partial: Partial<RootState>): RootState {
  return {
    element: "element" in partial ? partial.element : prev.element,
    isDehydrated: "isDehydrated" in partial ? partial.isDehydrated! : prev.isDehydrated,
    cache: "cache" in partial ? partial.cache! : prev.cache,
  };
}

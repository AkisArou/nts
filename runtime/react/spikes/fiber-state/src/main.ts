// How to type a fiber field whose content depends on the fiber's tag, when
// every possible content is a reconciler-owned class.

class Hook {
  next: Hook | null = null;
  baseCount: number;
  constructor(baseCount: number) {
    this.baseCount = baseCount;
  }
}
class SuspenseState {
  retryCount: number;
  constructor(retryCount: number) {
    this.retryCount = retryCount;
  }
}
class OffscreenState {
  visible: boolean;
  constructor(visible: boolean) {
    this.visible = visible;
  }
}

// Arm U: the field is a union of the classes, narrowed with instanceof.
class FiberU {
  memoizedState: Hook | SuspenseState | OffscreenState | null = null;
  tag: number;
  constructor(tag: number) {
    this.tag = tag;
  }
}

function readU(fiber: FiberU): number {
  const state = fiber.memoizedState;
  if (state instanceof Hook) return state.baseCount;
  if (state instanceof SuspenseState) return state.retryCount;
  if (state instanceof OffscreenState) return state.visible ? 1 : 0;
  return -1;
}

// Arm B: the field is an abstract base class, narrowed with instanceof.
abstract class FiberState {}
class HookB extends FiberState {
  next: HookB | null = null;
  baseCount: number;
  constructor(baseCount: number) {
    super();
    this.baseCount = baseCount;
  }
}
class SuspenseStateB extends FiberState {
  retryCount: number;
  constructor(retryCount: number) {
    super();
    this.retryCount = retryCount;
  }
}
class FiberB {
  memoizedState: FiberState | null = null;
  tag: number;
  constructor(tag: number) {
    this.tag = tag;
  }
}

function readB(fiber: FiberB): number {
  const state = fiber.memoizedState;
  if (state instanceof HookB) return (state as HookB).baseCount;
  if (state instanceof SuspenseStateB) return (state as SuspenseStateB).retryCount;
  return -1;
}

// Arm F: one typed field per kind of state; the tag says which is set.
class FiberF {
  hooks: Hook | null = null;
  suspenseState: SuspenseState | null = null;
  tag: number;
  constructor(tag: number) {
    this.tag = tag;
  }
}

function readF(fiber: FiberF): number {
  if (fiber.tag === 0) return fiber.hooks !== null ? fiber.hooks.baseCount : -1;
  if (fiber.tag === 13) return fiber.suspenseState !== null ? fiber.suspenseState.retryCount : -1;
  return -1;
}

export function run(n: number, which: number): number {
  const u = new FiberU(0);
  const b = new FiberB(0);
  if (which === 0) {
    u.memoizedState = new Hook(n);
    b.memoizedState = new HookB(n);
  } else if (which === 1) {
    u.memoizedState = new SuspenseState(n + 1);
    b.memoizedState = new SuspenseStateB(n + 1);
  } else if (which === 2) {
    u.memoizedState = new OffscreenState(n > 0);
  }
  const f = new FiberF(which === 0 ? 0 : 13);
  if (which === 0) f.hooks = new Hook(n);
  else if (which === 1) f.suspenseState = new SuspenseState(n + 1);
  return (readU(u) * 1000 + readB(b)) * 1000 + readF(f);
}

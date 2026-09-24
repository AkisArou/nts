interface TypedStateHook {
  memoizedState: number;
  baseState: number;
}

interface ErasedStateHook {
  memoizedState: number | string;
  baseState: number | string;
}

export function typedHookReads(iterations: number): number {
  const hook: TypedStateHook = {
    memoizedState: 1,
    baseState: 0,
  };
  let result = 0;
  for (let index = 0; index < iterations; index++) {
    result += hook.memoizedState;
  }
  return result;
}

export function erasedHookReads(
  iterations: number,
  chooseString: boolean,
): number {
  const initial: number | string = chooseString ? "not a number" : 1;
  const hook: ErasedStateHook = {
    memoizedState: initial,
    baseState: initial,
  };
  let result = 0;
  for (let index = 0; index < iterations; index++) {
    const state = hook.memoizedState;
    if (typeof state !== "number") {
      return -1;
    }
    result += state;
  }
  return result;
}

export function typedAlternatingReads(
  iterations: number,
  first: number,
  second: number,
): number {
  let result = 0;
  for (let index = 0; index < iterations; index++) {
    result += index % 2 === 0 ? first : second;
  }
  return result;
}

export function erasedAlternatingReads(
  iterations: number,
  first: number | string,
  second: number | string,
): number {
  let result = 0;
  for (let index = 0; index < iterations; index++) {
    const state = index % 2 === 0 ? first : second;
    if (typeof state !== "number") {
      return -1;
    }
    result += state;
  }
  return result;
}

// Equal when both values are the same, or are objects with the same own
// keys whose values are the same (`Object.is`). React's props and state
// comparison for `memo` and `PureComponent`.
export function shallowEqual(objA: unknown, objB: unknown): boolean {
  if (Object.is(objA, objB)) {
    return true;
  }
  if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
    return false;
  }
  const recordA = objA as { [key: string]: unknown };
  const recordB = objB as { [key: string]: unknown };
  const keysA = Object.keys(recordA);
  const keysB = Object.keys(recordB);
  if (keysA.length !== keysB.length) {
    return false;
  }
  // Test for A's keys different from B.
  for (let i = 0; i < keysA.length; i++) {
    const currentKey = keysA[i]!;
    if (!Object.hasOwn(recordB, currentKey) || !Object.is(recordA[currentKey], recordB[currentKey])) {
      return false;
    }
  }
  return true;
}

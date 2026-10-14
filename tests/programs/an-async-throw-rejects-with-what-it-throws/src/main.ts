// An `async` function's `throw` rejects its promise with exactly what it
// threw: a number, a string, and an explicit `null`, not only an object.
//
// The lowering once held a rejection reason as an object reference, so it
// refused `throw n` in an `async` body ("throwing something that is not a
// reference") and rejected a thrown `null` reference with `undefined`. The
// runtime's tagged `nts_promise_reject_value` keeps every one of them.

async function failWithNumber(n: number): Promise<number> {
  if (n > 0) throw n;
  return n;
}

async function failWithText(n: number): Promise<number> {
  if (n > 0) throw "text " + n;
  return n;
}

async function failWith(error: Error | null): Promise<number> {
  throw error;
}

export async function caughtNumber(n: number): Promise<number> {
  try {
    return await failWithNumber(n);
  } catch (e) {
    return typeof e === "number" ? e * 2 : -1;
  }
}

export async function caughtText(n: number): Promise<number> {
  try {
    return await failWithText(n);
  } catch (e) {
    return typeof e === "string" ? e.length : -1;
  }
}

export async function caughtNull(n: number): Promise<number> {
  try {
    await failWith(n > 0 ? null : new Error("x"));
    return 0;
  } catch (e) {
    return e === null ? 1 : e === undefined ? 2 : e instanceof Error ? 3 : 4;
  }
}

// The same `null`, thrown and caught synchronously: the erasure of a nullable
// reference reads its absence, so a thrown null is `null` in the handler.
function throwing(error: Error | null): number {
  throw error;
}

export function caughtNullSynchronously(n: number): number {
  try {
    return throwing(n > 0 ? null : new Error("x"));
  } catch (e) {
    return e === null ? 1 : e === undefined ? 2 : e instanceof Error ? 3 : 4;
  }
}

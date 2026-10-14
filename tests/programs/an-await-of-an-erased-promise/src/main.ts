// A value held as `unknown`, then resolved: awaited, returned from an `async`
// function, passed to `Promise.resolve`, or handed to an executor's
// `resolve`. A promise among them is adopted, as the specification's promise
// resolve function adopts any promise whatever the static type said, and
// anything else is the value.
//
// Two defects, one on each side of the suspension, and each hid the other.
//
// **Resolving.** `settle` is the one resolve procedure, and it chooses
// adoption from the *type*: `Promise<T>` adopts and anything else fulfils. An
// erased value is the case the type cannot decide, and it fulfilled -- the
// outer promise held the inner one as its payload. Now the tag decides, in
// `nts_promise_resolve_value`.
//
// **Reading.** The resumed half picks its reader from the payload's type, and
// `unknown` had no arm: it fell to `nts_promise_number`. So every `await` of an
// erased value read a double. A number agreed by coincidence -- which is why
// `erasedNumber` and every numeric arm here passed with the first defect alone
// -- and `erasedString` aborted with "read a number from a promise holding
// something else" in C and answered -1 on the JVM, whose `typeof` saw a
// number.
//
// Transcribed from node (v24), each export called with 0 and 3. For n = 3:
//
//     erasedNumber 3      erasedPromise 4     erasedRejection 1
//     erasedString 4      executorResolve 6   promiseResolve 5
//     returned 7

async function unwrap(held: unknown): Promise<number> {
  const v = await held;
  return typeof v === "number" ? v : -1;
}

export async function erasedPromise(n: number): Promise<number> {
  return await unwrap(Promise.resolve(n + 1));
}

/** A rejected inner promise rejects the `await`, and is caught. */
export async function erasedRejection(n: number): Promise<number> {
  const held: unknown = Promise.reject(new Error("inner " + n.toString()));
  try {
    await held;
    return 0;
  } catch (error) {
    return error instanceof Error && error.message === "inner " + n.toString() ? 1 : 2;
  }
}

async function handBack(held: unknown): Promise<unknown> {
  return held;
}

/** `return held` from an `async` function adopts it too. */
export async function returned(n: number): Promise<number> {
  const v = await handBack(Promise.resolve(n + 4));
  return typeof v === "number" ? v : -1;
}

/** `Promise.resolve(held)`. */
export async function promiseResolve(n: number): Promise<number> {
  const held: unknown = Promise.resolve(n + 2);
  const v = await Promise.resolve(held);
  return typeof v === "number" ? v : -1;
}

/** An executor's `resolve(held)`. */
export async function executorResolve(n: number): Promise<number> {
  const held: unknown = Promise.resolve(n + 3);
  const v = await new Promise<unknown>((resolve) => {
    resolve(held);
  });
  return typeof v === "number" ? v : -1;
}

/** Control: an erased number fulfils as itself. */
export async function erasedNumber(n: number): Promise<number> {
  return await unwrap(n);
}

/** Control: an erased string fulfils as itself. */
export async function erasedString(n: number): Promise<number> {
  const held: unknown = n > 0 ? "more" : "none";
  const v = await held;
  return typeof v === "string" ? v.length : -1;
}

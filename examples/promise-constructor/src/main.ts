// `new Promise(executor)`.
//
// The executor runs *synchronously* -- `new Promise(f)` calls `f` before the
// constructor returns -- so when `f` is written at the call, its body belongs
// at the construction site and `resolve` and `reject` never become values. A
// call to `resolve` is the settle it stands for, which is the same helper an
// `async` function's `return` emits.
//
// That is why this needs no closure over the promise, which is what made it
// look hard. `later` below is three lines of C:
//
//     v1 = nts_promise_new();
//     nts_promise_fulfill_number(v1, v0);
//     return v1;
//
// What is refused is an executor that is not an arrow written at the call, and
// a `resolve` used as a value rather than called -- `new Promise(r => { saved =
// r })`, the deferred pattern. Both need a real closure over the promise, and
// both say so.

export function later(n: number): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(n);
  });
}

// The shortest spelling there is: a concise body whose value is discarded.
export async function concise(n: number): Promise<number> {
  return await new Promise<number>((resolve) => resolve(n * 2));
}

// The executor is a statement body with control flow in it, and each path
// settles. Nothing here is special: it is ordinary lowering into the caller.
export async function branching(n: number): Promise<number> {
  const p = new Promise<number>((resolve) => {
    if (n < 0) {
      resolve(-1);
    } else {
      resolve(n + 1);
    }
  });
  return await p;
}

// `reject` settles the other way. The reason is a reference, because that is
// what the runtime holds one as -- a thrown number has no pointer to store.
export async function rejects(n: number): Promise<number> {
  const p = new Promise<number>((resolve, reject) => {
    if (n < 0) {
      reject(new Error("negative"));
    } else {
      resolve(n + 10);
    }
  });
  return await p;
}

// A reference payload settles through `nts_promise_fulfill_tagged`, with the
// tag supplied by the compiler rather than read back off the header.
export async function reference(n: number): Promise<number> {
  const p = new Promise<string>((resolve) => {
    resolve(n < 0 ? "negative" : "not negative");
  });
  const text = await p;
  return text.length;
}

// An `async` function's `throw` rejects the promise it already owns and hands
// it back, which is what its `return` does through `settle`. Before this it
// ended the program, where node rejects and the caller sees a rejection.
async function failing(n: number): Promise<number> {
  if (n < 0) {
    throw new Error("negative");
  }
  return n * 2;
}

export async function propagates(n: number): Promise<number> {
  return await failing(n);
}

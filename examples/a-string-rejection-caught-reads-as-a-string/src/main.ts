// A promise rejected with a string, caught: `typeof e` is `"string"`.
//
// The JVM runtime's `NtsPromise.reject` took the bare reference and tagged it
// `OBJECT`, so the caught value was an object holding a string: this answered
// 2 where node answers 1, on 14 of 29 cases, while C (whose
// `nts_tag_of_reference` reads the string's kind) agreed. The same tag made an
// unhandled string rejection report as `nts: uncaught String`. Found running
// the compiler lane's `.then` fixture whole under `nts.rt.NtsMain`.
//
// The control is `n <= 3`, which does not reject at all, and a reason that is
// an `Error` answers 2 on every backend.
async function kind(n: number): Promise<number> {
  try {
    if (n > 3) await Promise.reject("text");
    if (n < -3) await Promise.reject(new Error("object"));
    return 0;
  } catch (e) {
    return typeof e === "string" ? 1 : 2;
  }
}

export async function probe(n: number): Promise<number> {
  return await kind(n);
}

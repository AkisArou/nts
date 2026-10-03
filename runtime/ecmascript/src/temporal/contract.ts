// Preserve library fields and method parameters while binding object results
// to the shared implementation class. Standard global types also require the
// locale/zoned APIs and intrinsic metadata that these staged classes omit.
// The pinned Temporal API has at most two overloads per method; preserve both
// so implements also checks the string and options forms of round/total.
export type WithResult<T, LibraryResult, SharedResult> = {
  [K in keyof T]: T[K] extends {
    (...args: infer FirstArgs): infer FirstResult;
    (...args: infer SecondArgs): infer SecondResult;
  }
    ? {
        (...args: FirstArgs): FirstResult extends LibraryResult ? SharedResult : FirstResult;
        (...args: SecondArgs): SecondResult extends LibraryResult ? SharedResult : SecondResult;
      }
    : T[K];
};

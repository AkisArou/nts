// `catch (e) { … ; throw e; }` — handle what you recognise and pass the rest on.
//
// It was refused, by the **backend**, with
//
//     NTS2008 a value of type Erased cannot be erased yet; a reference payload
//     needs retain and release that switch on the tag
//
// which is a true sentence about a conversion nobody was asking for. A caught
// value is already erased — it carries its own tag — so erasing it is the
// identity, and `erased_tag` having no tag for "already erased" made it read as
// the unimplemented reference case.
//
// Five sites in lowering already wrote that identity out as a `match`; `throw`
// was the sixth and did not. It is `FuncBuilder::erased` now, said once.
//
// The arms below rethrow **within** a function, where an enclosing `try` catches
// it. A rethrow that leaves the function is a different thing and still refuses:
// an exception does not cross a call boundary here, which is
// `a call inside a try, whose throw would not reach this handler` and a runtime
// design rather than a lowering gap.

/** The plain shape: handle one case, pass the rest outward. */
export function caughtOutside(n: number): number {
  try {
    try {
      throw new TypeError("x");
    } catch (e) {
      if (n > 2) {
        return 1;
      }
      throw e;
    }
  } catch {
    return 2;
  }
}

/** The one the idiom exists for: recognise a kind, rethrow the others, and the
 *  outer handler tells them apart — so a rethrow that lost the value's identity
 *  would answer 30 where node answers 20. */
export function selective(n: number): number {
  try {
    try {
      if (n > 3) {
        throw new TypeError("t");
      }
      throw new RangeError("r");
    } catch (e) {
      if (e instanceof TypeError) {
        return 10;
      }
      throw e;
    }
  } catch (e) {
    return e instanceof RangeError ? 20 : 30;
  }
}

/** Twice, so a rethrow has to survive being caught and thrown again. */
export function rethrowTwice(n: number): number {
  try {
    try {
      try {
        throw new Error("deep");
      } catch (e) {
        throw e;
      }
    } catch (e) {
      throw e;
    }
  } catch {
    return n + 1;
  }
}

/** A fresh error rather than the caught one, which always worked and must keep
 *  working — it is the arm that says this was about the *caught* value. */
export function freshInstead(n: number): number {
  try {
    try {
      throw new TypeError("x");
    } catch {
      throw new RangeError("other");
    }
  } catch (e) {
    return e instanceof RangeError ? n : -1;
  }
}

// `String.fromCodePoint` throws for anything that is not a code point, and the
// throw is the point of this file.
//
// The runtime used to print the value and call `abort()`, on the reasoning --
// written down in `nts_string_from_code_point` -- that a C helper cannot build
// a `RangeError`. That part was true: the class is laid out by the *program*
// and its descriptor lives in the generated file, so the runtime has nothing to
// allocate. The conclusion did not follow. The check belongs in the lowering,
// where the class can be built, which is where `"x".repeat(-1)` already puts
// its own.
//
// What it cost while it was an abort: `punycode.ucs2.encode([NaN])` took the
// whole process down where node throws something catchable, so a module could
// not be tested at all rather than failing one assertion.

export function attempt(point: number): string {
  try {
    return String.fromCodePoint(point);
  } catch (error) {
    if (error instanceof RangeError) {
      return "range:" + (error as RangeError).message;
    }
    if (error instanceof Error) {
      return "error:" + (error as Error).message;
    }
    return "thrown";
  }
}

// A `TypeError` the program constructs, so `identity` below can ask about a
// class that exists.
//
// Without it the checked-cast backend refuses `identity` outright -- `NTS4001
// an instanceof against no class at all` -- where C and LLVM fold the test to
// false and agree with node. Both answers are defensible and only one of them
// is checkable, which is the argument for making the class real rather than
// for dropping the question.
export function wrongType(n: number): string {
  try {
    if (n > 0) {
      throw new TypeError("positive");
    }
    throw new RangeError("not positive");
  } catch (error) {
    return error instanceof TypeError ? "type" : "range";
  }
}

// The identity separately from the message, because a hierarchy can be broken
// at either link -- and an error with the right `name` and the wrong class is
// exactly what the Node-API boundary was building. `instanceof RangeError`
// holding while `instanceof Error` does not is the shape of a compiler that
// records one relation and walks another.
export function identity(point: number): number {
  try {
    String.fromCodePoint(point);
    return 0;
  } catch (error) {
    return (
      (error instanceof RangeError ? 1 : 0) +
      (error instanceof Error ? 10 : 0) +
      (error instanceof TypeError ? 100 : 0)
    );
  }
}

// The three tests the guard makes, each with the value only it catches.
//
// `NaN` is the one worth stating: it fails `point < 0` and it fails
// `point > 0x10FFFF`, so neither comparison sees it and only `point !==
// trunc(point)` does. `-0` is the mirror -- it is an integer and it is not less
// than zero, so it must NOT throw, and a guard written as `point <= 0` would.
export function boundaries(): string {
  return (
    attempt(-0) +
    "|" +
    attempt(0) +
    "|" +
    attempt(0x10ffff) +
    "|" +
    attempt(0x110000) +
    "|" +
    attempt(NaN) +
    "|" +
    attempt(-1) +
    "|" +
    attempt(1.5)
  );
}

// Above the BMP is a surrogate pair, which is the case `fromCharCode` cannot
// express and the reason the two functions are not two names for one.
export function pairLength(point: number): number {
  try {
    return String.fromCodePoint(point).length;
  } catch {
    return -1;
  }
}

// The guard runs per call and not once per program, so a loop that throws part
// way through leaves the accumulated string alone rather than unwinding it.
export function upTo(limit: number): string {
  // Clamped, because the differential's pool puts arbitrary numbers in a loop
  // bound and an unbounded one is a case it declines rather than compares.
  const bound = limit > 8 ? 8 : limit;
  let out = "";
  for (let at = 0; at < bound; at++) {
    try {
      out += String.fromCodePoint(at * 100000);
    } catch {
      out += "!";
    }
  }
  return out;
}

// The message carries the offending value, because node's does: `Invalid code
// point 1.5` and not a fixed sentence. That is the one place a provided error
// needs a message this compiler has to compute.
export function message(point: number): string {
  try {
    String.fromCodePoint(point);
    return "";
  } catch (error) {
    return error instanceof Error ? (error as Error).message : "?";
  }
}

// Infinity fails the ceiling test and -Infinity fails the floor test, and both
// print as themselves rather than as a number.
export function extremes(): string {
  return message(Infinity) + "|" + message(-Infinity);
}

// Two thrown objects merging at one handler, and the handler reads a field off
// whichever arrived.
//
// The reason this is here rather than in `examples/errors`: an error placed in
// the frame has its fields released where its live range ends, and at a join
// neither arm dominates the handler, so there is nowhere to put that release.
// `hir::undominated_names` keeps such an object off the frame for exactly that
// reason, and this is the shape that asks. `acrossTheHierarchy` next door does
// not, because it only asks `instanceof` -- a field released early is invisible
// to a test that reads no field.
export function merged(n: number): string {
  try {
    if (n > 0) {
      throw new TypeError("positive " + n);
    }
    throw new RangeError("not positive " + n);
  } catch (error) {
    return error instanceof Error ? (error as Error).name + "/" + (error as Error).message : "?";
  }
}

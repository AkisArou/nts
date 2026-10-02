// A generator that throws, created by one function and stepped by another
// inside the first's `try`.
//
// e22963ec9 made a generator's step a raising boundary where the frame is
// created at the loop: the creating call's raising suffix tells `protocol_step`
// to test the flag after the resume. Where the frame arrives from elsewhere --
// here a parameter of `sumOf` -- `generator_walk` dispatches through the slot
// the abstract generator declares, and that slot names the *ordinary*
// resumption. So the `throw` is not carried: **the program ends on an uncaught
// RangeError where node answers the handler's -1**, on c, llvm, jvm and rc
// alike. Loud rather than silent, unlike the defect e22963ec9 closed, but the
// `try` does not catch it. The cure is a raising resume slot, the shape
// bb3534948 gave an overridden method.
//
// **Control:** `created`, the same generator stepped where it is created,
// which e22963ec9 fixed and which agrees.
//
// **Expected, confirmed under node:** both arms `-1` for a limit the loop
// reaches, `15` for one it does not.
function* upTo(limit: number): Generator<number> {
  for (let i = 0; i < 6; i++) {
    if (i === limit) throw new RangeError("reached");
    yield i;
  }
}

function sumOf(source: Generator<number>): number {
  let total = 0;
  for (const v of source) total += v;
  return total;
}

function created(limit: number): number {
  try {
    let total = 0;
    for (const v of upTo(limit)) total += v;
    return total;
  } catch {
    return -1;
  }
}

function passedIn(limit: number): number {
  try {
    return sumOf(upTo(limit));
  } catch {
    return -1;
  }
}

observe("created, reached (control)", String(created(2)));
observe("created, not reached (control)", String(created(7)));
observe("passed in, not reached", String(passedIn(7)));
observe("passed in, reached", String(passedIn(2)));
done();

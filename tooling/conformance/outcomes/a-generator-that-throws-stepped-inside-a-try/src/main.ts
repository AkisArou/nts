// A `for...of` over a generator whose `throw` is reached, inside a `try`: the throw is
// **swallowed** and the flag it leaves set is read by an unrelated call, so two arms of one
// program report each other's outcome.
//
// `reached` must answer `-4` (node catches the `RangeError`) and answers the sum instead;
// `unreached` must answer the sum and answers `-2`, catching something that never happened.
//
// # The mechanism, read out of the HIR rather than guessed
//
// The loop header is
//
//     b4(%8: f64):
//       %9 = call countingToward@raises__resume(%3) : bool
//       %10 = not %9 : bool
//       br %10, b5, b6(%8)
//
// -- the **raising** resume, and no `nts_raising()` test after it. So the body's `throw`
// calls `nts_raise`, the resume answers `done`, and the loop exits *normally*: the handler
// never runs. The flag stays set, and the next `nts_raising()` read anywhere in the program
// sees it -- which is the other arm's, emitted after its own generator call.
//
// And the raising resume is named **by accident**. `generator_walk` takes the resumption's
// name from the callee of the call that made the frame (`suspend::resume_name`), and that
// call was given the `@raises` suffix because it sits inside a `try`. Creating a generator
// cannot raise -- the body has not run -- so the suffix there is already wrong, and the
// resumption inherits it. Two names derived from one, which is this file's recurring defect.
//
// So it is three things at once: a call suffixed where nothing can raise, a resumption whose
// name is inherited rather than chosen, and a raising step with no flag test. The fix is for
// the **step** to be the raising boundary: name the raising resumption because the step is
// guarded, and test the flag after it.
//
// # Why both arms are in one file
//
// The interference *is* the finding. The same program without `reached` agrees with node on
// every case -- measured, 116 of 116 across four arms, on a pin of `1005fe5b1` -- so an arm
// that only throws, or only does not, cannot show this. `finite` is the in-file control: a
// generator with no `throw` at all, which must go on answering whatever the others do.
//
// Pre-existing: identical on pins of `6f6fcd78c901` and `98765ccdbd0b`, so it is older than
// the constructor and RequireObjectCoercible work. The ninth instance of the raising row's
// "which callees can raise" family, and the first where the call is **synthesised by a walk**
// rather than written in the source.

function* countingToward(limit: number): Generator<number> {
  let i = 0;
  while (true) {
    if (i > limit) {
      throw new RangeError("stepped too far");
    }
    yield i;
    i += 1;
  }
}

function* finite(limit: number): Generator<number> {
  for (let i = 0; i <= limit; i += 1) {
    yield i;
  }
}

function reached(n: number): number {
  let seen = 0;
  try {
    for (const x of countingToward(n)) {
      seen += x;
      if (seen > 100) {
        break;
      }
    }
    return seen;
  } catch {
    return -4;
  }
}

function unreached(n: number): number {
  let seen = 0;
  try {
    for (const x of countingToward(1000)) {
      seen += x;
      if (x >= n) {
        break;
      }
    }
    return seen;
  } catch {
    return -2;
  }
}

function counted(n: number): number {
  let seen = 0;
  try {
    for (const x of finite(n)) {
      seen += x;
    }
    return seen;
  } catch {
    return -3;
  }
}

observe("a reached throw", `${reached(2)}`);
observe("an unreached throw", `${unreached(2)}`);
observe("the control, no throw at all", `${counted(2)}`);
done();

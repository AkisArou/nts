// expect: nothing refused
//
// **FIXED on 2026-09-12, and kept as a guard.** It filed this:
//
//     an `in` naming `timeout` on an `object`, which `Opts` declares
//     optionally -- its slot exists here whether or not it was written, so no
//     test of the value can say which
//
// Every word of that is still true about the *slot*. What changed is that the
// object header now records whether an optional property was **written**, so a
// type declaring it optionally contributes `is it a C` *and* `is C's bit set`
// rather than making the question unanswerable. The class test was already
// being emitted for the types that declare it always; this is that test with a
// second conjunct.
//
// The refusal was not wrong and did not become wrong. It rested on a fact --
// that nothing recorded the write -- and said which conclusion followed without
// saying which fact it followed from. When the fact changed, the sentence
// stayed true and the conclusion stopped following.
//
// `hasWithRequiredDeclarer` below is now the more important half: it asserts
// that a *required* declarer is still answered by the class test alone, with no
// bit and no runtime call. A version that answered every `in` at run time would
// be correct and would give back what the closed world buys.
//
// Everything below this line is the original filing, kept because its reach
// measurement is what ranked the work.
//
//     class Opts { port: number }   ... "port" in given  -> lowers
//     class Opts { port?: number }  ... "port" in given  -> REFUSED
//
// **`Opts` is never used.** `has` does not take one, return one, or mention one.
// The two programs differ by a single `?` on a declaration in a class the
// refused function never touches, and that decides whether an unrelated `in`
// lowers. `hasWithRequiredDeclarer` below is the control and is byte-identical
// to the subject apart from which class is in scope.
//
// That makes this the same shape as the wrapper's dispatch-slot defect, where
// `Layout::methods` had one entry per dispatch slot **in the whole program** and
// a `Shape`/`Square` hierarchy that never crossed the boundary was enough to
// decline an unrelated five-string record. A program-wide fact deciding a local
// outcome is worth recognising as a category: it is invisible in a reduction
// that keeps only the subject, and it is why a fixture that isolates too well
// can stop reproducing.
//
// **42 distinct sites: stream 23, fs 6, net 3, internal 2, assert 2, and one
// each in util, readline, http, events, dgram, console.** Counted as sites, not
// summed over cones. The types named are `StreamState`, `UnderlyingSink`, an
// anonymous type, `NodeError`, `TransformOptions` and `PushOptions` -- options
// bags and error shapes, which is where optional fields live.
//
// **Distinct from `in-naming-an-optional-key`**, which reports
// `` an `in` naming `maybe`, which is optional `` with no receiver clause and no
// named declarer. That one is about the key on the value's own type; this one is
// about a receiver typed `object` and a declarer found elsewhere. Both messages
// end with the same explanation, which is what made them look like one blocker.

// The control's declarer: `port` is required, so `in` can be decided statically.
class RequiredOpts {
  port: number;
  constructor(port: number) {
    this.port = port;
  }
}

export function hasWithRequiredDeclarer(given: object): boolean {
  return "port" in given && new RequiredOpts(1).port > 0;
}

// The subject's declarer: optional, and never mentioned below.
class Opts {
  timeout?: number;
}

export function has(given: object): boolean {
  return "timeout" in given;
}

export function keepOptsReachable(): Opts {
  return new Opts();
}

// expect: an `in` naming `timeout` on an `object`, which `Opts` declares optionally
//
// `"port" in given` where `given` is typed `object`, in a program where some
// type declares `port` **optionally**. The refusal is correct in what it says --
// an optional slot exists whether or not it was written, so `in` cannot
// distinguish `{}` from `{ port: undefined }` by reading the value -- but the
// trigger is not local to the expression.
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

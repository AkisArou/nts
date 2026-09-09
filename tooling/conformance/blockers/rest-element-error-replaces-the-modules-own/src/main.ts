// expect: emit-c --napi -> emits-addon could not gather the rest arguments
//
// A rest parameter crosses -- `rest-parameter-at-the-wrapper` is a guard now --
// but a **non-conforming element makes the wrapper throw its own error before
// the function runs**, so the module's own validation never happens and node's
// error identity is lost.
//
// Observed on the real artifact, not reasoned about:
//
//     path.resolve(42)
//       compiled   Error: could not gather the rest arguments   e.code undefined
//       node       TypeError: …                                 e.code 'ERR_INVALID_ARG_TYPE'
//
// The compiled error is not a wrong error from our code. It is not from our code
// at all: `subject` below validates its arguments and throws a coded error, and
// that line is never reached. The emitted wrapper is
//
//     if (!nts_napi_check(env, nts_napi_rest(env, info, 0, true, &a0),
//                         "could not gather the rest arguments")) goto …;
//
// -- `nts_napi_rest` decides the elements are unacceptable and `nts_napi_check`
// raises a bare `Error` with that message. `Error` instead of `TypeError`, no
// `code`, and a message describing the wrapper's internals rather than the
// argument.
//
// **This is the "preserve error types" rule, not a cosmetic one.** Node's tests
// assert `e.code`, and every module in this profile routes its argument errors
// through `internal/errors.ts` precisely so the codes match. A boundary that
// replaces them makes every such assertion fail for a reason that has nothing to
// do with the module.
//
// `control` takes one `string` rather than a rest and is published the same way;
// its own validation runs and its coded error survives. So the difference is the
// rest gathering and not argument validation in general.
//
// **What the fixed form looks like**: the wrapper hands the elements through and
// lets the function's own validation produce the error, or raises the module's
// error itself. Either way this message stops appearing for a function that
// validates what it was given, and this fixture goes CHANGED rather than green,
// which is correct -- a person should read what replaced it.
//
// Six published or soon-published rest exports carry this: `path.resolve` and
// `path.join` in both namespaces, `stream.pipeline` and `stream.compose`.
// `path.resolve` and `path.join` are two of the eleven `path` currently
// publishes, so this is live on the axis today rather than latent.

class InvalidArgument extends Error {
  readonly code: string;
  constructor(name: string) {
    super(`The "${name}" argument must be of type string.`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}

export function control(first: string): string {
  if (first.length === 0) throw new InvalidArgument("first");
  return first;
}

export function subject(...args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg.length === 0) throw new InvalidArgument("paths");
  }
  return args.join("/");
}

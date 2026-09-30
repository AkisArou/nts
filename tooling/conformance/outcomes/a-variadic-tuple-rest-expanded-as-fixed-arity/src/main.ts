// Invalid HIR, and the whole program is lost to it: a **variadic** tuple used as
// a rest parameter's type is expanded into exactly as many parameters as it has
// positions, so every call of a different length mismatches.
//
//     invalid HIR: CallArgumentCount { func: "module#init", callee: "f", expected: 2, found: 3 }
//
// -- two of them in this program, one per call length, and the first is what the
// record carries. `module#init` because the harness calls at module scope; reduced
// into named functions the same two lines name those instead.
//
// `f(...args: [string, ...number[]])` takes one string and any number of numbers.
// `effective_parameters` expands a rest whose type is a fixed-arity tuple into that
// many positional parameters -- right, and the whole of why `hold("s", 1)` works --
// and `fixed_arity_positions` answers **2** here, so `f` is emitted as
// `f(args_0: managed<str>, args_1: i32)` and `f("a", 1, 2)` passes three.
//
// **The cause is a fact the snapshot does not carry, which is why no rule in
// lowering can fix it.** `nts types` over this program prints
//
//     #2 Tuple([TypeId(4), TypeId(5)])    #4 String    #5 Number
//
// The rest is flattened to its *element* type and the `...` is gone, so
// `[string, ...number[]]` is **byte-identical here to `[string, number]`** -- and
// the second one genuinely is a two-position tuple that should expand to two
// parameters. Any test lowering could apply would have to answer the same for
// both. What is missing is the rest marker, which is a `SCHEMA_VERSION` change and
// the frontend's half; `docs/typescript.md`'s precision list is where this belongs.
//
// **Pre-existing, measured rather than assumed, and that is what lets this record
// be committed beside the change that found it**: `outcomes-check` run with the
// compiler at `25bb040cd` -- the parent of the tuple-representation work -- reports
// `reproduces` against this record, so it is a claim about main and not about an
// unlanded patch. That work also made a *sibling* of this loud -- a fixed-arity tuple's
// `length` is folded to its position count, which is right for every variadic
// tuple that currently lowers only because a tuple literal whose element count
// differs from the type's is refused. So the same missing marker sits behind two
// answers, and it is a **landmine rather than a trade**: the day a variadic tuple
// lowers, that fold is a silent wrong answer in a commit about something else.
//
// **Control, and it is the one difference that matters:** `fixedTwo` takes
// `[string, number[]]` -- genuinely two positions, one of them an array -- and it
// must go on compiling and answering 2. A rule that refused every tuple-typed rest
// would satisfy this record and break `hold`, `setImmediate` and
// `examples/a-rest-tuple-of-mixed-widths-stored-and-spread`.
//
// Node answers 3, 1 and 2.
function f(...args: [string, ...number[]]): number {
  return args.length;
}

function fixedTwo(...args: [string, number[]]): number {
  return args.length;
}

observe("three", String(f("a", 1, 2)));
observe("one", String(f("a")));
observe("fixed", String(fixedTwo("a", [1, 2])));
done();

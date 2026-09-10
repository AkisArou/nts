# The first declaration was a signature

    overloaded(1, "s")   ->  "number,string"

An overloaded function's wrapper checked only its first argument. Every other
shape's checked all of them, and that contrast is what made the trigger
findable:

    required("s")            threw
    optional("s")            threw
    secondRequired(1, "s")   threw
    secondOptional(1, "s")   threw           second, optional, not overloaded
    overloaded(1, "s")       "number,string"  the string arrived, as a string
    overloaded("s", 1)       threw            first argument still checked

The Node lane ruled out "second" and "optional" by measuring them rather than
by reasoning, so the report arrived with the cause already isolated to overloads.

## One word

A symbol's declarations list the overload **signatures** ahead of the
implementation, and `public_api` handed `optional_scalars`
`declarations.first()`. For `overloaded` that is the one-parameter signature. It
has no `b`, so no optional scalar was recorded at index 1, so the wrapper read
that argument with `nts_from_napi_value` — which accepts every JavaScript value.

    before   nts_from_napi_value(env, argv[1], &a1)
    after    nts_napi_optional_scalar(env, argv[1], "b", "number", &a1)

`implementation_of` picks the declaration carrying a body. A symbol declared
once has no body-less sibling to pass over, so its answer is the argument
unchanged.

## Why it reached further than one argument

`os.setPriority(0, "x")` answered `ERR_OUT_OF_RANGE` where node answers
`ERR_INVALID_ARG_TYPE`. `validateInt32` opens with `typeof value !== "number"`,
and that branch **cannot** fire inside a compiled program: the parameter is
declared `number`, so the guard folds. `Number.isInteger("x")` answered instead.

That is the same sentence as record 0274's: **the boundary stands in for a guard
the declaration deleted.** For overloaded functions it was not standing in.

52 exported functions in `runtime/node` carry overload declarations — fs 32,
os 5, timers 4, stream 3 — which is an upper bound on the reach, not a defect
count.

## The measurement that stopped the wrong fix

The Node lane sent three rows:

    classify(v: number)    called with priority: number     "not-integer"
    classify(v: unknown)   called with priority: number     "not-integer"
    classify(v: unknown)   called with priority: unknown    "not-number"

**The type at the call site decides, not the callee's.** Widening the validator
— the function actually doing the checking, and the obvious repair — changes
nothing.

I had started reasoning toward exactly that fix, on the view that the fold was
the defect. It is not: inside a compiled program `classify(n)` where `n` really
is a number *should* fold, and node agrees — probed at 87 of 87 agreeing before
those rows made sense. So this is one defect wearing two faces rather than two
facts composing, and the fixture says so, including the hour it cost.

`blockers/only-an-overloads-first-argument-is-checked` is a guard now. Its
control is every shape called with the types it declares, which must go on
answering as before: a wrapper that rejected a *valid* argument would satisfy
the expectation and fail the control.

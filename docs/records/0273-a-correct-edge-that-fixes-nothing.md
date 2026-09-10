# A correct edge that fixes nothing

The JVM lane declined two functions of
`examples/a-class-stored-and-compared`:

    storing a `Ctor_Other` where a `Fn3__1` is declared, and the first
    does not extend the second here

A class used as a value has to be assignable to a function type. That lane
represents a callable as an instance of a per-descriptor `Fn$<hash>` base class,
and a constructor token was its own class extending nothing.

They asked whether to relate `Ctor_` layouts to `Fn` descriptors in their
emitter, or whether the IR should say it. The answer was the IR, and the
reasoning was 0265's: `relate_closures_to_signatures` is already the pass that
sets a closure layout's `base` to its signature type, a constructor-as-value is
the same edge from a different source, and a fact with two derivations agrees
until it does not.

There was a second reason, which turned out to be the important one. **The C
lane is getting away with something**: storing a `Ctor_Other *` where an
`Fn3__1 *` is declared emits a pointer cast, and a cast compiles whether or not
the relationship is real. So this is an edge only one of three backends can
detect — exactly the situation where fixing it in that backend buries it.

## Built, measured, reverted

The edge works. `typeof Message` is a `Function` type in the checker, so a
token's base is the signature its own type names:

    PROBE ok 11 -> Fn3__1 [TypeId(11)]      Ctor_Message
    PROBE ok 21 -> Fn3__6 [TypeId(21)]      Ctor_Other

**Two different `Fn` layouts.** `signature_name` keys on the parameter types and
the *return type id*, and `typeof Message` returns `Message` while `typeof
Other` returns `Other`. So `Ctor_Other extends Fn3__6`, the slot is declared
`Fn3__1`, and the verifier refuses exactly as before. Neither decline moved.

The missing thing is not an edge from a token to *a* signature. It is that
`Fn3__6` must be usable where `Fn3__1` is declared — function-type subtyping,
which TypeScript allows because constructor returns are covariant. Single
inheritance cannot express it through `base`: a token would need to relate to
every signature it is assignable to. `Layout::interfaces` can hold many, and
closures use `base`, so adopting it would leave the two disagreeing about what a
callable *is*.

So the change was reverted rather than landed. It would have looked like
progress in every instrument — the pass runs, the base is set, the layout is
well-formed — while costing a `layout_of` side effect in identifier lowering and
a base-first invariant on a layout that had none, in exchange for nothing.

## The result is that two gaps are one shape

`a-structural-cast-that-is-a-prefix` and this one are the same sentence one
representation apart: **two layouts TypeScript relates that the emitted class
hierarchy does not**, structurally in the first and by function-type subtyping
in the second.

Neither lane could have reached that alone. That lane can see its verifier
refusing both; only this one can see that the obvious edge does not move them.

## What it says about instruments

Four defects were found on this axis in one evening —
`nts_value_is_view`, the `nts_symbol_to_string` leak, `object-key-order`, and
the `#count` collision — and every one was found by **writing a case that
reached the code**. Zero were found by auditing a table, including a
92-of-186 extern audit on the JVM lane that reported thirty false gaps and was
reverted the same hour.

That is not "both are useful". On this evidence one instrument works.

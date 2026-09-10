# The `this` type is a type parameter

    NTS1003 `EventEmitter#on` cannot be compiled because it calls
            `addListener`, which was refused above

There was no refusal above. No function named `addListener` appeared in any
dump, raw or prepared, and nothing anywhere said why. On the fifteen-line
reduction: `0 function(s), 2 construct(s) refused` — the two are the cascade,
and the thing they blame emitted nothing at all.

## What the type table gives away

    #8 `T`       TypeParameter { constraint: Some(TypeId(1)) }
    #6 `Emitter` TypeParameter { constraint: Some(TypeId(1)) }

`#6` is the polymorphic `this` type. TypeScript models it as a type parameter
named after the class, constrained by the class — so `addListener(this, ...)`
instantiates `T` to **another type parameter**, and `unify` has:

    if let Some(ty) = representation(snapshot, actual)
        && !is_parameter(snapshot, actual)

which declines to bind one parameter to another. Right for a genuinely unbound
one — `<T extends U, U>` is a call no copy can be emitted for. Wrong for this,
where the constraint pins it exactly.

Nothing was inserted, `T` was never in the substitution, and
`function_instantiations` skipped the call with a `continue` that says nothing.
Its own comment says such a call "is refused where it is *written* rather than
here". It is not; nothing refuses it anywhere.

## Substituting the constraint is what the run time already does

`this` inside `C` means "the receiver's class, which is `C` or a subclass", and
base-first layout makes a derived pointer valid wherever a `C *` is wanted. One
copy over `C` serves every subclass — which is exactly what node's single
JavaScript function does. What is lost is TypeScript's tracking of the subclass
through the *return* type, and that costs nothing compiled: the pointer is the
same and every member reached through it sits at a prefix offset.

Bounded rather than followed to a fixed point: a constraint that is itself a
parameter is genuinely unbound and belongs in the refusal the existing guard
gives it.

## It moves no count, and that is the report

`http`'s cascade went **892 to 895** and its surviving function count did not
move at all. Three modules' root-refusal totals were unchanged to the unit.

What it bought is that the chain is visible. `addListener<obj6675>` now exists
and names its own next obstacle:

    EventEmitter#on
      -> addListener<obj6675>
        -> warnMaxListenersExceeded
          -> MaxListenersExceededWarning#constructor
            -> String(type) on a `string | symbol`

A silent skip became a named cascade. Reporting that as progress requires saying
plainly that the number did not change, because the temptation is to describe
the reach of what it unblocks rather than what it unblocked.

## Found by following a chain, not by ranking a census

Every census this project runs groups NTS1001 by message, and this construct
**has no message**. It could not appear in any of them. What found it was
starting at `http.createServer` and walking the cascade down — five links, each
one named by the diagnostic of the link above.

That is the third time a top item turned out to be something no census could
see, after record 0264's private names and the `is_within_a_function` list. The
common shape: a census ranks what the compiler *says*, and the largest
obstacles are the ones it says nothing about.

# The declaration deleted the guard

`unknown` crosses the boundary now, in both directions. That sentence is the
smaller half of what it is for.

    path.dirname()   ours  TypeError ERR_MISSING_ARGS      "requires 1 argument"
                     node  TypeError ERR_INVALID_ARG_TYPE  "The \"path\" argument must be…"

The obvious reading is that the wrapper's arity check is wrong and node's error
should surface. It is the opposite. `dirname(path: string)` compiles `path` to
`NtsString *`, so the module's own `validateString(path, "path")` is **dead
code** -- `typeof path !== "string"` is statically false for a parameter the
declaration types as a string, and the fold removes it. Take the arity check
away and `path.dirname()` does not produce node's error; it dereferences a null
pointer.

**The boundary is standing in for a guard the declaration deleted.**

## How large that is

The Node lane's first survey asked which exported functions guard a parameter
against their own declared type with an inline `typeof`. One: `win32.toNamespacedPath`,
whose `if (typeof path !== "string" || path.length === 0) return path` is
transcribed from node and never runs.

That survey answered the question it was written to ask. The set that matters is
one hop wider -- a guard that is a *call* to a validator, which the same fold
deletes just as completely, and which no `typeof` search finds:

    validation the declaration deletes entirely     23
      path 16   fs 2   util 2   net 1   process 1   url 1
    validation that keeps live work                  9
      the range validators, whose type test folds and whose range test does not

`path` holding 16 of the 23 is why every symptom of this surfaced there and
nowhere else, which had been reading as "path is simply further along".

## What crosses, and what is refused out loud

A string, number, boolean, `null` and `undefined` cross carrying their tag. An
object, array, function, symbol or bigint raises a `TypeError` naming the
limitation.

Answering `undefined` for a value the caller really passed would be the
wrong-value failure this compiler refuses everywhere else -- the same reason
`0220` backed out a dynamic element read that answered `undefined` for an
`int32_t` array, and the same reason a `Map` predicate that answered true for a
`Set` was not shipped.

Outward, a reference that is not a string is refused for the reason `cross`
refuses one everywhere: an object's identity here is an address and the far side
cannot reproduce what it means.

Verified by loading an addon and calling it. Nine primitive cases round-trip
exactly; `{}` and `[]` raise the TypeError; and `guarded(path: unknown)` --
`toNamespacedPath`'s exact shape -- returns its argument unchanged for every
non-string and prefixes a string.

## Both halves or neither, and why that was a decision

`unknown-at-the-boundary` and `unknown-return-at-the-boundary` were filed
separately because the two directions had come apart before --
`view-parameter-crosses-outward-only` is a case where they did. This time they
landed together on purpose.

`win32.toNamespacedPath` returns its argument, so widening its parameter widens
its return. With only the inward crossing, that export would have gone from
"publishes and throws on a non-string" to "does not publish at all", taking
`path` from 15 published to 11. **A number going down for a change somebody
chose** is the trade this ledger exists to refuse, and offering the other lane a
choice between a worse number and no fix is a way of making it somebody else's
refusal.

## What it moved

    async_hooks   13 published -> 16
    buffer         3 published ->  5
    path, os      unchanged, and will stay so until the declarations widen

The declarations are `runtime/node`'s to change, and the widening is now
unblocked rather than done: 23 guards become live when 23 signatures say
`unknown`, and not before.

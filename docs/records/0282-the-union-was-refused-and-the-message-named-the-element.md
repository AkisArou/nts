# The union was refused, and the message named the element

    constructor(...given: [] | [input: string, base?: string | URL])

    NTS1001 a rest parameter whose element type has no representation

`URL#constructor` does not lower, and under it `fileURLToPath`,
`fileURLToPathBuffer`, `pathToFileURL` and — since 2026-09-10 — `net`'s
`SocketAddress.parse`, which the Node lane rewrote to parse through `URL` and
which is correct on the interpreted lane while not lowering at all. `URL`
publishes no wrapper: *is a class whose constructor was not compiled*.

The union of tuples is how this tree writes "and tell me whether I was called
with no arguments at all". It is what makes `given.length === 0` a type the
checker can narrow, so the `ERR_MISSING_ARGS` branch is reachable without
consulting `arguments`. Thirteen sites across four modules, and **every one uses
the binder only through `.length` and a constant index** — none spreads it,
iterates it, or passes it on.

## The message named the wrong half

`lower_param` asked whether the parameter's own type is `Array(_)`. A union
never is, so the arms were never looked at — and the refusal it wrote was about
the *element* type.

`[] | [number]` has element type `number` in both arms. Nothing heterogeneous,
nothing unrepresentable, and it refused exactly as `[] | [string, URL]` did.
That is the whole finding: the check and its message were about different
questions, and the message was about the one that was fine.

So look at the arms. Every arm a tuple or an array, every position representing
the same way, and the rest is an array of that — which is what a rest parameter
already is. The empty tuple contributes no positions, which is what makes
`[] | [T]` work: it is `T[]` that says "or nothing" in a way the checker can
narrow on.

## Two places, and the second one was hiding

Fixing the declaration was not enough and the fixture said so immediately: the
call site refused with a *different* message, `a rest parameter that is not an
array`. `gather_rest` asks the same question independently, because it has to
build the array the callee will read.

The obvious fix there was wrong in a way worth recording:

    self.represent(ty).or_else(|| self.tuple_union_as_array(ty))   // never fires

**`represent` does not answer `None` for these unions. It answers `Erased`.** A
union of tuples has a perfectly good boxed representation, so the fallback was
unreachable and the call went on refusing while the declaration was already
fixed. Asking the narrower question first is what works, and it is safe because
a genuine array type is not a union.

I read `representation_within` twice and did not see it. What found it was
making the refusal print what it was holding — `ty=Erased kind=Union([...])` —
which took one build and said it in one line.

## The count is exact, and that is the part that matters

The tempting shortcut is to treat the tuple as optional parameters and call
`given.length` the number of leading non-`undefined` values. It is wrong, and
`searchparams.ts` is where it shows: six sites compare `given.length < 2`, and
`form-data.ts` compares `args.length > 1`. `URLSearchParams#set("a")` throws
where `set("a", undefined)` sets the string `"undefined"`.

Nothing had to be built for this. A rest parameter is already gathered at the
call site into a real array, so `given.length` *is* the number of arguments
supplied. `url.ts` only ever compares `=== 0`, so the shortcut would have looked
right in the module that motivated the work and been wrong six lines away.

## What it moved, measured rather than inferred

I wrote "six methods cleared" and it was four. `searchparams.ts` went from
**14 root refusals to 10**: all six rest refusals cleared, but `delete` and
`set` advanced to a *different* wall — `assigning to this property`, at lines
332 and 437, inside bodies that previously refused at their signature.

`url` builds, loads, and publishes the same one name as before, because
`URL#constructor` is the heterogeneous case and still refuses.

### And then the corrected count was also wrong

**`append`, `get`, `getAll` and `has` do not lower**, and the commit message for
`578d142e` says they do. All four cascade:

    NTS1003 `URLSearchParams#append` cannot be compiled because it calls
            `URLSearchParams.#brandCheck`, which was refused above

I checked with `nts hir`, which shows *raw lowering* and does not run the
cascade, so the four appeared with nothing against them and read as clear.
`nts hir --prepared` is what a backend receives, and it names all four. The Node
lane caught it by rebuilding rather than by reading my message, which is the
only reason it is written down here rather than standing.

That is the same error twice in one record, one level apart. First "six refusals
cleared" reported as six functions; then four functions reported as four
*compiling* functions. **A refusal that disappears from a file is not a function
that lowers, and a function that lowers is not a function a backend receives.**
Three counts, and I used each one to answer the next one's question.

The measured ledger: six rest refusals cleared, `searchparams.ts` 14 roots to
10, `delete` and `set` moved to a different root, **zero functions newly
compiling**, no new published name.

### What that exposed, which is worth more than what it cost

Everything in `URLSearchParams` is behind one line. `#brandCheck` refuses at
`searchparams.ts:276` on `!(#list in value)` — an `in` whose key is a **private
name** — and **14 functions cascade on it**, including `append`, `get`,
`getAll`, `has`, `entries`, `keys`, `values`, `sort`, `toString` and `get size`.

A private name is not "a key the compiler cannot see". It is per-class, the
layout knows which class declares `#list`, and `#list in value` is therefore an
instance test the compiler can answer. One line, fourteen functions, and it is
filed as the next thing rather than started here.

## What is still refused, and why it is filed rather than done

`URL`'s own `[] | [input: string, base?: string | URL]` holds `string` at one
position and `string | URL | undefined` at the other. There is no element type
that is both, and `ManagedType` has no boxed value to fall back to.

A second, narrower refusal is reached by the same fix: an explicit `undefined`
in a `string` position — `NTS1001 `null` or `undefined` where what it stands in
for is not a reference` — which is exactly `delete(name, undefined)`. No
`runtime/node` call site passes it; the calls that would are JavaScript callers
arriving through the napi wrapper, which builds the array from `argc` and does
not take this path.

Both are in `blockers/a-rest-parameter-that-is-a-union-of-tuples`, the second as
prose rather than as a function: a fixture asserts one expectation, and a second
refusal in the same file would be asserted by nobody. It is not in the example
for the opposite reason — a refused function leaves the differential silently,
so the example would report agreement over the survivors and go green having
stopped testing. That is [[0281]]'s finding applied before it could bite.

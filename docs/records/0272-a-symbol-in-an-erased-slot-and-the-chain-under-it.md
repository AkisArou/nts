# A symbol in an erased slot, and the chain under it

    `Possible EventEmitter memory leak detected. ${count} ${String(type)} ...`

`EventName` is `string | symbol`, so that interpolation is `String()` on an
erased value that may carry a symbol tag. It refused, and what it was under is
the point:

    http.createServer
      -> Server@server#constructor
        -> Server#constructor            (net's, through super())
          -> EventEmitter#on
            -> checkListener
              -> validateFunction
                -> ERR_INVALID_ARG_TYPE#constructor
                  -> determineSpecificType
                    -> quoteJSONString -> quoteFromIndex -> unicodeEscape

Two arms existed and the third did not. `String(sym)` on a typed symbol worked —
it is `SymbolDescriptiveString`, the one conversion the language allows *only*
through `String`, since `sym + ""` throws by 13.15.3. `String(v)` on an erased
value worked through `nts_value_to_string`, which spells a value from its tag.
The intersection did not, because that helper aborted on the symbol tag and
`spells_itself` correctly declined to send one. Both halves had to move.

With it in, `EventEmitter#on` survives: the `events` build goes from 892
functions to 900.

## A neighbouring disagreement that is not a defect

`spells_itself` also lists `BigInt` and `nts_value_to_string` has no bigint
case — it would `abort()`. That reads exactly like the same bug. It is
unreachable: putting a bigint in an erased slot is refused earlier, as "a value
of type BigInt where `unknown` is expected", so no bigint tag can arrive.

Teaching the helper a case it cannot receive is a feature probe below its first
use. Probed rather than assumed, and the *not* fixing it is the part worth
recording — two lists disagreeing is a defect only when something can reach the
gap.

## The example ran a different feature for the first time

The rc lane failed on it: 165 objects never given back. Not in the new arm --
in `plainSymbol`, the typed arm that already worked.

`nts_symbol_to_string` allocates four strings and returns one. Both
`nts_string_from_utf8` and `nts_concat` are `NTS_ALLOCATES` and borrow their
arguments, so `open`, `close` and the intermediate `head` were owned by that
helper and none was released. Three per call, since it was written.

**Nothing had ever run it.** The rc lane covers every example and no example
called `String()` on a symbol, so a helper that worked correctly leaked in the
one lane built to measure leaks, unobserved. `rc.sh`'s own header says why that
is the shape to expect: "a release too few leaks where nobody looks and a
release too many is never observed".

Adding an example for a feature is how a *neighbouring* feature gets run for the
first time, and that is worth more than the coverage it was written for.

## `--rc` and `NTS_RC=1` are not the same thing

The flag sets the compiler's provider. The environment variable sets that **and**
the runtime's allocator. So `--rc` alone compares a program that releases
against a bump allocator that frees nothing and counts nothing -- it passed, and
`NTS_RC=1` failed, on the same binary and the same example.

`rc.sh` states this in its header. What made it a finding rather than a flake
was two runs disagreeing and reading the script instead of re-running.

## What the chain actually bottoms out at, which is bigger

`unicodeEscape` reads `SHORT_ESCAPES`, whose initializer "was not compiled --
see the refusal above that says which". **There is no refusal above**: zero
`the initializer of` lines in the whole build. The same shape as
`addListener` in record 0271 — a diagnostic pointing at something that was never
printed.

The cause is that **`module#init` is absent from the `http` build entirely**.
One refused function reachable from module evaluation —
`idlIteratorPrototype`, in `web-platform/src/fetch/headers.ts` — takes the whole
initializer with it. Every deferred global is then unwritten, and every function
that reads one cascades. In `http` that is nearly everything.

`excise_from_initializer` exists for exactly this and cuts the offending
statement, leaving the rest of module evaluation to run. It **bails when a
terminator or block parameter carries a doomed value**, because a statement
whose *shape* depends on the refusal cannot be cut — and a larger initializer
has control flow.

    module#init present:  net stream fs process events util zlib url
                          buffer path os timers
    module#init absent:   http console

Two of fourteen. The `events` build excises the *same statement in the same
file* and survives, so it is the surrounding control flow that decides, not the
refusal.

So `http`'s whole surface is gated on one wholesale drop, and `console` — which
publishes nothing — is the other. That is the next thing to fix and it is not a
small one: it wants the doomed value replaced by something the control flow can
still carry, rather than the statement cut.

## Six links, none of which a census could rank

Every link here was found by reading the diagnostic of the link above. Two of
the six named a refusal that was never printed. A census over NTS1001 sees the
roots and not the chain, and ranks by how many *messages* mention a construct —
which for `idlIteratorPrototype` is one.

# One dotted read, and a module's whole evaluation

    const env: Readonly<Record<string, string | undefined>>
    env.NODE_USE_ENV_PROXY === "1"

`t["a"]` lowered and `t.a` did not. The refusal was "a property of a value with
no fields" — a sentence about a type that has no fields *because that is what an
index signature is*. They are one operation in JavaScript.

## What it cost

That line is `http`'s `useEnvironmentProxy`, and `globalAgent`'s initializer is
a ternary on the call. So a doomed value reaches a **branch**;
`excise_from_initializer` bails, because a statement whose *shape* depends on a
refusal cannot be cut; and `module#init` is dropped whole. Every deferred global
in the program is then unwritten, and every function reading one is refused with
it.

    http   1196 function(s) -> 1522     2783 refused -> 2497
           module#init absent -> present
           2 names published -> 5

## Six links to find it, and two named a refusal that was never printed

    http.createServer -> Server@server#constructor -> Server#constructor
      -> EventEmitter#on -> checkListener -> validateFunction
        -> ERR_INVALID_ARG_TYPE#constructor -> determineSpecificType
          -> quoteJSONString -> quoteFromIndex -> unicodeEscape
            -> reads SHORT_ESCAPES, whose initializer was not compiled
              -> module#init is absent

Each link was read from the diagnostic of the link above. Two of them —
`addListener` in record 0271 and `SHORT_ESCAPES` here — pointed at "the refusal
above that says which" where there was none. `excise_from_initializer` returned
`false` in silence three times over; it names the statement now, which is how
`agent.ts:645` was found at all.

## Three defects underneath, each masked by the one above it

Making `module#init` run made `http` compile code nothing had compiled, and
every layer had something wrong that the layer above had been hiding.

**`nts_string_eq` dereferenced a null.** A nullable string slot holds `NULL` for
`undefined`, so `table["missing"] === "1"` arrived as `(NULL, "1")` and
segfaulted — in `module.init`, so nothing loaded. The `a == b` check above it
already answers `true` for two absences, which is `undefined === undefined`, so
only the mixed case remained and it is `false` by the language.

**A value export that could not cross killed the module.** An erased export
holding an object refuses at `nts_to_napi_value` — right for a function's
*return*, fatal at registration. Omitting the name is what the boundary already
does for a function it cannot wrap. Both emitters needed it, top-level and
namespace, and guarding one is guarding half.

**A quoted property name was silently dropped.** `initialize_fields` read the
name node's `text`, which a string or numeric literal does not carry, and
`continue`d — so `{ "a b": 1, "x+y": 2, ordinary: 3 }` wrote only `ordinary` and
`use(n)` returned `3 + n` where node returns `6 + n`.

That was masked by the C emitter refusing any layout holding a name it could not
spell. **And that refusal emitted invalid C anyway**: it skipped the struct and
left its descriptor and reference tables pointing into it —
`offsetof(NtsObj_Type11376, 100)` for a struct that does not exist. `emit.rs`
carries a comment about exactly that shape and the guard written to prevent it
was doing it.

`c_member_escaped` spells the name instead: `_x` plus the byte in hex,
injective, an ordinary name unchanged. `blockers/property-name-with-no-c-spelling`
had argued escaping was wrong because a catch-all mapping to `_` is not
injective and would cost readability. Both halves were false, and it is a
round-trip guard now — asserting the *sum*, because two names escaping to one
would compile and answer wrongly.

## What the masking means

Four defects in one column, and each was invisible while the one above it stood.
A refusal is not a neutral state: it is a lid, and the count under it is
unknown. That is the argument for clearing refusals even when the count does not
move — record 0271 cleared one for no measurable gain and this is where the gain
turned up, three commits later.

162 of 162 examples agree with node, 162 of 162 under reference counting, 147
blockers as expected, 22 of 22 addons build.

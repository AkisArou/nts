# A fact collected for a decision nobody made

`SemanticSnapshot::index_signatures` has been recorded by the frontend since the
frontend was written. Its documentation says what for:

> The single fact that decides representation: a type with an index signature
> cannot be a flat struct with fixed field offsets, because its keys are not
> known at compile time. Missing it means emitting a struct for something that
> needs a map, and every dynamic key silently misses.

Nothing read it. Four call sites in the whole tree, all of them the frontend
writing it and one test checking that it was written.

So the thing the field exists to prevent was happening. A `Record<string, V>`
became an object layout with zero fields, and

    table["alpha"] = n

refused as `` `alpha`, which `an anonymous type` does not declare `` -- a message
about the lowering's model wearing the grammar of a message about the type. The
Node lane's fixture had already noticed the wording was wrong: "`ParsedQuery`
**does** declare this access -- `[name: string]: string | string[]` is exactly
what an index signature is for".

**A fact gathered for a decision that was never made looks like coverage from
the outside**, which is the same failure as a check that cannot go red. The
frontend test passes. The field is populated. The number of consumers is the
only thing that would have said, and nothing counts that.

## What it is now

`Record<string, V>`, `{ [k: string]: V }` and a named interface carrying only an
index signature all become `ManagedType::Map(String, V)`, which the runtime
already had with a hash chosen per key type. A literal is `nts_map_new` and one
`set` per property written down; a write is `nts_map_set`; a read is
`nts_map_get`, whose `V | undefined` is what the language says the access
answers and what a struct slot could never have said.

`Object.hasOwn` over a table is `nts_map_has`, and the computed key a struct has
to refuse -- "a question about a *value*, and a layout cannot answer it" -- is
ordinary here.

Two restrictions, both refusals rather than approximations:

**Only when the signature is the whole type.** `stream`'s `StreamState` has
eight named optional fields beside its signature and is both things at once: a
map loses the fields' offsets, a struct loses the dynamic keys.

**Only a string key.** A numeric index signature is what an array *is*, and a
hash table for one would be a slower array with worse locality and no `length`.

## Checked by running it

`examples/string-keyed-table`, 290 cases across ten functions against node: the
three spellings, a literal with entries, an absent key, a computed key,
overwriting, sixty-four keys past any linear scan, string values, and a table
through a parameter. All agree.

## The split fixture earned its keep, one step later than expected

`computed-member-read` was filed apart from `computed-member-write` so that a
fix landing only writes would be visible rather than reported as done. When the
representation landed, the write fixture went green -- and the read fixture did
not. It moved to a different refusal:

    an `Object` static over something that is not an object here

`bag[key]` was reading correctly and `Object.hasOwn(bag, key)` was not. The
split was filed against a fix that lands one direction and not the other; what
it actually caught was a fix that lands the access and not the *reflection over*
the access. It did the job it was written for, on a boundary nobody had drawn.

## The trap this sets for the next change

A `Record<string, V>` and a `Map<string, V>` now share one HIR type, and they
are not the same thing in the language. `Object.prototype.toString` says
`[object Object]` for one and `[object Map]` for the other; only one has `.get`;
`JSON.stringify` walks one and produces `{}` for the other.

Inside the compiled program that does not matter and is the point -- both are
tables, and every operation on them is the same operation. **At the boundary it
matters completely**, and one representation cannot answer both: a `Record` has
to arrive as a plain object and a `Map` as a `Map`.

Nothing can go wrong today, because `cross` refuses a `Map` in both directions
and has since it was written. The danger is the shape of the next change:
"teach `cross` to carry a table" is one sentence and two features, and the
version that carries a `Record` as a plain object would silently do the same to
a real `Map`.

`examples/string-keyed-table` asks the two questions the language does let a
program ask about a plain object -- `typeof table === "object"` and
`Array.isArray(table)` -- and both agree with node. They are controls for the
representation rather than for the feature, and they are there because a
collision introduced deliberately still has to be watched.

## What it did not do

`os`'s two `table[name] = value` sites are gone -- `main.ts:340`, the
`networkInterfaces` builder, and `:541`, the `constants` builder -- and its
refusal count went 71 to 69. **`os` still publishes 17 of 23.** `constants` is
an object with four map fields and a number, so crossing it needs the
object-return path *and* a map crossing outward, and neither is this change.

That is worth stating in advance rather than discovering afterwards, because
`os` is one export from being the second whole module and the temptation is to
call the representation the thing that gets it there. It is one of three.

`Object.keys` of a table is refused by name. The runtime has `nts_map_next` and
`nts_map_key_at`, so it is a walk rather than a missing capability -- and it is
named separately from `hasOwn` for exactly the reason the two fixtures are
separate.

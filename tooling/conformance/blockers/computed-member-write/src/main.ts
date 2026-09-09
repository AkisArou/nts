// expect: lowers
//
// FIXED, kept as a guard. A type whose keys are not known until run time is a
// table, and the runtime already had one.
//
// `SemanticSnapshot::index_signatures` was recorded by the frontend from the
// day it was written and read by **nothing**. Its own documentation says what
// for: "the single fact that decides representation -- a type with an index
// signature cannot be a flat struct with fixed field offsets, because its keys
// are not known at compile time. Missing it means emitting a struct for
// something that needs a map, and every dynamic key silently misses."
//
// That is exactly what happened. An index-signature type became an object
// layout with zero fields, so `table[name] = value` refused as "`name`, which
// `an anonymous type` does not declare" -- a message about the lowering's model
// wearing the grammar of a message about the type.
//
// A fact gathered for a decision nobody made looks like coverage from the
// outside, which is the same failure as a check that cannot go red.
//
// # What it is now
//
// `Record<string, V>`, `{ [k: string]: V }` and a named interface with only an
// index signature all become `ManagedType::Map(String, V)`. A literal is
// `nts_map_new` plus one `set` per property written; a write is `nts_map_set`;
// a read is `nts_map_get`, whose `V | undefined` is what the language says the
// access answers and what a struct slot could never have said.
//
// **Only when the signature is the whole of the type.** `stream`'s `StreamState`
// has eight named optional fields beside its signature, and it is both things
// at once: a map loses the fields' offsets, a struct loses the dynamic keys.
// Refused rather than half-represented.
//
// **Only a string key.** A numeric index signature is what an array *is*, and a
// hash table for one would be a slower array with worse locality and no
// `length`.
//
// # Checked by running it
//
// `examples/string-keyed-table` compares ten functions against node over 290
// cases: the three spellings, a literal with entries, an absent key, a computed
// key, overwriting, sixty-four keys, string values, and a table through a
// parameter. All agree.
//
// # What it cleared, and what it did not
//
// `os`'s two `table[name] = value` sites are gone -- `main.ts:340`, the
// `networkInterfaces` builder, and `:541`, the `constants` builder. `os` still
// publishes 17 of 23, because `constants` is an object with four map fields and
// crossing it needs the object-return path *and* a map crossing outward.
// Neither is this.

// expect: `name`, which `an anonymous type` does not declare
//
// Writing a computed member into a `Record<string, number>` refuses.
//
// **The diagnostic misleads, and it misled both lanes for hours.** It says
// "`name`, which `an anonymous type` does not declare", which reads as a missing
// member on a struct whose other members are fine — so it looks like a small
// lowering gap. What is actually true is that `Record<string, number>` is an
// **index signature**: the type has no members at all and its keys are not known
// until run time. There is nothing for `table[name]` to resolve to.
//
// That makes this a representation decision rather than a lowering arm. The
// compiler lane's reading: property access and `Object.keys` on an
// index-signature type would have to route through the real `NtsMap` this
// compiler already has, while preserving `OrdinaryOwnPropertyKeys` order so that
// `constants.signals.SIGINT` and `Object.keys(constants.signals)` behave as
// node's plain object does — and it has to be a *typed* map rather than a
// general one, because dynamic ordinary-object maps are a stated non-goal.
//
// So this is a design piece, not twenty minutes, and `os` stays dark until it
// lands. It was briefly first in the queue on my argument that it costs `os` the
// whole module at load. That argument is still true and it was the wrong
// conclusion: cost-if-unfixed is not the same as value-per-hour, and I gave the
// first as though it were the second.
//
// **This is the last thing between `os` and a shape that loads.** After the
// compiler lane's module-evaluation fix, `os.node` links, loads and publishes 17
// names that all agree with node. It still fails every test, and not on any of
// those 17: `os/shape.mjs:15` reads `exports.constants.UV_UDP_REUSEADDR` before
// it can build anything, and `constants` is absent. The chain is exactly one
// link long:
//
//     os.constants  <-  readConstants()  <-  `table[name] = value`  (main.ts:511)
//
// `readConstants` is refused on that line, so the excision drops
// `export const constants = readConstants()`, so the shape has no `constants` to
// read and the module reports "Cannot read properties of undefined". Every other
// missing name costs `os` a test; this one costs it the whole module.
//
// It is not an export-kind problem, which is what it looked like from the
// outside and what I nearly reported. A *computed* object publishes fine --
// `export const computed: Table = build()` is named and exported today. What
// fails is building the object at all.
//
// Reduced from `runtime/node/os/src/main.ts:476-517`, which reads three parallel
// native columns and files each value into one of four tables chosen by name.
// The shape is not incidental: any table filled from data rather than from
// source is written this way, so `zlib`'s and `process`'s constants want it too.
interface Constants {
  signals: Record<string, number>;
  errno: Record<string, number>;
}

declare function nts_names(): string[];
declare function nts_values(): number[];

function build(): Constants {
  const out: Constants = { signals: {}, errno: {} };
  const names = nts_names();
  const values = nts_values();

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const value = values[i];
    if (name === undefined || value === undefined) continue;

    let table: Record<string, number>;
    if (i % 2 === 0) {
      table = out.signals;
    } else {
      table = out.errno;
    }
    table[name] = value;
  }

  return out;
}

export const constants: Constants = build();

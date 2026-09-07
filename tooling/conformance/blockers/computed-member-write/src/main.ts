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

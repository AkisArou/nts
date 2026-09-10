// Which fields of a differential spec answer the same thing for every input.
//
//   node tooling/conformance/spec-variance.mjs [module …]
//
// # Why this is its own question
//
// `corpus-reach.mjs` asks whether a spec calls a function. This asks whether the
// call *says* anything: a field that answers the same constant for all of a
// corpus's fixed inputs can only catch a change to that constant, and it reads as
// coverage regardless of how many comparisons the row contributes.
//
// The prompt was a compiler-lane result worth restating: `nts check` reported
// "agreed on every case" with a live defect, because the defect made a function
// refuse and the harness compared the survivors. A call that was never made and a
// call that was right produce the same green -- and one level in, so do a field
// that varies and a field that is a constant.
//
// # A constant field is not automatically wrong
//
// Some are deliberate and load-bearing. `BlockList.isBlockList(list)` is `true`
// for every input and should be; a spec asserting an invariant *wants* a
// constant. The finding is a field that was **meant** to vary and does not --
// usually because every input drives it down the same path, most often an error
// path shared by all of them.
//
// So this prints and does not judge. Two numbers per spec: fields, and how many
// of them are constant. Reading them is a person's job, and the useful question
// for each constant is "what change would this notice".

import { loadNode } from "./surface-load.mjs";
import { CORPORA } from "./differential-corpora.mjs";

const MODULES = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(CORPORA).sort();

let totalFields = 0;
let totalConstant = 0;

for (const moduleName of MODULES) {
  const corpus = CORPORA[moduleName];
  if (corpus === undefined) continue;
  const theirs = loadNode(moduleName);
  if (theirs.absent) continue;

  for (const spec of corpus.calls ?? []) {
    const label = spec.label ?? spec.name ?? "(unnamed)";
    const answers = [];
    for (const input of corpus.fixed) {
      let value;
      try {
        value = typeof spec.call === "function"
          ? spec.call(theirs.surface, input)
          : theirs.surface[spec.name](...(spec.args ? spec.args(input) : [input]));
      } catch (error) {
        value = `threw:${error?.code ?? error?.name ?? "?"}`;
      }
      answers.push(Array.isArray(value) ? value.map(String) : String(value).split("|"));
    }
    if (answers.length === 0) continue;
    const width = Math.max(...answers.map((a) => a.length));
    const constant = [];
    for (let i = 0; i < width; i++) {
      const distinct = new Set(answers.map((a) => a[i]));
      if (distinct.size === 1) constant.push(`${i}:${[...distinct][0]}`.slice(0, 40));
    }
    totalFields += width;
    totalConstant += constant.length;
    if (constant.length === 0) continue;
    console.log(`  ${moduleName}/${label}  ${constant.length} of ${width} field(s) constant`);
    for (const c of constant.slice(0, 6)) console.log(`      ${c}`);
    if (constant.length > 6) console.log(`      … and ${constant.length - 6} more`);
  }
}

console.log(`\n  ${totalConstant} of ${totalFields} field(s) answer the same value for every fixed input`);

// The inner half of `differential-ts.mjs`, run through `run-one.mjs` so that
// `require(module)` is the substituted TypeScript module.
//
// It cannot compare anything itself: inside the substitution, `node:path` and
// `path` are the same object, so node's real module is unreachable from here.
// It computes one side and prints it; the host computes the other.
"use strict";

const { readFileSync } = require("node:fs");

const moduleName = process.env.NTS_DIFF_MODULE;
const inputsPath = process.env.NTS_DIFF_INPUTS;
const corporaPath = process.env.NTS_DIFF_CORPORA;

const call = (fn, args) => {
  try {
    return { value: fn(...args) };
  } catch (error) {
    return { threw: `${error.name}: ${error.message}` };
  }
};

import(corporaPath).then(({ CORPORA }) => {
  const corpus = CORPORA[moduleName];
  const target = require(moduleName);
  const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));

  const rows = inputs.map((input) =>
    corpus.calls.map((spec) => {
      if (typeof spec.call === "function") {
        try {
          return { value: spec.call(target, input) };
        } catch (error) {
          return { threw: `${error.name}: ${error.message}` };
        }
      }
      const fn = target[spec.name];
      if (typeof fn !== "function") return { absent: true };
      return call(fn, spec.args(input));
    })
  );
  console.log("NTSDIFF " + JSON.stringify(rows));
});

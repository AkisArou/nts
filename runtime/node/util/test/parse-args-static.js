"use strict";

// `test-parse-args.mjs` compares every successful values record with a
// null-prototype object. NTS records deliberately have no prototype at all;
// this fixture retains the parser behavior without asking the host JavaScript
// stand-in to manufacture an observable prototype chain.
const assert = require("assert");
const { parseArgs } = require("util");

// **`__proto__: null` in every `values` expectation.** Node builds this object with a
// null prototype -- its input is `process.argv`, and `--__proto__` is a flag a user can
// pass -- and `deepStrictEqual` compares prototypes. These expectations were plain
// objects and passed, which is how the missing prototype survived here; running this
// file against node (`NTS_CONFORMANCE_ORACLE=1`) failed on the prototype alone.
//
// The case below with `toString` and `constructor` as option names is the one this
// matters most for, and a plain-prototype expectation was the weakest possible version
// of it.

assert.deepStrictEqual(
  parseArgs({
    args: ["-rvf", "file.txt", "tail"],
    strict: false,
    allowPositionals: true,
    options: { file: { short: "f", type: "string" } },
  }),
  {
    values: { __proto__: null, r: true, v: true, file: "file.txt" },
    positionals: ["tail"],
  },
);

assert.deepStrictEqual(
  parseArgs({
    args: ["-abc", "tail"],
    allowPositionals: true,
    tokens: true,
    options: {
      alpha: { short: "a", type: "boolean" },
      beta: { short: "b", type: "string" },
    },
  }),
  {
    values: { __proto__: null, alpha: true, beta: "c" },
    positionals: ["tail"],
    tokens: [
      {
        kind: "option",
        name: "alpha",
        rawName: "-a",
        index: 0,
        value: undefined,
        inlineValue: undefined,
      },
      {
        kind: "option",
        name: "beta",
        rawName: "-b",
        index: 0,
        value: "c",
        inlineValue: true,
      },
      { kind: "positional", index: 1, value: "tail" },
    ],
  },
);

assert.deepStrictEqual(
  parseArgs({
    args: ["--input", "c", "--input=d", "--enabled", "--enabled"],
    tokens: true,
    options: {
      input: { type: "string", multiple: true, default: ["a", "b"] },
      enabled: { type: "boolean", multiple: true },
      fallback: { type: "string", default: "ready" },
      disabled: { type: "boolean", default: false },
    },
  }),
  {
    values: {
      __proto__: null,
      input: ["c", "d"],
      enabled: [true, true],
      fallback: "ready",
      disabled: false,
    },
    positionals: [],
    tokens: [
      {
        kind: "option",
        name: "input",
        rawName: "--input",
        index: 0,
        value: "c",
        inlineValue: false,
      },
      {
        kind: "option",
        name: "input",
        rawName: "--input",
        index: 2,
        value: "d",
        inlineValue: true,
      },
      {
        kind: "option",
        name: "enabled",
        rawName: "--enabled",
        index: 3,
        value: undefined,
        inlineValue: undefined,
      },
      {
        kind: "option",
        name: "enabled",
        rawName: "--enabled",
        index: 4,
        value: undefined,
        inlineValue: undefined,
      },
    ],
  },
);

assert.deepStrictEqual(
  parseArgs({
    args: ["--no-color", "--color", "--no-color"],
    allowNegative: true,
    tokens: true,
    options: { color: { type: "boolean", multiple: true } },
  }),
  {
    values: { __proto__: null, color: [false, true, false] },
    positionals: [],
    tokens: [
      {
        kind: "option",
        name: "color",
        rawName: "--no-color",
        index: 0,
        value: undefined,
        inlineValue: undefined,
      },
      {
        kind: "option",
        name: "color",
        rawName: "--color",
        index: 1,
        value: undefined,
        inlineValue: undefined,
      },
      {
        kind: "option",
        name: "color",
        rawName: "--no-color",
        index: 2,
        value: undefined,
        inlineValue: undefined,
      },
    ],
  },
);

assert.deepStrictEqual(
  parseArgs({
    args: ["--", "--not-an-option", "tail"],
    allowPositionals: true,
    tokens: true,
  }),
  {
    values: { __proto__: null },
    positionals: ["--not-an-option", "tail"],
    tokens: [
      { kind: "option-terminator", index: 0 },
      { kind: "positional", index: 1, value: "--not-an-option" },
      { kind: "positional", index: 2, value: "tail" },
    ],
  },
);

// Names inherited by an ordinary host object are still treated as record
// keys, and the legacy prototype mutator name is ignored exactly as upstream.
assert.deepStrictEqual(
  parseArgs({
    args: ["--toString", "--constructor", "--__proto__"],
    options: {
      toString: { type: "boolean" },
      constructor: { type: "boolean" },
      ["__proto__"]: { type: "boolean" },
    },
  }),
  {
    values: { __proto__: null, toString: true, constructor: true },
    positionals: [],
  },
);

assert.throws(() => parseArgs({ args: ["--unknown"] }), { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" });
assert.throws(() => parseArgs({ args: ["positional"] }), {
  code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
});
assert.throws(() => parseArgs({ args: ["--flag=value"], options: { flag: { type: "boolean" } } }), {
  code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
});
assert.throws(() => parseArgs({ args: ["--name"], options: { name: { type: "string" } } }), {
  code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
});
assert.throws(
  () => parseArgs({ args: ["--name", "--other"], options: { name: { type: "string" } } }),
  /To specify an option argument starting with a dash use '--name=-XYZ'/,
);
assert.throws(
  () => parseArgs({ args: [], options: { flag: { type: "boolean", default: "yes" } } }),
  { code: "ERR_INVALID_ARG_TYPE" },
);
assert.throws(
  () =>
    parseArgs({
      args: [],
      options: { names: { type: "string", multiple: true, default: ["ok", 1] } },
    }),
  { code: "ERR_INVALID_ARG_TYPE" },
);
assert.throws(() => parseArgs({ args: [], options: { name: { type: "string", short: "nn" } } }), {
  code: "ERR_INVALID_ARG_VALUE",
});

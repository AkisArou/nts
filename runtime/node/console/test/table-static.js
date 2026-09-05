// Retained from pinned upstream `parallel/test-console-table.js`.
// The upstream file also observes anonymous-function metadata and
// Object.prototype itself, which are §13 non-goals. Direct Map/Set iterator
// recognition is a temporary runtime-kind gap, not a non-goal. These cases
// retain the table paths using statically representable arrays, maps, sets,
// records, and typed arrays.
"use strict";

require("../common");

const assert = require("assert");
const { Console } = require("console");

let output = "";
const stream = {
  write(value) {
    output = value;
  },
  removeListener() {},
};
const instance = new Console(stream, process.stderr, false);

function test(data, properties, expected) {
  if (expected === undefined) {
    expected = properties;
    properties = undefined;
  }
  instance.table(data, properties);
  assert.strictEqual(output, `${expected.trim()}\n`);
}

assert.throws(() => instance.table([], false), {
  code: "ERR_INVALID_ARG_TYPE",
});

test(Symbol(), undefined, "Symbol()\n");
test(null, "null\n");
test(undefined, "undefined\n");
test(false, "false\n");
test("hi", "hi\n");

test(
  [1, 2, 3],
  undefined,
  `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ 0       │ 1      │
│ 1       │ 2      │
│ 2       │ 3      │
└─────────┴────────┘
`,
);

test(
  [Symbol(), 5, [10]],
  undefined,
  `
┌─────────┬────┬──────────┐
│ (index) │ 0  │ Values   │
├─────────┼────┼──────────┤
│ 0       │    │ Symbol() │
│ 1       │    │ 5        │
│ 2       │ 10 │          │
└─────────┴────┴──────────┘
  `,
);

test(
  [null, 5],
  undefined,
  `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ 0       │ null   │
│ 1       │ 5      │
└─────────┴────────┘
`,
);

test(
  [undefined, 5],
  undefined,
  `
┌─────────┬───────────┐
│ (index) │ Values    │
├─────────┼───────────┤
│ 0       │ undefined │
│ 1       │ 5         │
└─────────┴───────────┘
`,
);

test(
  { a: 1, b: Symbol(), c: [10] },
  undefined,
  `
┌─────────┬────┬──────────┐
│ (index) │ 0  │ Values   │
├─────────┼────┼──────────┤
│ a       │    │ 1        │
│ b       │    │ Symbol() │
│ c       │ 10 │          │
└─────────┴────┴──────────┘
`,
);

test(
  new Map([
    ["a", 1],
    [Symbol(), [2]],
  ]),
  undefined,
  `
┌───────────────────┬──────────┬────────┐
│ (iteration index) │ Key      │ Values │
├───────────────────┼──────────┼────────┤
│ 0                 │ 'a'      │ 1      │
│ 1                 │ Symbol() │ [ 2 ]  │
└───────────────────┴──────────┴────────┘
`,
);

test(
  new Set([1, 2, Symbol()]),
  undefined,
  `
┌───────────────────┬──────────┐
│ (iteration index) │ Values   │
├───────────────────┼──────────┤
│ 0                 │ 1        │
│ 1                 │ 2        │
│ 2                 │ Symbol() │
└───────────────────┴──────────┘
  `,
);

test(
  { a: 1, b: 2 },
  ["a"],
  `
┌─────────┬───┐
│ (index) │ a │
├─────────┼───┤
│ a       │   │
│ b       │   │
└─────────┴───┘
`,
);

test(
  [
    { a: 1, b: 2 },
    { a: 3, c: 4 },
  ],
  ["a"],
  `
┌─────────┬───┐
│ (index) │ a │
├─────────┼───┤
│ 0       │ 1 │
│ 1       │ 3 │
└─────────┴───┘
`,
);

test(
  { a: { a: 1, b: 2, c: 3 } },
  undefined,
  `
┌─────────┬───┬───┬───┐
│ (index) │ a │ b │ c │
├─────────┼───┼───┼───┤
│ a       │ 1 │ 2 │ 3 │
└─────────┴───┴───┴───┘
  `,
);

test(
  { a: { a: { a: 1, b: 2, c: 3 } } },
  undefined,
  `
┌─────────┬──────────┐
│ (index) │ a        │
├─────────┼──────────┤
│ a       │ [Object] │
└─────────┴──────────┘
`,
);

test(
  { a: [1, 2] },
  undefined,
  `
┌─────────┬───┬───┐
│ (index) │ 0 │ 1 │
├─────────┼───┼───┤
│ a       │ 1 │ 2 │
└─────────┴───┴───┘
`,
);

test(
  { a: [1, 2, 3, 4, 5], b: 5, c: { e: 5 } },
  undefined,
  `
┌─────────┬───┬───┬───┬───┬───┬───┬────────┐
│ (index) │ 0 │ 1 │ 2 │ 3 │ 4 │ e │ Values │
├─────────┼───┼───┼───┼───┼───┼───┼────────┤
│ a       │ 1 │ 2 │ 3 │ 4 │ 5 │   │        │
│ b       │   │   │   │   │   │   │ 5      │
│ c       │   │   │   │   │   │ 5 │        │
└─────────┴───┴───┴───┴───┴───┴───┴────────┘
`,
);

test(
  new Uint8Array([1, 2, 3]),
  undefined,
  `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ 0       │ 1      │
│ 1       │ 2      │
│ 2       │ 3      │
└─────────┴────────┘
  `,
);

test(
  Buffer.from([1, 2, 3]),
  undefined,
  `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ 0       │ 1      │
│ 1       │ 2      │
│ 2       │ 3      │
└─────────┴────────┘
`,
);

test(
  { a: undefined },
  ["x"],
  `
┌─────────┬───┐
│ (index) │ x │
├─────────┼───┤
│ a       │   │
└─────────┴───┘
`,
);

test(
  [],
  undefined,
  `
┌─────────┐
│ (index) │
├─────────┤
└─────────┘
  `,
);

test(
  new Map(),
  undefined,
  `
┌───────────────────┬─────┬────────┐
│ (iteration index) │ Key │ Values │
├───────────────────┼─────┼────────┤
└───────────────────┴─────┴────────┘
`,
);

test(
  [
    { a: 1, b: "Y" },
    { a: "Z", b: 2 },
  ],
  undefined,
  `
┌─────────┬─────┬─────┐
│ (index) │ a   │ b   │
├─────────┼─────┼─────┤
│ 0       │ 1   │ 'Y' │
│ 1       │ 'Z' │ 2   │
└─────────┴─────┴─────┘
`,
);

{
  const line = "─".repeat(79);
  const header = `name${" ".repeat(77)}`;
  const name =
    "very long long long long long long long long long long long " + "long long long long";
  test(
    [{ name }],
    undefined,
    `
┌─────────┬──${line}──┐
│ (index) │ ${header} │
├─────────┼──${line}──┤
│ 0       │ '${name}' │
└─────────┴──${line}──┘
`,
  );
}

test(
  { foo: "￥", bar: "¥" },
  undefined,
  `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ foo     │ '￥'   │
│ bar     │ '¥'    │
└─────────┴────────┘
`,
);

test(
  { foo: "你好", bar: "hello" },
  undefined,
  `
┌─────────┬─────────┐
│ (index) │ Values  │
├─────────┼─────────┤
│ foo     │ '你好'  │
│ bar     │ 'hello' │
└─────────┴─────────┘
`,
);

test(
  [{ foo: 10 }, { foo: 20 }],
  ["__proto__"],
  `
┌─────────┬───────────┐
│ (index) │ __proto__ │
├─────────┼───────────┤
│ 0       │           │
│ 1       │           │
└─────────┴───────────┘
`,
);

import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import type { Callback, Cell, Container, Indirection, NumberValue, ProgramModel } from "./model.ts";
import { decodeNumber, encodeNumber, validateModel } from "./model.ts";
import { printProgram } from "./printer.ts";
import { Random } from "./random.ts";
import { BOUNDARIES, CELLS, CHAIN_LENGTHS, NESTING_DEPTHS, generateModel, modelCandidates, smallerValues } from "./scenarios.ts";

type Exports = Record<string, (...args: number[]) => unknown>;
async function load(model: ProgramModel): Promise<Exports> {
  const source = stripTypeScriptTypes(printProgram(model).source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function small(cell: Cell): ProgramModel {
  const base = generateModel(1, 0, cell);
  return { ...base,
    template: cell === "bounds:merge" ? "index-range-join" : base.template,
    policies: { ...base.policies, inputSource: "parameter", placement: "function", twins: true,
      chainLength: 2, nestingDepth: 2, value: 0.5, context: [] },
    inputs: [0, 1, 2, 3, 4, 7, -1, "NaN", "-0", 0.5],
  };
}

test("the seeded stream and printer are reproducible, including seed zero", () => {
  for (const seed of [0, 1, 0xffff_ffff]) {
    const a = new Random(seed), b = new Random(seed);
    assert.deepEqual(Array.from({ length: 32 }, () => a.next()), Array.from({ length: 32 }, () => b.next()));
    for (let at = 0; at < CELLS.length; at++) {
      assert.deepEqual(printProgram(generateModel(seed, at, CELLS[at])), printProgram(generateModel(seed, at, CELLS[at])));
    }
  }
  assert.notEqual(new Random(0).next(), new Random(1).next());
});

test("numeric atoms and shrinking retain NaN, signed zero and fractional classes", () => {
  for (const atom of BOUNDARIES) assert.deepEqual(encodeNumber(decodeNumber(atom)), atom);
  assert.ok(Object.is(decodeNumber("-0"), -0));
  assert.ok(Number.isNaN(decodeNumber("NaN")));
  assert.deepEqual(smallerValues("NaN"), []);
  assert.deepEqual(smallerValues("-0"), []);
  assert.deepEqual(smallerValues(0.25), []);
  assert.deepEqual(smallerValues(-0.25), []);
  for (const value of [2147483648, -2147483648, 9007199254740992, 1.5, -1.5, 0.25, -0.25]) {
    for (const reduced of smallerValues(value)) {
      const number = decodeNumber(reduced);
      assert.equal(Number.isInteger(number), Number.isInteger(value));
      assert.equal(Math.sign(number), Math.sign(value));
      assert.ok(Math.abs(number) < Math.abs(value));
    }
  }
});

test("200 seed policies cover boundaries, omissions, placements and stress sizes", () => {
  const values = new Set<NumberValue>(), chains = new Set<number>(), depths = new Set<number>();
  const containers = new Set<Container>(), callbacks = new Set<Callback>(), calls = new Set<Indirection>();
  const placements = new Set<string>(), sources = new Set<string>(), contexts = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    for (const cell of CELLS) {
      const model = generateModel(seed, 0, cell), p = model.policies;
      values.add(p.value); for (const input of model.inputs) values.add(input);
      chains.add(p.chainLength); depths.add(p.nestingDepth); containers.add(p.container);
      if (cell.endsWith(":callback")) callbacks.add(p.callback);
      calls.add(p.indirection); placements.add(p.placement); sources.add(p.inputSource);
      contexts.add(p.context.join(","));
    }
  }
  assert.deepEqual([...values].filter((value) => BOUNDARIES.includes(value)).sort(), [...BOUNDARIES].sort());
  assert.deepEqual([...chains].sort((a, b) => a - b), CHAIN_LENGTHS);
  assert.deepEqual([...depths].sort((a, b) => a - b), NESTING_DEPTHS);
  assert.equal(containers.size, 4); assert.equal(callbacks.size, 7); assert.equal(calls.size, 3);
  assert.deepEqual([...placements].sort(), ["function", "module"]);
  assert.deepEqual([...sources].sort(), ["literal", "parameter"]);
  assert.equal(contexts.size, 4);
});

test("forced routes and aliases have observable effects and equivalent arm-order twins", async () => {
  for (const cell of CELLS.filter((cell) => cell !== "bounds:merge")) {
    for (const container of ["variable", "field", "array", "map"] satisfies Container[]) {
      for (const indirection of ["direct", "nested", "closure"] satisfies Indirection[]) {
        const base = small(cell);
        const model = { ...base, policies: { ...base.policies, container, indirection } };
        const module = await load(model);
        let separated = false;
        for (const input of model.inputs) {
          const n = decodeNumber(input);
          const subject = module.subject(n), control = module.control(n);
          assert.ok(Object.is(subject, module.subject(n)), `${cell} repeat`);
          assert.ok(Object.is(subject, module.twin(n)), `${cell} ${container} ${indirection} twin`);
          assert.ok(Object.is(control, module.controlTwin(n)), `${cell} control twin`);
          separated ||= !Object.is(subject, control);
        }
        assert.ok(separated, `${cell} ${container} ${indirection} effect`);
      }
    }
  }
});

test("all deterministic callback choices execute the invalidation", async () => {
  for (const cell of ["bounds:callback", "length:callback"] satisfies Cell[]) {
    for (const callback of ["forEach", "map", "filter", "reduce", "arrayFrom", "mapForEach", "setForEach"] satisfies Callback[]) {
      const base = small(cell);
      const model = { ...base, policies: { ...base.policies, callback, container: "variable", indirection: "direct" } } satisfies ProgramModel;
      const module = await load(model);
      assert.ok(!Object.is(module.subject(1), module.control(1)), `${cell} ${callback}`);
      assert.ok(Object.is(module.subject(0), module.control(0)), `${cell} ${callback} unchanged input`);
    }
  }
});

test("the original 0..3 string join survives both arm orders", async () => {
  for (const order of ["then", "else"] satisfies ("then" | "else")[]) {
    const base = small("bounds:merge");
    const model = { ...base, template: "string-range-join", policies: {
      ...base.policies, armOrder: order, chainLength: 0,
    } } satisfies ProgramModel;
    const printed = printProgram(model), module = await load(model);
    assert.match(printed.source, /export function control\(n: number\): number/);
    assert.match(printed.source, /expect-ir: all: control returns integer/);
    for (const value of [0, 1, 2, 3, 0.5, -0]) {
      assert.equal(module.subject(value), 97 + (value | 0));
      assert.equal(module.twin(value), module.subject(value));
    }
    for (const value of [-1, 4, 7, 2147483647, 2147483648, 4294967296, 9007199254740992, NaN]) {
      assert.ok(Number.isNaN(module.subject(value)));
      assert.ok(Number.isNaN(module.twin(value)));
      assert.equal(module.control(value), 97);
    }
  }
});

test("module-scope observations are linked to an executing function control", async () => {
  for (const cell of CELLS) {
    const base = small(cell);
    const model = { ...base, policies: { ...base.policies, placement: "module", inputSource: "literal" } } satisfies ProgramModel;
    const printed = printProgram(model), module = await load(model);
    assert.equal(module.controlModule(), module.control());
    assert.equal(module.twin(), module.subject());
    assert.notEqual(module.subject(), module.control());
    assert.equal(printed.functions.find((fn) => fn.name === "controlModule")?.counterpart, "control");
    assert.equal(printed.functions.find((fn) => fn.name === "subject")?.observationEncoding, "number-list-v1");
    assert.match(printed.source, /let subjectObservations: string = "";\n \{/);
    assert.doesNotMatch(printed.source, /expect-ir:.*in controlModule/);
  }
});

test("generated syntax stays inside the whitelist and has no type escapes", () => {
  for (let at = 0; at < 200; at++) {
    const source = printProgram(generateModel(1, at, CELLS[at % CELLS.length])).source;
    assert.doesNotMatch(source, /\b(?:any|unknown|as|Date|Intl|WeakRef|eval|Reflect|Proxy)\b|@ts-|Math\.(?:random|sin|exp)|setTimeout|setInterval/);
    assert.doesNotMatch(source, /[\w\])}]\s*!(?!=)/);
    assert.doesNotThrow(() => stripTypeScriptTypes(source));
  }
});

test("model reductions delete statements and lower budgets without changing identity", () => {
  const base = small("length:call");
  const model = { ...base, policies: { ...base.policies, context: ["unrelated-array", "second-caller"],
    chainLength: 24, nestingDepth: 10, value: 1.5 } } satisfies ProgramModel;
  const candidates = modelCandidates(model);
  assert.ok(candidates.some((candidate) => candidate.policies.context.length < model.policies.context.length));
  assert.ok(candidates.some((candidate) => candidate.policies.chainLength < 24));
  assert.ok(candidates.some((candidate) => candidate.policies.nestingDepth < 10));
  assert.ok(candidates.some((candidate) => candidate.policies.value === 0.5));
  for (const candidate of candidates) {
    assert.equal(candidate.cell, model.cell); assert.equal(candidate.template, model.template);
    assert.doesNotThrow(() => validateModel(candidate));
    assert.doesNotThrow(() => stripTypeScriptTypes(printProgram(candidate).source));
  }
});

test("persisted model validation refuses malformed or incompatible plans", () => {
  const model = small("bounds:call");
  assert.throws(() => validateModel({ ...model, policies: { ...model.policies, chainLength: 1e9 } }));
  assert.throws(() => validateModel({ ...model, policies: { ...model.policies, mutation: "push" } }));
  assert.throws(() => validateModel({ ...model, inputs: [null] }));
  assert.throws(() => validateModel({ ...model, inputs: [-0] }));
  assert.throws(() => validateModel({ ...model, policies: { ...model.policies, placement: "module" } }));
  assert.throws(() => validateModel({ ...model, template: "string-range-join" }));
});

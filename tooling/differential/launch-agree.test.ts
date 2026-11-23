import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {test} from "node:test";
import {declineText,launchColumns,launchesAccounted,launchFailure} from "./launch-agree.ts";
import {Outcome} from "./check-report.ts";
import {LAUNCH_DECLINES} from "../gate/verdict-policy.ts";
import type {CheckRefusal} from "./check-report-types.ts";

// One launch-row column of `launch-agree`, as the batch completed it.
const column = (name: string, outcome: string, disposition: number, refusals: CheckRefusal[] = []) =>
  ({entry: {name}, record: {outcome, first: `${outcome} answer`, refusals}, disposition});
const [listedName, listed] = Object.entries(LAUNCH_DECLINES)[0]!;
const asListed: CheckRefusal = {stage: "lowering", code: listed.code, message: `${listed.refusal} -- the rest of its message`};

test("a launch row agrees or is pending; anything else short of agreement is red", () => {
  assert.equal(launchFailure(column("startup-hello", Outcome.AGREES, 0)), undefined);
  assert.equal(launchFailure(column("startup-hello", Outcome.PENDING, 4)), undefined);
  assert.equal(launchFailure(column("startup-hello", Outcome.BACKEND_DECLINED, 1, [asListed])), `${Outcome.BACKEND_DECLINED} answer`);
  assert.equal(launchFailure(column("startup-hello", Outcome.DISAGREES, 1)), `${Outcome.DISAGREES} answer`);
  assert.equal(launchFailure(column("startup-hello", Outcome.ALL_DECLINED, 1)), `${Outcome.ALL_DECLINED} answer`);
});

test("a listed decline must still be refused by its listed refusal, and agreeing makes its entry stale", () => {
  assert.equal(launchFailure(column(listedName, Outcome.BACKEND_DECLINED, 1, [asListed])), undefined);
  assert.equal(launchFailure(column(listedName, Outcome.PENDING, 4)), undefined);
  assert.match(launchFailure(column(listedName, Outcome.AGREES, 0))!, /entry .* is stale: remove it/);
  assert.match(launchFailure(column(listedName, Outcome.DISAGREES, 1))!, /listed in LAUNCH_DECLINES as refused by/);
  assert.match(launchFailure(column(listedName, Outcome.ALL_DECLINED, 1))!, /listed in LAUNCH_DECLINES as refused by/);
  // Declining by another refusal, or by the same message under another code, is not the listed decline.
  const other: CheckRefusal = {stage: "lowering", code: listed.code, message: "a different construct is not supported by this lowering yet"};
  assert.match(launchFailure(column(listedName, Outcome.BACKEND_DECLINED, 1, [other]))!, /but .*a different construct/);
  assert.match(launchFailure(column(listedName, Outcome.BACKEND_DECLINED, 1, [{...asListed, code: "NTS0000"}]))!, /listed in LAUNCH_DECLINES/);
  assert.match(launchFailure(column(listedName, Outcome.BACKEND_DECLINED, 1))!, /no refusal/);
});

test("the allowlist names launch rows, the refusal each declines with, and the task that removes it", () => {
  for (const [name, decline] of Object.entries(LAUNCH_DECLINES)) {
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(decline.code, /^NTS\d{4}$/, `${name} names its diagnostic's code`);
    assert.ok(decline.refusal.length > 0, `${name} names its refusal`);
    assert.ok(Number.isSafeInteger(decline.task) && decline.task > 0, `${name} names its task`);
    assert.match(declineText(decline), /^NTS\d{4} .+ \(#\d+\)$/);
    // A name that is no launch row would excuse nothing and never go stale.
    assert.ok(existsSync(new URL(`../../benchmarks/cases/${name}/launch.json`, import.meta.url)), `${name} is a launch row`);
  }
});

test("the selection is every launch row on each backend, and never empty", () => {
  const cases = [{name: "fib"}, {name: "startup-empty"}, {name: "startup-hello"}];
  const isLaunchRow = (row: {name: string}) => row.name.startsWith("startup-");
  assert.deepEqual(launchColumns(cases, undefined, isLaunchRow).map(one => `${one.name}/${one.backend}`),
    ["startup-empty/c", "startup-empty/llvm", "startup-empty/jvm", "startup-hello/c", "startup-hello/llvm", "startup-hello/jvm"]);
  assert.deepEqual(launchColumns([{name: "startup-hello"}], "startup-hello", isLaunchRow).map(one => one.backend), ["c", "llvm", "jvm"]);
  // An `only` naming a case with no launch.json is refused, not passed with nothing compared.
  assert.throws(() => launchColumns([{name: "fib"}], "fib", isLaunchRow), /fib is not a launch row/);
  // A corpus the marker reader finds no launch row in (a renamed marker, a wrong prefix) is refused too.
  assert.throws(() => launchColumns(cases, undefined, () => false), /hold no launch row/);
});

test("a run that agreed on nothing is accounted only by columns that ran", () => {
  assert.equal(launchesAccounted([]), false);
  assert.equal(launchesAccounted([{entry: {name: "startup-hello"}, disposition: 4}, {entry: {name: listedName}, disposition: 1}]), true);
  assert.equal(launchesAccounted([{entry: {name: "startup-hello"}, disposition: 1}]), false);
});

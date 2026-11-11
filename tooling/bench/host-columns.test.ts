import {scriptedCommand,commandSample} from '../gate/command-observations-fixture.ts';
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { parse } from "acorn";
import { typedTimer } from "./typed-timer.ts";
import { parseMeasurement, buildCommand, buildFailure } from "./host-columns.ts";
import {type activeCommand, COMPILE_CPU_BOUND_SECONDS} from "../gate/active-command.ts";
import {testScratch} from "../gate/test-scratch.ts";
function receipt() {
  return {
    command: ["probe"],
    cwd: "/",
    startedAt: "2026-10-29T00:00:00Z",
    finishedAt: "2026-10-29T00:00:01Z",
    status: 0 as number | null,
    signal: null as string | null,
    stdout: "123.5 4000000000000000\n",
    stderr: "",
    wallNanoseconds: 1e9,
    cpu5: null,
  };
}
test("typed timing projection erases to the one canonical loop", () => {
  const source = readFileSync(
    new URL("../../benchmarks/common/bench.mjs", import.meta.url),
    "utf8",
  );
  const projected = typedTimer(source);
  const syntax = (s: string) =>
    JSON.stringify(
      parse(stripTypeScriptTypes(s), { ecmaVersion: "latest", sourceType: "module" }),
      (key, value) =>
        key === "start" || key === "end"
          ? undefined
          : typeof value === "bigint"
            ? String(value) + "n"
            : value,
    );
  assert.equal(syntax(projected), syntax(source));
  assert.throws(
    () =>
      typedTimer(source.replace("export function measure(run)", "export function renamed(run)")),
    /canonical timer changed/,
  );
});
test("host observations distinguish checksum, CPU budget, abort and hang", () => {
  const r = receipt();
  assert.deepEqual(parseMeasurement(r, "4000000000000000"), {
    ns: 123.5,
    checksum: "4000000000000000",
  });
  for (const [changed, status] of [
    [{ stdout: "123.5 0000000000000000" }, "INVALID"],
    [{ signal: "SIGXCPU", status: null }, "OVER_BUDGET"],
    [{ status: 124 }, "TIMED_OUT"],
    [{ signal: "SIGSEGV", status: null }, "ABORTED"],
    [{ stdout: "" }, "INVALID"],
  ] as const) {
    const observed = parseMeasurement({ ...r, ...changed }, "4000000000000000");
    assert.ok("status" in observed);
    assert.equal(observed.status, status);
    assert.equal(observed.nanoseconds, null);
  }
});

test("comparator builds share the compile bound and record a spinning child without blocking the next build", async t => {
  const root=testScratch(t,"comparator-build-bound");
  const supervise:typeof activeCommand=async(command,args,options)=>{
    assert.equal(options.eachProcessCpuSeconds,COMPILE_CPU_BOUND_SECONDS);
    return args.includes('--next')?scriptedCommand(command,options,[],{stdout:'next built'}):
      scriptedCommand(command,options,[commandSample(300,{cpu:60_000,own:0,busy:true,processOwn:{pid:71,cpu:60_000}})]);
  };
  const stopped=await buildCommand('/supplied-driver',[],root,{},supervise);
  assert.match(stopped.timeout??"",/process \d+ own CPU reached/);
  const cell=buildFailure(stopped);
  assert.equal(cell.status,"TIMED_OUT");
  assert.match(cell.reason??"",/^timed out building:/);
  assert.equal(cell.nanoseconds,null);
  const next=await buildCommand('/supplied-driver',['--next'],root,{},supervise);
  assert.equal(next.status,0,next.stderr);
  assert.equal(next.stdout,"next built");
});

test("an unmeasured comparator build keeps its hold instead of yielding a failure cell", async t => {
  const root=testScratch(t,"comparator-build-hold");
  const supervise:typeof activeCommand=async(command,_args,options)=>scriptedCommand(command,{...options,idleMs:200},[commandSample(200)]);
  await assert.rejects(()=>buildCommand("python3",["-c","import time; time.sleep(60)"],root,
    {},supervise),/build not measured:.*hung/);
});

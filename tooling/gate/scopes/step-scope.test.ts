import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { gateCpus, inheritedCpus } from "../affinity.ts";
import { waitForEmptyCgroup } from "./step-scope.ts";

test("a cgroup drain requires an observed populated zero", async () => {
  const states = [1, 1, 0] as const;
  let reads = 0, waits = 0;
  await waitForEmptyCgroup(() => states[reads++]!, { now: () => 0, wait: async () => { waits++; } });
  assert.equal(reads, 3); assert.equal(waits, 2);
});

test("a cleanup deadline and a failed cgroup read cannot become a drain proof", async () => {
  let tick = 0;
  await assert.rejects(waitForEmptyCgroup(() => 1, { now: () => 30_001 * tick++, wait: async () => {} }), /cgroup drain timed out/);
  await assert.rejects(waitForEmptyCgroup(() => { throw new Error("cgroup observation lost"); }), /cgroup observation lost/);
});

test("a delegated cpuset is applied to the owned scope without creating a sibling scope", async () => {
  const cpus = gateCpus(inheritedCpus());
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("step-scope.ts?ceiling-control") && specifier === "../affinity.ts") return {
      url: `data:text/javascript,${encodeURIComponent(`export const gateCpus=()=>${JSON.stringify(cpus)},inheritedCpus=()=>${JSON.stringify(cpus)},gateScope=()=>({kind:'scope'});`)}`, shortCircuit: true,
    };
    return next(specifier, context);
  } });
  try {
    const { GateScopes } = await import(new URL("./step-scope.ts?ceiling-control", import.meta.url).href);
    const owner = new GateScopes(process.env), step = owner.step({ max: 2 ** 31 });
    try {
      const launch = step.command("/bin/true", []);
      assert.equal(launch.command, "systemd-run");
      assert.equal(launch.args.filter((argument: string) => argument === "--scope").length, 1);
      assert.ok(launch.args.includes(`--property=AllowedCPUs=${cpus}`));
      assert.ok(launch.args.includes(`--slice=${step.slice}`));
      assert.equal(launch.args.includes("systemd-run"), false, "the inner command cannot move itself to another scope");
    } finally { await step.drain(); owner.close(); }
  } finally { hooks.deregister(); }
});

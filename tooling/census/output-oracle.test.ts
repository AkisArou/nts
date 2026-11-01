import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { capped } from "./attempt262.ts";
import { materialise, workspace } from "./project.ts";
import { outputOracle } from "./output-oracle.ts";

for (const language of ["js", "ts"] as const) for (const module of [false, true]) {
  test(`the ${language} output oracle preserves the ${module ? "module" : "script"} source goal and harness`, () => {
    const base = join(homedir(), ".cache/nts-output-oracle-tests");
    mkdirSync(base, { recursive: true });
    const scratch = mkdtempSync(join(base, "case-"));
    try {
      const project = workspace(join(scratch, "project"), language);
      const source = `/*---\nflags: [${module ? "module" : ""}]\n---*/\nassert.sameValue(2 + 2, 4); assert.sameValue(this === undefined, ${language === "ts" || module}); console.log("before"); try { console.log("body"); } finally { console.log("finally"); }`;
      materialise(project, source, undefined, language);
      const tools = { language, memoryCapKb: 6_000_000 };
      const result = outputOracle(project, scratch, source, tools, (command, args) => capped(tools, command, args));
      assert.deepEqual(result, { ok: true, output: "before\nbody\nfinally\n" });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
}

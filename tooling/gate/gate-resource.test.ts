import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GateResource} from "./gate-resource.ts";

test("the gate resource stays locked across a child, and releases on close",t=>{
  const directory=mkdtempSync(join(tmpdir(),"gate-resource-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,"tree.lock"),held=GateResource.tryAcquire(file)!;
  assert.ok(held);
  assert.equal(GateResource.tryAcquire(file),null);
  const child=spawnSync(process.execPath,["--input-type=module","-e",`
    import {GateResource} from ${JSON.stringify(new URL("./gate-resource.ts",import.meta.url).href)};
    if (!GateResource.inherited(process.argv[1])) process.exit(1);
  `,file],{env:held.env(),stdio:held.stdio("pipe")});
  assert.equal(child.status,0,child.stderr?.toString());
  assert.equal(GateResource.tryAcquire(file),null,"child exit must not release the parent's open description");
  held.close();const next=GateResource.tryAcquire(file);assert.ok(next);next.close();
});

test("a claimed inherited descriptor for another file is refused",t=>{
  const directory=mkdtempSync(join(tmpdir(),"gate-resource-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const held=GateResource.tryAcquire(join(directory,"tree.lock"))!,other=join(directory,"other.lock");writeFileSync(other,"");
  const child=spawnSync(process.execPath,["--input-type=module","-e",`
    import {GateResource} from ${JSON.stringify(new URL("./gate-resource.ts",import.meta.url).href)};
    GateResource.inherited(process.argv[1]);
  `,other],{env:held.env(),stdio:held.stdio("pipe")});
  held.close();assert.notEqual(child.status,0);assert.match(child.stderr!.toString(),/names another file/);
});

test("cpuset scope re-entry preserves the tree-lock descriptor",t=>{
  const directory=mkdtempSync(join(tmpdir(),"gate-resource-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const held=GateResource.tryAcquire(join(directory,"tree.lock"))!;
  const script=join(directory,"systemd-run");
  writeFileSync(script,`#!${process.execPath}\nrequire('node:fs').fstatSync(8);process.stdout.write('lock descriptor retained');\n`,{mode:0o755});
  const child=spawnSync(process.execPath,[new URL("../gate/affinity.ts",import.meta.url).pathname,"--launch-scope","0-3,6-31","true"],
    {env:{...held.env(),PATH:`${directory}:${process.env.PATH}`},stdio:held.stdio("pipe")});
  held.close();assert.equal(child.status,0,child.stderr?.toString());assert.match(child.stdout!.toString(),/lock descriptor retained/);
});

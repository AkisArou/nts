import {generatedJavaScript} from '../gate/generated-javascript.ts';
// node --test tooling/full-check/measure.test.ts
//
// How a run's summary.json is read: a skip the policy accepts passes, a step
// that did not complete is held, a platform's programs left unrun hold their
// step unless the policy lets that platform stay unrun, and a summary of
// another commit or from a non-canonical environment vouches for nothing.
import assert from "node:assert/strict";
import { chmodSync,existsSync,mkdirSync,mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";
import { fullCheckCeiling, pinnedGate, readSummary, verdictOf } from "./measure.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import { spawnTest } from "../gate/test-wait.ts";
import { newToolingSlice, stopToolingSlice, toolingSliceArgs } from "../gate/tooling-slice.ts";
import {layout} from "./state.ts";
import {scratchRepo} from "../landing/scratch-repo.ts";
import {nodeInstallation} from "../gate/toolchain-fixture.ts";
import {candidateEnvironmentFixture,candidateVersion,resolutionSubject,assertSessionClosed} from './run-environment-fixture.ts';
import {hostEnvironment} from '../gate/canonical-environment.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {ownMemory} from '../gate/test-memory.ts';

const COMMIT = "1234567890ab".padEnd(40, "c");

function summary(t: { after(fn: () => void): void }, value: unknown): string {
  const run = mkdtempSync(join(tmpdir(), "full-check-summary-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  writeFileSync(join(run, "summary.json"), typeof value === "string" ? value : JSON.stringify(value));
  return run;
}

const steps = [
  { name: "build", verdict: "PASS" },
  { name: "tests", verdict: "FAIL", reason: "exit 1" },
  { name: "on-device", verdict: "SKIPPED", reason: "SKIP: no device", accepted: true },
  { name: "dex", verdict: "SKIPPED", reason: "SKIP: no d8" },
  { name: "rc", verdict: "INSTRUMENT", reason: "memory pre-check" },
  { name: "llvm", verdict: "NOT RUN", reason: "build failed" },
];

test("the full check sizes its backstop from the last canonical green wall",t=>{
  const baseline="build\t800\t1000\t1\ntests\t1200\t4000\t8\n";
  const run=summary(t,{wall_s:1820.1,verdict:"green",identities:{commit:COMMIT},environment:{canonical:true}});
  const previous={commit:COMMIT,run,verdict:"green" as const,at:"",failed:[]};
  assert.equal(fullCheckCeiling(previous,["build","tests"],baseline),5461);
  assert.equal(fullCheckCeiling({...previous,commit:"f".repeat(40)},["build","tests"],baseline),3600);
  assert.equal(fullCheckCeiling(undefined,["build"],baseline),2400);
  assert.equal(fullCheckCeiling(undefined,["format"],baseline),900);
});

test("a full-check wall ceiling stops an older command and holds even a green summary",t=>{
  const run=newTestScratch("full-check-wall-ceiling"),slice=newToolingSlice(true),unit=`nts-test-full-check-wall-${randomUUID()}`;
  t.after(()=>{
    spawnTest("systemctl",["--user","stop",unit],{encoding:"utf8"});
    stopToolingSlice(slice);
    rmSync(run,{recursive:true,force:true});
  });
  writeFileSync(join(run,"summary.json"),JSON.stringify({
    identities:{commit:COMMIT},environment:{canonical:true},steps:[{name:"program-oracles",verdict:"PASS"}],
  }));
  const measure=fileURLToPath(new URL("./measure-command.ts",import.meta.url));
  const result=spawnTest("systemd-run",["--user",`--unit=${unit}`,...toolingSliceArgs(),"--collect","--quiet","--pipe","--wait",
    "-p","LimitCORE=0","-p","Nice=19","-p","CPUAffinity=0-3 6-31","-p","RuntimeMaxSec=30s",
    process.execPath,measure,"3",run,slice,"tail","-f","/dev/null"],{encoding:"utf8"});
  assert.equal(result.status,124,result.stdout+result.stderr);
  assert.deepEqual(readSummary(run,COMMIT,["program-oracles"]),{
    steps:{"program-oracles":"HELD"},
    reasons:{"program-oracles":"full check run exceeded its wall ceiling of 3 s"},
  });
});

test("the full check launches each measured commit with its pin, including historical commits",t=>{
  const repo=scratchRepo(t,"full-check-toolchain"),paths=layout(repo.dir),installations=join(repo.dir,"installed"),log=join(repo.dir,"node-launches.jsonl");
  const legacySlice=`nts-tooling-${randomUUID().replaceAll("-","")}.slice`;
  for(const pin of ["99.1.0","99.2.0"])nodeInstallation(installations,pin,log);
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
node --input-type=module -e 'import {writeFileSync} from "node:fs";import {join} from "node:path";if(process.env.NTS_TOOLING_SLICE!==${JSON.stringify(legacySlice)})throw Error("historical slice grammar changed");const run=process.env.NTS_GATE_RUN_DIR;writeFileSync(join(run,"observed-node"),process.env.PATH);writeFileSync(join(run,"summary.json"),JSON.stringify({identities:{commit:process.argv[1]},environment:{canonical:true},steps:[{name:"tooling",verdict:"PASS"}]}));' "$1"
`;
  candidateEnvironmentFixture(repo.root);
  const naming=join(repo.root,"tooling/gate/tooling-slice.ts");
  writeFileSync(join(repo.root,"tooling/gate/current-tooling-slice.ts"),readFileSync(naming));
  writeFileSync(naming,`export * from './current-tooling-slice.ts';export function newToolingSlice(){return ${JSON.stringify(legacySlice)};}
export function toolingSlice(env=process.env){const value=env.NTS_TOOLING_SLICE;if(value!==undefined&&value!==${JSON.stringify(legacySlice)})throw Error('historical slice grammar changed');return value;}\n`);
  repo.git(['add','-f','tooling']);repo.git(['commit','-qm','private environment']);
  const old=repo.commit({".tool-versions":"nodejs 99.1.0\n","tooling/gate/pinned.sh":script},"first pin");
  const next=repo.commit({".tool-versions":"nodejs 99.2.0\n"},"next pin");
  const gate=pinnedGate(paths,repo.root,()=>{},{nodeInstallations:installations,env:{...hostEnvironment(process.env),HOME:repo.dir}});
  for(const [commit,pin] of [[old,"99.1.0"],[next,"99.2.0"]]){
    const result=gate.run(commit!,["tooling"],pin!);
    assert.equal(result.verdict,"green",JSON.stringify(result.reasons)+"\n"+readFileSync(join(result.run,"full-check.log"),"utf8"));
    assert.equal(readFileSync(join(result.run,"observed-node"),"utf8").split(":")[0],join(installations,pin!,"bin"));
  }
  const missing=repo.commit({".tool-versions":"nodejs 99.3.0\n"},"missing pin");
  const result=gate.run(missing,["tooling"],"missing");
  assert.equal(result.verdict,"held");assert.match(result.reasons.tooling!,/asdf install nodejs 99\.3\.0/);
  const invocations=readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line) as string[]);
  assert.equal(invocations.filter(args=>args.includes("--input-type=module")).length,4,"both pins construct their slice and execute their private binary");
  const historical = gate.run(old, ["tooling"], "historical-reuse-fallback", undefined, { reuseLanding: true });
  assert.equal(historical.verdict, "green", JSON.stringify(historical.reasons));
  assert.deepEqual(historical.steps, { tooling: "PASS" }, "a historical candidate without a portable contract executes the requested check");
});

test('red full-check runs use the measured environment and release resolution sessions while the controller lives',async t=>{
  const repo=scratchRepo(t,'full-check-session'),paths=layout(repo.dir),installations=join(repo.dir,'installed');
  nodeInstallation(installations,process.versions.node,join(repo.dir,'nodes.jsonl'));
  candidateEnvironmentFixture(repo.root);candidateVersion(repo.root,'measured');
  const observed=join(repo.dir,'observed.json'),session=join(repo.dir,'retained-session');
  const subject=resolutionSubject(observed,session,1)+generatedJavaScript(`import {durableRecord as publishSummary} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};publishSummary(process.env.NTS_GATE_RUN_DIR+'/summary.json',{identities:{commit:process.argv[2]},environment:{canonical:true},steps:[{name:'tooling',verdict:'FAIL',reason:'private red control'}]});\n`);
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
exec node "$NTS_GATE_TREE/subject.ts" "$1"
`;
  repo.git(['add','-f','tooling','.tool-versions']);repo.git(['commit','-qm','measured environment']);
  const commit=repo.commit({'tooling/gate/pinned.sh':script,'subject.ts':subject},'red measured command');
  const gate=pinnedGate(paths,repo.root,()=>{},{nodeInstallations:installations,env:{...hostEnvironment(process.env),HOME:repo.dir}});
  for(const label of ['core','core-probe','wide']){
    const measured=gate.run(commit,['tooling'],label);
    assert.equal(measured.verdict,'red',JSON.stringify(measured.reasons));
    const value=JSON.parse(readFileSync(observed,'utf8'));assert.equal(value.version,'measured');assert.equal(value.canonical,true);
    await assertSessionClosed(observed);
    // Each run gets a distinct resolution directory just like production.
    rmSync(session,{recursive:true});
  }
});

test('the real pinned wrapper preserves the tree lock across candidate environment creation and consumes its handoff',async t=>{
  const repo=scratchRepo(t,'full-check-pinned-session'),paths=layout(repo.dir),installations=join(repo.dir,'installed');
  candidateEnvironmentFixture(repo.root);
  // The repository starts with a committed private linker; stage before restoring it.
  const linker=join(repo.root,'tooling/inputs/link.sh'),privateLinker=readFileSync(linker);
  rmSync(linker);
  copyModuleClosure(['tooling/inputs/linker.ts','tooling/gate/admit.ts'],repo.root);
  writeFileSync(linker,privateLinker);
  assert.deepEqual(readFileSync(linker),privateLinker,"the pinned-wrapper fixture owns its no-op linker");
  const affinity=join(repo.root,'tooling/gate/affinity.ts'),originalAffinity=readFileSync(affinity,'utf8');
  const affinityEntry='if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)';
  assert.equal(originalAffinity.split(affinityEntry).length,2);
  writeFileSync(affinity,originalAffinity.replace(affinityEntry,'if (false)'));
  const observed=join(repo.dir,'observed.json'),session=join(repo.dir,'retained-session'),bin=join(repo.dir,'bin');mkdirSync(bin);
  const cargo=join(bin,'cargo');writeFileSync(cargo,'#!/bin/sh\nmkdir -p "$CARGO_TARGET_DIR/release"\nprintf "#!/bin/sh\\n" > "$CARGO_TARGET_DIR/release/nts"\n');chmodSync(cargo,0o755);
  nodeInstallation(installations,process.versions.node,join(repo.dir,'nodes.jsonl'));
  const subject=resolutionSubject(observed,session,1)+generatedJavaScript(`import assert from 'node:assert/strict';assert.equal(process.env.NTS_GATE_LOCK_FD,undefined);\nimport {GateResource} from ${JSON.stringify(new URL('../gate/gate-resource.ts',import.meta.url).href)};assert.equal(GateResource.tryAcquire(process.env.NTS_GATE_TREE+'.lock'),null);\nimport {durableRecord as publishSummary} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};publishSummary(process.env.NTS_GATE_RUN_DIR+'/summary.json',{identities:{commit:process.argv[2]},environment:{canonical:true},steps:[{name:'tooling',verdict:'FAIL'}]});\n`);
  repo.git(['add','-f','tooling','.tool-versions']);repo.git(['commit','-qm','private candidate inputs']);
  const script=readFileSync(new URL('../gate/pinned.sh',import.meta.url),'utf8');
  const commit=repo.commit({'tooling/gate/pinned.sh':script,'subject.ts':subject,'tooling/gate/all.sh':`#!/bin/sh\nif [ "$1" = --list ];then echo tooling; exit 0;fi\nexec node subject.ts "$(git rev-parse HEAD)"\n`},'real pinned control');
  const lines:string[]=[],gate=pinnedGate(paths,repo.root,line=>lines.push(line),{nodeInstallations:installations,env:{...hostEnvironment(process.env),...ownMemory(join(repo.dir,'machine')),HOME:repo.dir,CARGO_HOME:repo.dir}});
  const result=gate.run(commit,['tooling'],'core');assert.equal(result.verdict,'red',JSON.stringify(result.reasons)+'\n'+lines.join('\n')+'\n'+readFileSync(join(result.run,'full-check.log'),'utf8'));
  await assertSessionClosed(observed);
  const lock=GateResource.tryAcquire(paths.tree+'.lock');assert.ok(lock,'the run releases the tree lock');lock.close();
  assert.equal(existsSync(join(result.run,'summary.json')),true);
  const busy=GateResource.tryAcquire(paths.tree+'.lock')!;
  try{
    const held=gate.run(commit,['tooling'],'busy');assert.equal(held.verdict,'held');
    assert.match(held.reasons.tooling!,/full-check gate tree is in use/);
  }finally{busy.close();}
});

test("each step's verdict, as the full check reads it", t => {
  const run = summary(t, { verdict: "red", identities: { commit: COMMIT.slice(0, 12) }, environment: { canonical: true }, steps });
  const read = readSummary(run, COMMIT, [...steps.map(s => s.name), "missing"]);
  assert.deepEqual(read.steps, { build: "PASS", tests: "FAIL", "on-device": "PASS", dex: "HELD", rc: "HELD", llvm: "HELD", missing: "HELD" });
  assert.equal(read.reasons.tests, "FAIL: exit 1");
  assert.equal(read.reasons.missing, "not in the summary");
  assert.equal(verdictOf(read.steps), "red");
  assert.equal(verdictOf({ build: "PASS", rc: "HELD" }), "held");
  assert.equal(verdictOf({ build: "PASS", "on-device": "PASS" }), "green");
});

test("a summary that cannot vouch for the commit holds every step", t => {
  const other = summary(t, { identities: { commit: "ffffffffffff" }, environment: { canonical: true }, steps });
  assert.deepEqual(new Set(Object.values(readSummary(other, COMMIT, ["build"]).steps)), new Set(["HELD"]));
  const experiment = summary(t, { identities: { commit: COMMIT }, environment: { canonical: false }, steps });
  assert.equal(readSummary(experiment, COMMIT, ["build"]).reasons.build, "the run was not in the canonical environment");
  const broken = summary(t, "{ not json");
  assert.match(readSummary(broken, COMMIT, ["build"]).reasons.build!, /^unreadable summary/);
  assert.equal(readSummary(join(broken, "absent"), COMMIT, ["build"]).reasons.build, "the run wrote no summary");
});

test("a platform's programs left unrun pass while the policy lets it stay unrun, and hold their step when it does not", t => {
  const run = summary(t, { verdict: "green", identities: { commit: COMMIT }, environment: { canonical: true },
    steps: [{ name: "interop", verdict: "PASS" }, { name: "examples", verdict: "PASS" }] });
  const macos = "macos-hello      skipped: SKIP macos-hello: not run -- no Mac reachable (tooling/apple/vm.md)";
  const windows = "winui-hello      skipped: SKIP winui-hello: no Windows SDK";
  writeFileSync(join(run, "interop.log"), `  linux-hello      ok\n  ${macos}\n  ${windows}\n  16 built and ran, 2 skipped\n`);
  // The same line in a step that runs no platform's programs says nothing of them.
  writeFileSync(join(run, "examples.log"), `${macos}\n`);
  const both = ["interop", "examples"];
  assert.deepEqual(readSummary(run, COMMIT, both), { steps: { interop: "PASS", examples: "PASS" }, reasons: {} }, "both platforms may stay unrun today");
  const narrower = readSummary(run, COMMIT, both, { platforms: ["windows"], policy: "a narrower policy" });
  assert.deepEqual(narrower.steps, { interop: "HELD", examples: "PASS" });
  assert.equal(narrower.reasons.interop, `apple programs did not run, and a narrower policy lets only windows stay unrun: ${macos}`);
  const none = readSummary(run, COMMIT, both, { platforms: [], policy: "a policy" });
  assert.equal(none.reasons.interop, [macos, windows].map((line, i) => `${["apple", "windows"][i]} programs did not run, and a policy lets no platform stay unrun: ${line}`).join("; "));
  assert.equal(verdictOf(none.steps), "held");
});

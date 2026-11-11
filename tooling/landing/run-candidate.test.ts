// A landing's candidate (run.ts): its pinned Node, the build and gate
// environment it creates with its own producer, and the oracle handoff it
// inherits or holds. Shared helpers are in run-fixture.ts.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {chmodSync,copyFileSync,existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join,dirname,resolve} from "node:path";
import {ENVIRONMENT_CONTEXT,gateEnvironment,hostEnvironment,sealOracleRun} from "../gate/canonical-environment.ts";
import {launcherEnvironment,PROFILE,runLanding} from "./run.ts";
import {nodeInstallation} from "../gate/toolchain-fixture.ts";
import {fullEnvironment} from "../census/full-plan.ts";
import {candidateCommand} from "./candidate-environment.ts";
import {GATE,fixture} from './run-fixture.ts';

test("a runner's in-process provisioning ignores a launcher-supplied Git", t => {
  const f = fixture(t), options = f.options([]), bin = join(f.own, "launcher-tools");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf launcher-git\n", { mode: 0o755 });
  mkdirSync(join(f.target, PROFILE), { recursive: true });
  writeFileSync(join(f.target, PROFILE, "nts"), "#!/bin/sh\n", { mode: 0o755 });
  f.control("rustfmt", "pass");
  const planned = gateEnvironment(launcherEnvironment(options.env), {
    run: f.run, oracleRoot: f.tree, oracleAdmissionContext: "gate",
    owned: { ...options.owned, NTS_BIN: join(f.target, PROFILE, "nts"), CARGO_TARGET_DIR: f.target },
  });
  const result = spawnSync(process.execPath, [join(f.tree, "tooling/gate/run.mjs"), "rustfmt"], {
    cwd: f.tree, env: { ...planned.env, PATH: bin + ":" + planned.env.PATH }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  assert.equal(summary.environment.canonical, true);
  assert.equal(summary.identities.commit, options.commit);
  assert.equal(summary.steps[0].verdict, "PASS");
});

test("a landing launches the candidate's pinned Node and forwards it to the build and child commands",async t=>{
  const f=fixture(t),pin="99.1.0",installations=join(f.own,"installed"),log=join(f.own,"node-launches.jsonl");
  const node=nodeInstallation(installations,pin,log);
  writeFileSync(join(f.tree,".tool-versions"),`nodejs ${pin}\n`);
  const ran=await runLanding(f.options(["build","rustfmt"],{nodeInstallations:installations,
    build:["sh","-c",`node --version > "$CARGO_TARGET_DIR/build-node"; mkdir -p "$CARGO_TARGET_DIR/${PROFILE}"; printf '#!/bin/sh\\n' > "$NTS_BIN"; chmod +x "$NTS_BIN"`]}));
  assert.equal(ran.state,"green",ran.message);
  assert.equal(readFileSync(join(f.target,"build-node"),"utf8"),"v"+pin+"\n");
  const calls=readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line) as string[]);
  assert.ok(calls.some(args=>args[0]===join(f.tree,"tooling/gate/run.mjs")),"the runner is launched through the selected absolute binary");
  const environment=JSON.parse(readFileSync(join(f.run,"summary.json"),"utf8")).environment;
  assert.equal(environment.host.PATH.split(":")[0],dirname(node));
});

test("missing and wrong-version candidate Node installations hold without a launcher fallback",async t=>{
  for(const present of [false,true])await t.test(present?"wrong version":"not installed",async()=>{
    const f=fixture(t),pin="99.1.0",installations=join(f.own,"installed");
    writeFileSync(join(f.tree,".tool-versions"),`nodejs ${pin}\n`);
    if(present)nodeInstallation(installations,pin,join(f.own,"node-launches.jsonl"),"98.0.0");
    const ran=await runLanding(f.options(["rustfmt"],{nodeInstallations:installations}));
    assert.equal(ran.state,"held");assert.match(ran.message,/pinned Node 99\.1\.0/);
    assert.match(ran.message,/asdf install nodejs 99\.1\.0/);assert.deepEqual(f.calls(),[]);
  });
});

test("the candidate creates its build and gate environment with its own changed producer",async t=>{
  const f=fixture(t),canonical=join(f.tree,'tooling/gate/canonical-environment.ts'),producer=join(f.tree,'tooling/differential/oracle-dependencies.ts');
  for(const file of [canonical,producer]){const bytes=readFileSync(file);unlinkSync(file);writeFileSync(file,bytes);}
  copyFileSync(join(GATE,'../differential/oracle-toolchain.json'),join(f.tree,'tooling/differential/oracle-toolchain.json'));
  writeFileSync(producer,readFileSync(producer,'utf8')+'\n// This candidate owns a different provisioner.\n');
  const expected=createHash('sha256').update(readFileSync(producer)).digest('hex');
  const options=f.options(['build','rustfmt'],{build:[process.execPath,'--input-type=module','-e',`import {mkdirSync,writeFileSync} from 'node:fs';import {dirname} from 'node:path';writeFileSync(${JSON.stringify(join(f.controls,'build-capture'))},process.env.NTS_ORACLE_DEPENDENCIES);mkdirSync(dirname(process.env.NTS_BIN),{recursive:true});writeFileSync(process.env.NTS_BIN,'#!/bin/sh\\n',{mode:0o755});`]});
  // A controller-owned same-root grant cannot be verified by this producer.
  const wrong=gateEnvironment(launcherEnvironment(options.env),{run:f.run,owned:options.owned,oracleRoot:f.tree});
  const before=spawnSync(process.execPath,[join(f.tree,'tooling/gate/run.mjs')],{cwd:f.tree,env:{...wrong.env,NTS_GATE_STEPS:'rustfmt'},encoding:'utf8'});
  assert.notEqual(before.status,0);assert.match(before.stdout+before.stderr,/oracle dependency provisioner source mismatch/);
  assert.equal(JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8')).steps[0].verdict,'INSTRUMENT');
  const ran=await runLanding(options);assert.equal(ran.state,'green',ran.message);
  assert.equal(JSON.parse(readFileSync(join(f.controls,'build-capture'),'utf8')).helperSha256,expected);
  const summary=JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8'));
  assert.equal(JSON.parse(summary.environment.host.NTS_ORACLE_DEPENDENCIES).helperSha256,expected);
  assert.equal(summary.environment.canonical,true);
  // The full check's controller-root grant is foreign. The measured runner
  // already captures with its own producer after pinned.sh changes trees.
  const full=join(f.own,'home/.cache/full'),env=fullEnvironment({candidate:false,commit:options.commit,label:'MAIN',run:full,tree:f.tree,target:f.target},['rustfmt'],hostEnvironment(options.env!));
  const fullOwned=gateEnvironment(env,{run:full,owned:f.memory}).env;
  const measured=spawnSync(process.execPath,[join(f.tree,'tooling/gate/run.mjs')],{cwd:f.tree,env:fullOwned,encoding:'utf8'});
  assert.equal(measured.status,0,measured.stdout+measured.stderr);
  const observed=JSON.parse(readFileSync(join(full,'summary.json'),'utf8'));
  assert.equal(JSON.parse(observed.environment.host.NTS_ORACLE_DEPENDENCIES).helperSha256,expected);
  assert.equal(observed.environment.canonical,true);
});

test("a candidate missing the gateEnvironment contract is refused by name without executing its build",async t=>{
  const f=fixture(t),file=join(f.tree,'tooling/gate/canonical-environment.ts');unlinkSync(file);writeFileSync(file,'export const legacy=true;\n');
  const ran=await runLanding(f.options(['build'],{build:['sh','-c',`echo forbidden > ${JSON.stringify(join(f.controls,'built'))}`]}));
  assert.equal(ran.state,'red');assert.equal(existsSync(join(f.controls,'built')),false);
  assert.match(readFileSync(ran.steps[0]!.log!,'utf8'),/candidate environment contract: .*canonical-environment.ts must export gateEnvironment/);
});

test('an exception creating the candidate environment holds the landing instead of failing its build',async t=>{
  const f=fixture(t),file=join(f.tree,'tooling/gate/canonical-environment.ts');unlinkSync(file);
  writeFileSync(file,"export function gateEnvironment(){throw Error('candidate environment setup control');}\n");
  const ran=await runLanding(f.options(['build'],{build:['sh','-c',`echo forbidden > ${JSON.stringify(join(f.controls,'built'))}`],attempts:1}));
  assert.equal(ran.state,'held');assert.equal(ran.steps[0]!.verdict,'INSTRUMENT');
  assert.match(ran.steps[0]!.reason!,/candidate environment setup control/);
  assert.equal(existsSync(join(f.controls,'built')),false);
});

test("the candidate environment launcher preserves killed and unstarted build observations",t=>{
  for(const command of [['sh','-c','kill -TERM $$'],['/no-such-nts-build-command']]){
    const f=fixture(t),options=f.options([]),result=candidateCommand(process.execPath,{tree:f.tree,run:f.run,owned:options.owned!,command},launcherEnvironment(options.env));
    if(command[0]==='sh')assert.equal(result.signal,'SIGTERM');
    else assert.match(result.error!.message,/ENOENT/);
  }
});

test("a candidate gate replaces old main's foreign oracle handoff but holds its own changed seal",async t=>{
  for(const foreign of [true,false])await t.test(foreign?"foreign root gets a fresh capture":"same-root corruption holds",async()=>{
    const f=fixture(t),options=f.options(["rustfmt"]);f.control("rustfmt","oracle-context");
    const launcher=launcherEnvironment(options.env);
    const planned=gateEnvironment(launcher,{run:f.run,owned:{...options.owned,NTS_GATE_STEPS:"rustfmt"},oracleAdmissionContext:"gate",
      ...(!foreign?{oracleRoot:f.tree}:{})});
    const parent=await sealOracleRun(planned),before=JSON.parse(parent.env.NTS_ORACLE_DEPENDENCIES!) as {source:string;directory:string;admission:unknown;seal:{record:string}};
    assert.equal(before.source,foreign?resolve(GATE,"../.."):f.tree);
    const original=readFileSync(before.seal.record);
    writeFileSync(join(f.controls,"parent-record"),before.seal.record);
    if(!foreign){chmodSync(before.seal.record,0o644);writeFileSync(before.seal.record,Buffer.concat([original,Buffer.from(" ")]));chmodSync(before.seal.record,0o444);}
    const child=candidateCommand(process.execPath,{tree:f.tree,run:f.run,owned:{},command:[process.execPath,join(f.tree,"tooling/gate/run.mjs")]},parent.env);
    if(foreign){
      assert.equal(child.status,0,child.stdout+child.stderr);
      const observed=JSON.parse(readFileSync(join(f.controls,"oracle-context.json"),"utf8")) as {capture:typeof before;imageSource:string;parentSha256:string;temporary:unknown};
      const after=observed.capture;
      assert.equal(after.source,f.tree);assert.notEqual(after.directory,before.directory);assert.notEqual(after.seal.record,before.seal.record);
      assert.deepEqual(after.admission,before.admission);
      assert.equal(observed.parentSha256,createHash("sha256").update(original).digest("hex"),"the unused parent capture remains intact until cleanup");
      assert.equal(observed.imageSource,f.tree);assert.deepEqual(observed.temporary,parent.temporary);
    }else{
      assert.notEqual(child.status,0,child.stdout+child.stderr);
      assert.match(child.stdout+child.stderr,/oracle dependency.*(?:changed|identity|seal)/);
      assert.equal(existsSync(join(f.controls,"oracle-context.json")),false,"a corrupt owned seal grants no execution");
      assert.deepEqual(readFileSync(before.seal.record),Buffer.concat([original,Buffer.from(" ")]),"no replacement hides the corruption");
    }
  });
});

test('the candidate launcher refuses a malformed inherited oracle grant before executing a command',t=>{
  const f=fixture(t),options=f.options(['rustfmt']),planned=gateEnvironment(options.env!,{run:f.run,owned:options.owned,oracleRoot:f.tree});
  const context=JSON.parse(planned.env[ENVIRONMENT_CONTEXT]!),cap=JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!);cap.version=0;
  const raw=JSON.stringify(cap);context.owned.NTS_ORACLE_DEPENDENCIES=raw;context.report.host.NTS_ORACLE_DEPENDENCIES=raw;
  const child=candidateCommand(process.execPath,{tree:f.tree,run:f.run,owned:{},command:['sh','-c',`echo forbidden > ${JSON.stringify(join(f.controls,'launched'))}`]},
    {...planned.env,NTS_ORACLE_DEPENDENCIES:raw,[ENVIRONMENT_CONTEXT]:JSON.stringify(context)});
  assert.equal(child.status,2);assert.match(child.stderr,/invalid owned oracle dependency handoff/);
  assert.match(child.error!.message,/invalid owned oracle dependency handoff/);
  assert.equal(existsSync(join(f.controls,'launched')),false);
});

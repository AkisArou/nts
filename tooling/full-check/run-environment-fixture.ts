// Real candidate environment and resolution service, in private test roots.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {waitFor} from '../gate/test-wait.ts';
import {nodeProcessAlive,type NodeResolutionSession} from '../differential/oracle-runtime.ts';

export function candidateEnvironmentFixture(tree:string):void{
  mkdirSync(tree,{recursive:true});
  copyModuleClosure(['tooling/gate/canonical-environment.ts'],tree);
  writeFileSync(join(tree,'.tool-versions'),`nodejs ${process.versions.node}\n`);
}

export function candidateVersion(tree:string,version:string):void{
  const file=join(tree,'tooling/gate/canonical-environment.ts');
  writeFileSync(join(tree,'tooling/gate/candidate-base.ts'),readFileSync(file));
  writeFileSync(file,`export * from './candidate-base.ts';import {gateEnvironment as original} from './candidate-base.ts';export function gateEnvironment(...args){const value=original(...args);value.env.CANDIDATE_VERSION=${JSON.stringify(version)};return value;}\n`);
}

/** The directory is outside disposable tmp so owner exit is what closes it. */
export function resolutionSubject(observed:string,session:string,status:number):string{
  return `import {writeFileSync,existsSync} from 'node:fs';
import {startNodeResolutionSession,nodeResolutionOptions} from ${JSON.stringify(new URL('../differential/oracle-resolution.ts',import.meta.url).href)};
const context=JSON.parse(process.env.NTS_GATE_ENV_CONTEXT);
const holder=await startNodeResolutionSession(${JSON.stringify(session)},nodeResolutionOptions([],process.env),context.resolutionOwner.pid);
writeFileSync(${JSON.stringify(observed)},JSON.stringify({holder,version:process.env.CANDIDATE_VERSION,canonical:context.report.canonical,tmp:process.env.TMPDIR,there:existsSync(process.env.TMPDIR),bin:process.env.NTS_BIN,node:process.versions.node,command:process.pid}));
process.exitCode=${status};\n`;
}

export async function assertSessionClosed(observed:string):Promise<void>{
  const {holder}=JSON.parse(readFileSync(observed,'utf8')) as {holder:NodeResolutionSession};
  assert.notEqual(holder.owner.pid,process.pid,'the controller must not own the resolution session');
  assert.equal(nodeProcessAlive(holder.owner),false,'the per-run owner exited');
  assert.equal(existsSync(holder.directory),true,'retained evidence cannot be the reason for shutdown');
  await waitFor('resolution server to finish after its per-run owner exits',()=>existsSync(join(holder.directory,'holder-finished.json')));
  assert.equal(existsSync(join(holder.directory,'holder.sock')),false);
}

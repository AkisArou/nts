// Test children get tool capabilities and named run handoffs, never the shell's
// policy. Mutable state belongs to the fixture; declared content caches are shared.
import {existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {userInfo} from 'node:os';
import {delimiter,dirname,join} from 'node:path';
import {ENVIRONMENT_CONTEXT,FIXED_AMBIENT,HOST_CAPABILITIES,ownTemporary,type GateEnvironmentContext} from './canonical-environment.ts';
import {HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT} from './host-observations.ts';
import {assertRunTemporary,removable} from './run-temporary.ts';
import {toolchainDirectories} from './toolchain.ts';
import {CONTENT_CACHE_ENVIRONMENT,contentCacheEnvironment} from './cache-environment.ts';

const HANDOFF = ['NTS_BIN','NTS_SUITE_BIN','NTS_TOOLING_SLICE','NTS_ORACLE_TYPESCRIPT','NTS_ORACLE_DEPENDENCIES'] as const;
const RUN_HANDOFF = ['NTS_TOOLING_SLICE','NTS_MEMORY_RESERVATION','NTS_MEMORY_PRIORITY','NTS_GATE_SCOPE_EXPECTED',
  'NTS_GATE_STEP','NTS_GATE_STEP_ATTEMPT','NTS_GATE_STEP_RESULT','NTS_GATE_STEP_MEMORY_BYTES','NTS_GATE_CASE_COSTS_DIR','NTS_CHECKERS'] as const;
const HOST = new Set<string>(HOST_CAPABILITIES);
const WRITABLE = ['HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TMPDIR','NODE_COMPILE_CACHE',
  'GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_CONFIG_NOSYSTEM','GIT_TERMINAL_PROMPT',
  'GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL'] as const;
const roots=new Set<string>();
type Fixture={after(fn:()=>void):void};
const fixtures=new WeakMap<Fixture,NodeJS.ProcessEnv>();
process.once('exit',()=>{
  for(const root of roots)try{
    if(existsSync(root)){removable(root);rmSync(root,{recursive:true,force:true});}
  }catch(error){process.stderr.write(`test environment cleanup failed for ${root}: ${String(error)}\n`);process.exitCode=1;}
});

/** Only allowlisted tools come from the caller. Policy, Git settings and
 * writable directories are supplied here or explicitly by the fixture. */
export function testEnvironment(owned:NodeJS.ProcessEnv={},source:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={...FIXED_AMBIENT,NTS_CHECKERS:'1'};
  for(const name of HOST_CAPABILITIES)if(name!=='HOME'&&source[name]!==undefined)env[name]=source[name];
  const account=userInfo().homedir;
  env.CARGO_HOME??=join(account,'.cargo');env.RUSTUP_HOME??=join(account,'.rustup');
  let context:GateEnvironmentContext|undefined;
  if(source[ENVIRONMENT_CONTEXT]){
    context=JSON.parse(source[ENVIRONMENT_CONTEXT]) as GateEnvironmentContext;
    if(context.report?.version!==1||!context.owned)throw Error('invalid test environment handoff');
    assertRunTemporary(context.temporary,account);
  }
  const base=context?.temporary.path??join(account,'.cache/nts/tests');
  mkdirSync(base,{recursive:true});
  const root=mkdtempSync(join(base,'environment-'));
  roots.add(root);
  for(const name of ['home','config','cache','data','state'])mkdirSync(join(root,name),{recursive:true});
  Object.assign(env,{HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_CACHE_HOME:join(root,'cache'),
    XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'state'),
    GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',
    GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@invalid'});
  const grants:NodeJS.ProcessEnv=contentCacheEnvironment();
  if(context)for(const name of CONTENT_CACHE_ENVIRONMENT)if(context.owned[name]!==undefined)grants[name]=context.owned[name];
  for(const name of HANDOFF){
    const value=context?context.owned[name]:source[name];
    if(value!==undefined)grants[name]=value;
  }
  // Runtime identities can change after the canonical context was created.
  // They are authority only inside that context; an arbitrary shell cannot
  // supply them. ownMemoryEnv removes these when it creates an independent job.
  if(context)for(const name of RUN_HANDOFF)if(source[name]!==undefined)grants[name]=source[name];
  // An owned resource capability is forwarded as one complete packet.
  if(source[HOST_OBSERVATIONS])for(const name of HOST_OBSERVATION_ENVIRONMENT)if(source[name]!==undefined)grants[name]=source[name];
  Object.assign(env,grants);
  if(context){
    context={...context,owned:Object.fromEntries(Object.entries(grants).filter((entry):entry is [string,string]=>entry[1]!==undefined)),
      report:{...context.report,host:{...context.report.host},ambient:{...context.report.ambient}}};
    env[ENVIRONMENT_CONTEXT]=JSON.stringify(context);env.TMPDIR=context.temporary.path;
  }
  ownTemporary(root,env);
  env.NTS_GATE_RUN_DIR=root;
  assignTestValues(env,owned);
  if(owned.PATH===undefined)env.PATH=[...toolchainDirectories(process.execPath,env),...(env.PATH?[env.PATH]:[])].join(delimiter);
  if(context){
    const next=JSON.parse(env[ENVIRONMENT_CONTEXT]!) as GateEnvironmentContext;
    for(const name of HOST_CAPABILITIES)next.report.host[name]=env[name]??null;
    for(const name of Object.keys(next.report.ambient))next.report.ambient[name]=env[name]??null;
    env[ENVIRONMENT_CONTEXT]=JSON.stringify(next);
  }
  return env;
}

/** Private mutable state belongs to one fixture, reused by its children. */
export function fixtureEnvironment(fixture:Fixture,owned:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{
  let base=fixtures.get(fixture);
  if(!base){
    base=testEnvironment();fixtures.set(fixture,base);
    const root=dirname(base.HOME!);
    fixture.after(()=>{if(existsSync(root)){removable(root);rmSync(root,{recursive:true,force:true});}roots.delete(root);});
  }
  const env={...base};assignTestValues(env,owned);return env;
}

/** Fixture overrides and revocations reach both the process and the canonical
 * handoff, so a later gateEnvironment cannot revive an ended reservation. */
export function assignTestValues(env:NodeJS.ProcessEnv,owned:NodeJS.ProcessEnv):void {
  Object.assign(env,owned);
  if(!env[ENVIRONMENT_CONTEXT])return;
  const context=JSON.parse(env[ENVIRONMENT_CONTEXT]) as GateEnvironmentContext;
  for(const [name,value] of Object.entries(owned)){
    if(value===undefined)delete context.owned[name];
    else if(!HOST.has(name)||name==='NTS_ORACLE_TYPESCRIPT'||name==='NTS_ORACLE_DEPENDENCIES')context.owned[name]=value;
  }
  env[ENVIRONMENT_CONTEXT]=JSON.stringify(context);
}

/** A generated shim delegates inside an already owned fixture. Its named
 * descriptors and protocol fields are declared at the call site. The emitted
 * expression works in both CommonJS and ESM without loading another runtime. */
export function testEnvironmentHandoff(names:readonly string[]=[]):string {
  const allowed=[...new Set([...HOST_CAPABILITIES,...Object.keys(FIXED_AMBIENT),...WRITABLE,...HANDOFF,
    ...HOST_OBSERVATION_ENVIRONMENT,...CONTENT_CACHE_ENVIRONMENT,ENVIRONMENT_CONTEXT,'NTS_GATE_RUN_DIR',...names])];
  return `Object.fromEntries(${JSON.stringify(allowed)}.filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]))`;
}

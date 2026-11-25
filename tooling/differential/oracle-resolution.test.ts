import {nodeProcessAlive,nodeProcessBirth} from './oracle-runtime.ts';
import {readProcessStat,type StatReader} from './process-stat/main.ts';
import {testEnvironmentHandoff,fixtureEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {copyFileSync,chmodSync,constants,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test,type TestContext} from 'node:test';
import {waitFor} from '../gate/test-wait.ts';
import {durableRecord} from '../gate/durable-record.ts';
import {startNodeResolutionSession,queryNodeResolutions,checkNodeResolutionSession,closeNodeResolutionSession,nodeResolutionOptions,type NodeResolutionSession} from './oracle-resolution.ts';

const here=dirname(fileURLToPath(import.meta.url));
function fixture(t:TestContext){const root=mkdtempSync(join(tmpdir(),'nts-resolution-service-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
/** Only absence proves the holder gone; any other read failure is the failure itself. */
function holderGone(pid:number,read?:StatReader):boolean {
  return readProcessStat(pid,read,(_pid,error)=>{throw error.cause??error;})===undefined;
}
async function close(session:NodeResolutionSession){
  await closeNodeResolutionSession(session);
  await waitFor('the oracle Node resolution holder to exit',()=>holderGone(session.holder.pid));
}
test('a heap bound resolves nothing, so a nested child without the oracle child\'s heap flags keeps its resolution identity',()=>{
  const env={NODE_OPTIONS:'--max-old-space-size=8192'};
  const oracle=nodeResolutionOptions(['--enable-source-maps','--max-old-space-size=1024','--max-semi-space-size=16','--preserve-symlinks'],env);
  assert.deepEqual(oracle,{flags:['--preserve-symlinks'],nodeOptions:'--max-old-space-size=8192'});
  assert.deepEqual(nodeResolutionOptions(['--preserve-symlinks'],env),oracle,'a child the program starts itself');
  assert.deepEqual(nodeResolutionOptions(['--max_semi_space_size','64','--max-heap-size=512','--preserve-symlinks'],env),oracle);
  // The control differs in one thing: a resolver flag, which still changes the identity.
  assert.notDeepEqual(nodeResolutionOptions(['--preserve-symlinks-main'],env),oracle);
});
test('holder disappearance keeps a live stat provisional',()=>assert.equal(holderGone(process.pid),false));
for(const code of ['ENOENT','ESRCH'])test('holder disappearance recognizes '+code,()=>{
  const error=Object.assign(new Error('controlled process disappearance'),{code});
  assert.equal(holderGone(2**22+1,()=>{throw error;}),true);
});
test('holder disappearance propagates other read failures',()=>{
  for(const error of [Object.assign(new Error('denied'),{code:'EACCES'}),Object.assign(new Error('read failed'),{code:'EIO'}),new Error('uncategorized read')])
    assert.throws(()=>holderGone(2**22+1,()=>{throw error;}),observed=>observed===error);
});
test('resolution sessions report the actual launch and isolate canonical conditions from an ambient launcher',t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const root=fixture(t),packageRoot=join(root,'node_modules/conditional');mkdirSync(packageRoot,{recursive:true});
  writeFileSync(join(root,'entry.mjs'),'');
  writeFileSync(join(packageRoot,'package.json'),JSON.stringify({type:'module',exports:{poison:'./poison.mjs',default:'./default.mjs'}}));
  for(const name of ['poison','default'])writeFileSync(join(packageRoot,name+'.mjs'),'throw Error("resolution must not evaluate the subject");');
  const planned=fixtureEnvironment(t,{NODE_OPTIONS:undefined}),poison=fixtureEnvironment(t,{NODE_OPTIONS:'--conditions=poison'});
  const source=`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
    import {registerCommandCloser} from ${JSON.stringify(new URL('./command-entry/main.ts',import.meta.url).href)};
    import {nodeProcessAlive} from ${JSON.stringify(new URL('./oracle-runtime.ts',import.meta.url).href)};
    import {startNodeResolutionSession,queryNodeResolutions,closeNodeResolutionSession} from ${JSON.stringify(new URL('./oracle-resolution.ts',import.meta.url).href)};
    const request=JSON.parse(readFileSync(0,'utf8'));assert.equal(process.env.NODE_OPTIONS,'--conditions=poison');
    let holder,session,closed;
    registerCommandCloser('conditional resolution fixture',{close:async()=>{
      if(!session)return;await closeNodeResolutionSession(session);await closed;
      assert.equal(nodeProcessAlive(session.holder),false);console.log(JSON.stringify({drained:true}));
    }});
    try{
      session=await startNodeResolutionSession(request.directory,request.options,request.env,process.pid,(_session,completion)=>{closed=completion;},{ready:async waiting=>holder=await waiting});
      assert.notEqual(request.expected,null,'an actual/intended option mismatch must refuse');
      const response=await queryNodeResolutions(session,[{specifier:'conditional',parentURL:request.parentURL,mode:'esm',conditions:[],importAttributes:{}}]);
      assert.equal(response.answers[0].ok,true);assert.equal(response.answers[0].result.url,request.expected);
      assert.deepEqual(session.options,request.options);console.log(JSON.stringify({url:response.answers[0].result.url,options:session.options}));
    }catch(error){
      if(request.expected!==null)throw error;
      assert.match(String(error),/oracle resolution options identity changed/);assert.ok(holder);assert.equal(nodeProcessAlive(holder.holder),false);
      console.log(JSON.stringify({refused:true,drained:true,actual:holder.options}));
    }
  `;
  for(const [label,env,options,expected]of [
    ['canonical',planned,nodeResolutionOptions([],planned),pathToFileURL(join(packageRoot,'default.mjs')).href],
    ['planned-poison',poison,nodeResolutionOptions([],poison),pathToFileURL(join(packageRoot,'poison.mjs')).href],
    ['mismatch',poison,nodeResolutionOptions([],planned),null],
  ] as const){
    const result=spawnSync(process.execPath,['--input-type=module','-e',source],{env:poison,encoding:'utf8',input:JSON.stringify({directory:join(root,label),env,options,expected,parentURL:pathToFileURL(join(root,'entry.mjs')).href})});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const reports=result.stdout.trim().split('\n').map(line=>JSON.parse(line)),value=reports[0];
    if(expected===null){assert.equal(value.refused,true);assert.equal(value.drained,true);}else{assert.equal(value.url,expected);assert.deepEqual(reports[1],{drained:true});}
  }
});
test('one executable holder batches Node answers without evaluating subjects',async t=>{
  if(process.platform!=='linux'){t.skip('the inode-bound fast path is Linux-specific; other platforms retain bounded live resolution');return;}
  const root=fixture(t),directory=join(root,'service');
  writeFileSync(join(root,'entry.mjs'),'');writeFileSync(join(root,'value.mjs'),'throw new Error("probe evaluated a subject");\n');
  writeFileSync(join(root,'value.cjs'),'throw new Error("probe evaluated CommonJS");\n');
  mkdirSync(join(root,'node_modules/tiny'),{recursive:true});
  writeFileSync(join(root,'node_modules/tiny/package.json'),'{"type":"module","exports":"./value.mjs"}');
  writeFileSync(join(root,'node_modules/tiny/value.mjs'),'throw new Error("probe evaluated a package");\n');
  const options=nodeResolutionOptions([]),sessions=await Promise.all([startNodeResolutionSession(directory,options,process.env),startNodeResolutionSession(directory,options,process.env)]),session=sessions[0]!;assert.deepEqual(sessions[1],session);
  try{
    assert.equal(statSync(directory).mode&0o077,0,'the holder token directory is private');
    const parentURL=pathToFileURL(join(root,'entry.mjs')).href;
    const queries=['./value.mjs','tiny','./missing.mjs'].map(specifier=>({specifier,parentURL,mode:'esm' as const,conditions:['node','import','module-sync','node-addons'],importAttributes:{}}));
    const first=await queryNodeResolutions(session,queries);
    assert.equal(first.answers.length,3);assert.ok(first.answers[0]!.ok&&first.answers[1]!.ok&&!first.answers[2]!.ok);
    if(first.answers[0]!.ok)assert.deepEqual(first.answers[0]!.result,{url:pathToFileURL(join(root,'value.mjs')).href,format:'module'});
    if(first.answers[1]!.ok)assert.equal(first.answers[1]!.result.url,pathToFileURL(join(root,'node_modules/tiny/value.mjs')).href);
    if(!first.answers[2]!.ok)assert.equal(first.answers[2]!.error.code,'ERR_MODULE_NOT_FOUND');
    const again=(await startNodeResolutionSession(directory,options,process.env))!;assert.deepEqual(again,session,'one holder is shared by later parent batches');
    const second=await queryNodeResolutions(again,[{specifier:'./value.cjs',parentURL,mode:'cjs',conditions:['node','require','module-sync','node-addons'],importAttributes:{}}]);
    assert.equal(second.answers.length,1);assert.ok(second.answers[0]!.ok);
    if(second.answers[0]!.ok)assert.equal(second.answers[0]!.result.url,pathToFileURL(join(root,'value.cjs')).href);
    assert.equal(second.cost.queries,4);assert.equal(second.cost.probeModuleLoads,1);assert.ok(second.cost.totalCpuUsec>=first.cost.totalCpuUsec);
    assert.throws(()=>checkNodeResolutionSession(session,{...options,flags:['--preserve-symlinks']}),/oracle resolution options identity changed/);
  }finally{await close(session);}
});
test('a run holder survives the completed preparation helper process group',async t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const root=fixture(t),moduleURL=pathToFileURL(join(here,'oracle-resolution.ts')).href;
  const source=`import {startNodeResolutionSession,nodeResolutionOptions} from ${JSON.stringify(moduleURL)};const value=await startNodeResolutionSession(${JSON.stringify(join(root,'service'))},nodeResolutionOptions([],process.env),process.env,${process.pid});console.log(JSON.stringify(value));`;
  // The fixture wrapper owns and drains its command pipes. The test parent
  // owns no asynchronous program pipes while waiting for that wrapper.
  const activeURL=pathToFileURL(join(here,'../gate/active-command.ts')).href;
  const wrapper=`import {activeCommand} from ${JSON.stringify(activeURL)};const run=await activeCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(source)}],{cwd:${JSON.stringify(root)},env:${testEnvironmentHandoff()},cpuBudgetSeconds:30,idleMs:30000,maxBuffer:2**20});if(run.status!==0)throw Error(run.stderr);console.log(run.stdout);`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',wrapper],{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const session=JSON.parse(run.stdout) as NodeResolutionSession;
  try{checkNodeResolutionSession(session,session.options);const result=await queryNodeResolutions(session,[{specifier:'node:fs',parentURL:import.meta.url,mode:'esm',conditions:session.conditions.esm,importAttributes:{}}]);assert.ok(result.answers[0]!.ok);}
  finally{if(Reflect.get(session,'holder')){try{await close(session);}catch(error){if(!String(error).includes('ENOENT')&&!String(error).includes('ECONNREFUSED'))throw error;}}}
});
test('a holder exiting early cannot authenticate another child',async t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const session=(await startNodeResolutionSession(join(fixture(t),'service'),nodeResolutionOptions([],process.env),process.env))!;
  checkNodeResolutionSession(session,session.options);await close(session);
  assert.throws(()=>checkNodeResolutionSession(session,session.options),/oracle Node executable holder changed/);
});
test('an async resolution batch leaves the parent free to drain a child pipe',async t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const root=fixture(t),entry=join(root,'entry.mjs'),target=join(root,'value.mjs');
  writeFileSync(entry,'');writeFileSync(target,'throw new Error("must not evaluate");\n');
  const session=(await startNodeResolutionSession(join(root,'service'),nodeResolutionOptions([],process.env),process.env))!;
  try{
    const child=spawn(process.execPath,['-e',"process.stdout.end('x'.repeat(4*2**20))"],{env:fixtureEnvironment(t),stdio:['ignore','pipe','pipe']});
    let bytes=0,errors='';child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;});child.stderr.on('data',(chunk:Buffer)=>{errors+=chunk.toString('utf8');});
    const drained=new Promise<void>((done,fail)=>{child.once('error',fail);child.once('close',status=>{try{assert.equal(status,0,errors);done();}catch(error){fail(error);}});});
    const query={specifier:'./value.mjs',parentURL:pathToFileURL(entry).href,mode:'esm' as const,conditions:['node','import','module-sync','node-addons'],importAttributes:{}};
    const pending=queryNodeResolutions(session,Array.from({length:1000},()=>query));
    assert.equal(typeof pending.then,'function','pipe-owning parents use the async channel');
    const [response]=await Promise.all([pending,drained]);
    assert.equal(response.cost.queries,1000);assert.equal(response.cost.probeModuleLoads,1,'unique requests reuse one empty probe module');
    assert.equal(response.answers.length,1000);assert.ok(response.answers.every(answer=>answer.ok&&answer.result.url===pathToFileURL(target).href));
    assert.equal(bytes,4*2**20,'the independent child output is completely drained');
  }finally{await close(session);}
});
test('replacing a held executable by rename gives the child a different identity',async t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const root=fixture(t),binary=join(root,'node'),record=join(root,'session.json'),moduleURL=pathToFileURL(join(here,'oracle-resolution.ts')).href;
  copyFileSync(process.execPath,binary,constants.COPYFILE_FICLONE);chmodSync(binary,0o755);
  const start=`import {durableRecord} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};import {startNodeResolutionSession,nodeResolutionOptions} from ${JSON.stringify(moduleURL)};const session=await startNodeResolutionSession(${JSON.stringify(join(root,'service'))},nodeResolutionOptions([],process.env),process.env,process.ppid);durableRecord(${JSON.stringify(record)},session);`;
  const initial=spawnSync(binary,['--input-type=module','-e',start],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(initial.status,0,initial.stderr);
  const session=JSON.parse(readFileSync(record,'utf8')) as NodeResolutionSession;
  const check=`import {readFileSync} from 'node:fs';import {checkNodeResolutionSession} from ${JSON.stringify(moduleURL)};const session=JSON.parse(readFileSync(${JSON.stringify(record)},'utf8'));try{checkNodeResolutionSession(session,session.options);console.log('healthy');}catch(error){console.log(error.message);process.exitCode=1;}`;
  try{
    const control=spawnSync(binary,['--input-type=module','-e',check],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(control.status,0,control.stderr);assert.equal(control.stdout,'healthy\n');
    assert.throws(()=>{const fd=openSync(binary,'r+');closeSync(fd);},(error:unknown)=>(error as NodeJS.ErrnoException).code==='ETXTBSY','the executing holder prevents changing its inode bytes');
    renameSync(binary,binary+'.held');copyFileSync(process.execPath,binary,constants.COPYFILE_FICLONE);chmodSync(binary,0o755);
    const changed=spawnSync(binary,['--input-type=module','-e',check],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(changed.status,1,changed.stderr);assert.match(changed.stdout,/oracle Node executable holder changed/);
  }finally{await close(session);}
});


for(const failure of ['readiness','invalid-session'] as const)test('failed '+failure+' drains its newly spawned resolution helper before output removal',async t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const root=fixture(t),directory=join(root,'service');
  let holder:NodeResolutionSession|undefined,published=false;
  await assert.rejects(startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env,process.pid,()=>{published=true;},{ready:async waiting=>{
    holder=await waiting;
    assert.equal(nodeProcessAlive(holder.holder),true,'the actual acquired helper is live before the failure');
    if(failure==='readiness')throw Error('supplied resolution readiness failure');
    const invalid={...holder,helperSha256:'0'.repeat(64)};
    writeFileSync(join(directory,'holder.json'),JSON.stringify(invalid));return invalid;
  }}),failure==='readiness'?/supplied resolution readiness failure/:/oracle Node resolution service identity changed/);
  assert.ok(holder);assert.equal(published,false,'an invalid acquisition never publishes successful ownership');
  assert.equal(nodeProcessAlive(holder.holder),false,'the owned child has closed before acquisition rejects');
  rmSync(directory,{recursive:true});
  assert.equal(nodeProcessAlive(holder.holder),false,'no helper can read or publish into removed output');
});


test('a resolution watcher-construction failure keeps its original error through acquisition cleanup',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  const directory=join(fixture(t),'service'),expected=Error('supplied resolution watcher construction failure');
  let watched=false,published=false;
  await assert.rejects(startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env,process.pid,()=>{published=true;},{watch:(actual)=>{
    assert.equal(actual,directory);watched=true;throw expected;
  }}),error=>error===expected,'the uninitialized cancellation path must not replace the watcher error');
  assert.equal(watched,true);assert.equal(published,false);
  rmSync(directory,{recursive:true});
});

test('completed holder metadata is terminal and cannot be acquired as a live session',async t=>{
 if(process.platform!=='linux'){t.skip('Linux holder identity');return;}
 const directory=join(fixture(t),'terminal'),options=nodeResolutionOptions([],process.env);
 let completion:Promise<void>|undefined;
 const session=await startNodeResolutionSession(directory,options,process.env,process.pid,(_value,closed)=>{completion=closed;});
 assert.ok(session);assert.ok(completion);
 await closeNodeResolutionSession(session);await completion;
 const before=readFileSync(join(directory,'holder.json'));
 await assert.rejects(startNodeResolutionSession(directory,options,process.env),/oracle Node executable holder changed/);
 assert.deepEqual(readFileSync(join(directory,'holder.json')),before,'terminal metadata is neither deleted nor rewritten');
});

// Readiness is an event, never a wall bound: a loaded machine may bring a
// holder up after any delay. The mocked clock passes far beyond any deadline
// while the starter waits; only holder.json, or a named exit, ends the wait.
/** Holder flags preloading a gate that keeps the holder unready until the
 * test releases it: no holder.json can precede the release. */
function gatedHolder(root:string){
  const gate=join(root,'gate.mjs'),release=join(root,'release');
  writeFileSync(gate,`import {existsSync,watch} from 'node:fs';
if(!existsSync(${JSON.stringify(release)}))await new Promise(done=>{const watcher=watch(${JSON.stringify(root)},()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();done();}});if(existsSync(${JSON.stringify(release)})){watcher.close();done();}});
`);
  return {options:nodeResolutionOptions(['--import',pathToFileURL(gate).href],process.env),release:()=>writeFileSync(release,'')};
}
test('a starter waits for its holder however long the clock runs before it is ready',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  // The holder stays unready until the test, having run the clock, releases it.
  const root=fixture(t),directory=join(root,'service'),gated=gatedHolder(root);
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let advanced=false;
  const session=(await startNodeResolutionSession(directory,gated.options,process.env,process.pid,undefined,{ready:async waiting=>{
    assert.equal(existsSync(join(directory,'holder.json')),false,'the gated holder is unready while the clock runs');
    t.mock.timers.tick(3_600_000);advanced=true;
    gated.release();
    return await waiting;
  }}))!;
  t.mock.timers.reset();
  assert.equal(advanced,true);
  try{checkNodeResolutionSession(session,session.options);}finally{await close(session);}
});

const settled=(pending:Promise<unknown>)=>Promise.race([pending.then(()=>'resolved',()=>'rejected'),new Promise(done=>setImmediate(()=>done('pending')))]);
/** A real live session whose readiness record is withdrawn, so a later caller waits on the claim. */
async function withdrawn(t:TestContext){
  // The session closes before its directory is removed.
  const root=mkdtempSync(join(tmpdir(),'nts-resolution-service-')),directory=join(root,'service');
  let session:NodeResolutionSession|undefined;
  t.after(async()=>{
    try{if(session){if(existsSync(join(directory,'holder.saved')))renameSync(join(directory,'holder.saved'),join(directory,'holder.json'));await close(session);}}
    finally{rmSync(root,{recursive:true,force:true});}
  });
  session=(await startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env))!;
  renameSync(join(directory,'holder.json'),join(directory,'holder.saved'));
  return {directory,session,claim:join(directory,'starting.json'),restore:()=>renameSync(join(directory,'holder.saved'),join(directory,'holder.json'))};
}
const dead={pid:process.pid,birth:'not this process birth'};

test('a waiter whose claim names a dead starter and no holder fails by name at once',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  const {directory,claim}=await withdrawn(t);
  durableRecord(claim,{version:1,starter:dead});
  await assert.rejects(startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env),
    /oracle Node resolution service did not start: its starter \d+, which recorded no holder, exited before .*holder\.json was published/);
});

test('a waiter whose live starter recorded no holder yet resolves once holder.json appears',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  const {directory,session,claim,restore}=await withdrawn(t);
  durableRecord(claim,{version:1,starter:{pid:process.pid,birth:nodeProcessBirth(process.pid)}});
  const pending=startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env);
  assert.equal(await settled(pending),'pending','with no holder recorded, the live starter keeps the waiter waiting');
  restore();
  assert.deepEqual(await pending,session);
});

test('a waiter whose starter died after spawning a live holder keeps waiting for that holder',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  const {directory,session,claim,restore}=await withdrawn(t);
  durableRecord(claim,{version:1,starter:dead,holder:session.holder});
  const pending=startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env);
  assert.equal(await settled(pending),'pending','the recorded holder lives, so its readiness may still come');
  restore();
  assert.deepEqual(await pending,session);
});

test('a waiter whose recorded holder is dead fails by name at once, however long its starter lives',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  // Only a recorded holder can publish holder.json: a starter never respawns one.
  const {directory,claim}=await withdrawn(t);
  durableRecord(claim,{version:1,starter:{pid:process.pid,birth:nodeProcessBirth(process.pid)},holder:dead});
  await assert.rejects(startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env),
    /oracle Node resolution service did not start: its holder \d+ exited before .*holder\.json was published/);
});

test('a starter that gives up leaves a terminal claim, and a later waiter fails at once with its error',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  // Its holder never becomes ready, so no holder.json outlives the starter's stop.
  const root=fixture(t),directory=join(root,'service'),{options}=gatedHolder(root);
  await assert.rejects(startNodeResolutionSession(directory,options,process.env,process.pid,undefined,{ready:async()=>{throw Error('readiness refused');}}),/readiness refused/);
  assert.equal(existsSync(join(directory,'holder.json')),false);
  const claim=JSON.parse(readFileSync(join(directory,'starting.json'),'utf8'));
  assert.equal(claim.starter.pid,process.pid);assert.equal(nodeProcessAlive(claim.starter),true,'the starter lives on after giving up');
  assert.deepEqual(claim.failed,{message:'Error: readiness refused'});
  assert.ok(claim.holder,'its stopped holder stays recorded');
  await assert.rejects(startNodeResolutionSession(directory,options,process.env),
    /oracle Node resolution service did not start: its starter \d+ gave up: Error: readiness refused/);
});

test('a waiter already waiting fails by name once its starter exits',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  const {directory,claim}=await withdrawn(t);
  // A live claimant in this test's own unit, which lives until it is killed.
  const claimant=spawn(process.execPath,['-e','process.stdin.resume()'],{stdio:['pipe','ignore','ignore']});
  const exited=new Promise(done=>claimant.once('exit',done));
  t.after(async()=>{if(claimant.exitCode===null&&claimant.signalCode===null)claimant.kill('SIGKILL');await exited;});
  await new Promise((done,fail)=>{claimant.once('spawn',done);claimant.once('error',fail);});
  durableRecord(claim,{version:1,starter:{pid:claimant.pid!,birth:nodeProcessBirth(claimant.pid!)}});
  const pending=startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env);
  assert.equal(await settled(pending),'pending','the live starter keeps the waiter waiting');
  claimant.kill('SIGKILL');await exited;
  await assert.rejects(pending,/oracle Node resolution service did not start: its starter \d+, which recorded no holder, exited before .*holder\.json was published/);
});

test('a half-written claim refuses by name, never reads as a dead starter',async t=>{
  if(process.platform!=='linux'){t.skip('Linux resolution helper acquisition');return;}
  const {directory,claim}=await withdrawn(t);
  writeFileSync(claim,'{"version":1,"starter":{"pid":');
  await assert.rejects(startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env),/oracle Node resolution claim .*starting\.json is unreadable or incomplete/);
  writeFileSync(claim,JSON.stringify({pid:process.pid})+'\n');
  await assert.rejects(startNodeResolutionSession(directory,nodeResolutionOptions([],process.env),process.env),/oracle Node resolution claim .*starting\.json is not a claim this reader knows/);
});

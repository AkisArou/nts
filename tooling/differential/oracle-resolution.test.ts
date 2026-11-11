import {testEnvironmentHandoff,fixtureEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {copyFileSync,chmodSync,constants,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test,type TestContext} from 'node:test';
import {waitFor} from '../gate/test-wait.ts';
import {startNodeResolutionSession,queryNodeResolutions,checkNodeResolutionSession,closeNodeResolutionSession,nodeResolutionOptions,type NodeResolutionSession} from './oracle-resolution.ts';

const here=dirname(fileURLToPath(import.meta.url));
function fixture(t:TestContext){const root=mkdtempSync(join(tmpdir(),'nts-resolution-service-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function holderGone(read:()=>unknown):boolean {
  try{read();return false;}
  catch(error){if(['ENOENT','ESRCH'].includes((error as NodeJS.ErrnoException).code??''))return true;throw error;}
}
async function close(session:NodeResolutionSession){
  await closeNodeResolutionSession(session);
  await waitFor('the oracle Node resolution holder to exit',()=>holderGone(()=>readFileSync('/proc/'+session.holder.pid+'/stat')));
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
test('holder disappearance keeps a live stat provisional',()=>assert.equal(holderGone(()=>Buffer.from('live stat')),false));
for(const code of ['ENOENT','ESRCH'])test('holder disappearance recognizes '+code,()=>{
  const error=Object.assign(new Error('controlled process disappearance'),{code});
  assert.equal(holderGone(()=>{throw error;}),true);
});
test('holder disappearance propagates other read failures',()=>{
  for(const error of [Object.assign(new Error('denied'),{code:'EACCES'}),Object.assign(new Error('read failed'),{code:'EIO'}),new Error('uncategorized read')])
    assert.throws(()=>holderGone(()=>{throw error;}),observed=>observed===error);
});
test('one executable holder batches Node answers without evaluating subjects',async t=>{
  if(process.platform!=='linux'){t.skip('the inode-bound fast path is Linux-specific; other platforms retain bounded live resolution');return;}
  const root=fixture(t),directory=join(root,'service');
  writeFileSync(join(root,'entry.mjs'),'');writeFileSync(join(root,'value.mjs'),'throw new Error("probe evaluated a subject");\n');
  writeFileSync(join(root,'value.cjs'),'throw new Error("probe evaluated CommonJS");\n');
  mkdirSync(join(root,'node_modules/tiny'),{recursive:true});
  writeFileSync(join(root,'node_modules/tiny/package.json'),'{"type":"module","exports":"./value.mjs"}');
  writeFileSync(join(root,'node_modules/tiny/value.mjs'),'throw new Error("probe evaluated a package");\n');
  const options=nodeResolutionOptions([]),sessions=await Promise.all([startNodeResolutionSession(directory,options),startNodeResolutionSession(directory,options)]),session=sessions[0]!;assert.deepEqual(sessions[1],session);
  try{
    assert.equal(statSync(directory).mode&0o077,0,'the holder token directory is private');
    const parentURL=pathToFileURL(join(root,'entry.mjs')).href;
    const queries=['./value.mjs','tiny','./missing.mjs'].map(specifier=>({specifier,parentURL,mode:'esm' as const,conditions:['node','import','module-sync','node-addons'],importAttributes:{}}));
    const first=await queryNodeResolutions(session,queries);
    assert.equal(first.answers.length,3);assert.ok(first.answers[0]!.ok&&first.answers[1]!.ok&&!first.answers[2]!.ok);
    if(first.answers[0]!.ok)assert.deepEqual(first.answers[0]!.result,{url:pathToFileURL(join(root,'value.mjs')).href,format:'module'});
    if(first.answers[1]!.ok)assert.equal(first.answers[1]!.result.url,pathToFileURL(join(root,'node_modules/tiny/value.mjs')).href);
    if(!first.answers[2]!.ok)assert.equal(first.answers[2]!.error.code,'ERR_MODULE_NOT_FOUND');
    const again=(await startNodeResolutionSession(directory,options))!;assert.deepEqual(again,session,'one holder is shared by later parent batches');
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
  const source=`import {startNodeResolutionSession,nodeResolutionOptions} from ${JSON.stringify(moduleURL)};const value=await startNodeResolutionSession(${JSON.stringify(join(root,'service'))},nodeResolutionOptions([]),${process.pid});console.log(JSON.stringify(value));`;
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
  const session=(await startNodeResolutionSession(join(fixture(t),'service'),nodeResolutionOptions([])))!;
  checkNodeResolutionSession(session,session.options);await close(session);
  assert.throws(()=>checkNodeResolutionSession(session,session.options),/oracle Node executable holder changed/);
});
test('an async resolution batch leaves the parent free to drain a child pipe',async t=>{
  if(process.platform!=='linux'){t.skip('Linux executable lifetime binding');return;}
  const root=fixture(t),entry=join(root,'entry.mjs'),target=join(root,'value.mjs');
  writeFileSync(entry,'');writeFileSync(target,'throw new Error("must not evaluate");\n');
  const session=(await startNodeResolutionSession(join(root,'service'),nodeResolutionOptions([])))!;
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
  const start=`import {writeFileSync} from 'node:fs';import {startNodeResolutionSession,nodeResolutionOptions} from ${JSON.stringify(moduleURL)};const session=await startNodeResolutionSession(${JSON.stringify(join(root,'service'))},nodeResolutionOptions([]),process.ppid);writeFileSync(${JSON.stringify(record)},JSON.stringify(session));`;
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

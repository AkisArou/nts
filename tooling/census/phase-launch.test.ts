import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {spawnTest} from '../gate/test-wait.ts';

test('cold JVM preparation hands javac, jar and java to the supplied command observer',t=>{
  const root=testScratch(t,'phase-jvm-preparation'),out=join(root,'out');mkdirSync(out);
  writeFileSync(join(out,'nts-runtime.jar'),'private jar bytes');
  const source=`import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {archiveFor,jvmRun} from ${JSON.stringify(new URL('../jvm/launch.ts',import.meta.url).href)};
const calls=[];
const run=(command,args,options)=>{
  calls.push({command,args,options});
  if(command==='java')writeFileSync(args.find(arg=>arg.startsWith('-XX:ArchiveClassesAtExit=')).split('=').slice(1).join('='),'private archive');
};
const directory=archiveFor(${JSON.stringify(join(out,'nts-runtime.jar'))},run);
assert.ok(directory);assert.deepEqual(calls.map(call=>call.command),['javac','jar','java']);
assert.ok(calls.every(call=>JSON.stringify(call.options.stdio)===JSON.stringify(['ignore','ignore','pipe'])));
const launch=jvmRun(${JSON.stringify(out)},run);assert.equal(launch[0],'java');assert.equal(calls.length,3,'a cache hit starts no hidden child');
process.stdout.write('observed');`;
  const result=spawnTest(process.execPath,['--input-type=module','-e',source],{env:fixtureEnvironment(t,{NTS_JVM_CDS_DIR:join(root,'cds')}),encoding:'utf8'},'observed JVM preparation');
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'observed');
});

test('the first native dependency plan hands its child to the supplied observer',t=>{
  const root=testScratch(t,'phase-native-dependencies');
  const source=`import assert from 'node:assert/strict';
import {bundledDependencies} from ${JSON.stringify(new URL('../conformance/node-deps.mjs',import.meta.url).href)};
let calls=0;
const run=(command,args,options)=>{
  calls++;assert.ok(command.endsWith('/private-compiler'));assert.equal(args[0],'node-deps');assert.equal(options.encoding,'utf8');
  return {status:0,stdout:JSON.stringify({include_flags:['-I/private'],link_flags:['-lprivate']}),stderr:''};
};
const a=bundledDependencies(${JSON.stringify(join(root,'private-compiler'))},['uv'],['clang'],run);
const b=bundledDependencies(${JSON.stringify(join(root,'private-compiler'))},['uv'],['clang'],run);
assert.deepEqual(a,b);assert.equal(calls,1,'an in-process plan hit starts no hidden child');process.stdout.write('observed');`;
  const result=spawnTest(process.execPath,['--input-type=module','-e',source],{env:fixtureEnvironment(t,{NTS_NODE_DEPS_CACHE:join(root,'deps')}),encoding:'utf8'},'observed native dependency plan');
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'observed');
});

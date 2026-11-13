import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {SourceFacts} from './source-facts.ts';
import {COMMAND_SIGNAL_OWNER,inspectCommandSignals} from './command-signals.ts';

const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
function inspect(source:string,file='tooling/gate/subject.ts'){
  const api=new API(),lease=api.createSourceFile(file,source);
  try{return inspectCommandSignals(new SourceFacts(file,source,lease.sourceFile));}
  finally{lease.dispose();api.close();}
}

test('only the command entry may install process signals, including dynamic events',()=>{
  for(const method of ['on','once','addListener','prependListener','prependOnceListener']){
    const source=`process.${method}('SIGTERM',()=>{});`;
    assert.match(inspect(source)[0]!,/process signal SIGTERM must be owned by/);
    assert.deepEqual(inspect(source,COMMAND_SIGNAL_OWNER),[]);
  }
  assert.match(inspect('process.on(event,handler);')[0]!,/process signal <dynamic>/);
  assert.match(inspect('process[method](event,handler);')[0]!,/process signal <dynamic>/);
});

test('process and events aliases, imports, globals and detached methods keep ownership',()=>{
  for(const source of [
    `import proc from 'node:process';proc.once('SIGINT',()=>{});`,
    `import * as proc from 'node:process';proc['on']('SIGHUP',()=>{});`,
    `import {on as listen} from 'node:process';listen('SIGTERM',()=>{});`,
    `const proc=process;const {once:listen}=proc;listen('SIGTERM',()=>{});`,
    `const proc=require('node:process');proc.on('SIGTERM',()=>{});`,
    `globalThis.process.on('SIGTERM',()=>{});global.process.once('SIGINT',()=>{});`,
    `import {once as listen} from 'node:events';listen(process,'SIGTERM');`,
    `const events=require('node:events');events.on(process,'SIGHUP');`,
    `const listen=process.once;listen.call(process,'SIGTERM',()=>{});`,
    `process.on.apply(process,['SIGTERM',()=>{}]);`,
    `process.on.apply(process,unknownArguments);`,
    `const listen=process.on.bind(process);listen('SIGTERM',()=>{});`,
    `const listen=process.on.bind(process,'SIGTERM');listen(()=>{});`,
    `const first=process.on.bind(process);const second=first.bind(process);second.apply(null,['SIGTERM',()=>{}]);`,
    `import {once} from 'node:events';const listen=once.bind(null,process);listen('SIGTERM');`,
  ])assert.ok(inspect(source).length,source);
});

test('non-signal observations, lexical shadows and fixture source strings are not shutdown owners',()=>{
  assert.deepEqual(inspect(`
process.on('exit',()=>{});process.once('beforeExit',()=>{});process.on('message',()=>{});
function local(process:unknown){process.on('SIGTERM',handler);}
function other(){const process={on(){}};process.on('SIGTERM',handler);}
function globalShadow(globalThis:unknown){globalThis.process.on('SIGTERM',handler);}
const fixture="process.on('SIGTERM',()=>process.exit(0))";
const events={once(){}};events.once(process,'SIGTERM');
const observe=process.on.bind(process,'message');observe(handler);
process.on.apply(process,['warning',handler]);
`),[]);
});

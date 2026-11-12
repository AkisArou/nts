import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {inspectRecordPublications} from './test-readiness.ts';
import {generatedJavaScript} from './generated-javascript.ts';

const writer=`import {writeFileSync as publish} from 'node:fs';publish('ready.json',JSON.stringify({ready:true}));`;
const inspect=(source:string)=>inspectRecordPublications('tooling/fixture.test.ts',source);

test('script files, inline invocations, aliases and local source helpers reach the publication check',()=>{
  for(const source of [
    `import {writeFileSync} from 'node:fs';writeFileSync('child.mjs',${JSON.stringify(writer)});`,
    `const fs=require('node:fs');const script=${JSON.stringify(writer)};fs.writeFileSync('child.mjs',script);`,
    `import {spawnSync as run} from 'node:child_process';run(node,['-e',${JSON.stringify(writer)}]);`,
    `import {spawnTest} from './test-wait.ts';const args=['--eval',${JSON.stringify(writer)}];spawnTest(node,args,{});`,
    `import * as fs from 'node:fs';function source(){return ${JSON.stringify(writer)};}fs.writeFileSync('child.mjs',source());`,
    `import {generatedJavaScript as js} from './generated-javascript.ts';export function source(){return js(${JSON.stringify(writer)});}`,
  ])assert.equal(inspect(source).length,1,source);
});

test('generated fs promises and require aliases cannot bypass the publication owner',()=>{
  for(const source of [
    `const {writeFileSync:put}=require('node:fs');put('ready.json','{}');`,
    `import fs from 'node:fs';const put=fs.writeFileSync;put(path,JSON.stringify({ok:true}));`,
    `const {writeFile:put}=await import('node:fs/promises');await put('ready.json',bytes);`,
    `import * as fs from 'node:fs';await fs.promises.writeFile('ready.json.partial',JSON.stringify({ok:true}));`,
  ])assert.equal(inspect(`import{writeFileSync}from'node:fs';writeFileSync('child.mjs',${JSON.stringify(source)});`).length,1,source);
});

test('synchronous parent setup, stream records, prose and unconsumed templates remain data',()=>{
  assert.deepEqual(inspect(`import{writeFileSync}from'node:fs';writeFileSync('ready.json',JSON.stringify({ok:true}));
const numeric=['.1','1e9'];const options=['-e','.1'];
function prose(){return \`writeFileSync('ready.json', JSON.stringify({ok:true}));\`;}
const sample=${JSON.stringify(writer)};`),[]);
  const good=`import{durableRecord}from'./durable-record.ts';durableRecord('ready.json',{ok:true});
import{appendFileSync}from'node:fs';appendFileSync('events.jsonl',JSON.stringify({event:1})+'\\n');`;
  assert.deepEqual(inspect(`import{spawnSync}from'node:child_process';spawnSync(node,['-e',${JSON.stringify(good)}]);`),[]);
  assert.equal(generatedJavaScript(writer),writer,'the source brand is a pure identity');
});

test('bindings belong to their lexical fixture, including repeated helper names',()=>{
  const source=`import{writeFileSync}from'node:fs';
function first(){const script=${JSON.stringify(writer)};writeFileSync('a.mjs',script);}
function second(){const script="console.log('safe')";writeFileSync('b.mjs',script);}`;
  assert.equal(inspect(source).length,1);
});

test('only the sealed oracle inline writer with its complete atomic shape is allowed',()=>{
  const file='tooling/census/output-oracle.ts',source=readFileSync(new URL('../census/output-oracle.ts',import.meta.url),'utf8');
  assert.deepEqual(inspectRecordPublications(file,source),[]);
  for(const mutation of [
    source.replace('renameSync(temporary, marker);',''),
    source.replace('writeFileSync(temporary, JSON.stringify(record));','writeFileSync(marker, JSON.stringify(record));'),
    source.replace('randomUUID() + ".partial"','"shared.partial"'),
    source.replace('renameSync(temporary, marker);','renameSync(temporary, other);'),
  ])assert.ok(inspectRecordPublications(file,mutation).length>0);
  assert.ok(inspectRecordPublications('tooling/other.ts',source).length>0,'the exception belongs only to the sealed driver');
});

test('the host audit can lend its root without another source parse',()=>{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
  const source=`import{writeFileSync}from'node:fs';writeFileSync('child.mjs',${JSON.stringify(writer)});`,lease=api.createSourceFile('tooling/fixture.ts',source);
  let rows;
  try{rows=inspectRecordPublications('tooling/fixture.ts',source,api,lease.sourceFile);}finally{lease.dispose();api.close();}
  assert.equal(rows!.length,1);assert.equal(JSON.parse(JSON.stringify(rows))[0].file,'tooling/fixture.ts');
});

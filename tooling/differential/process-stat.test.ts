import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {compileRuntimeModules} from './oracle-runtime-modules.ts';
import {processStat,readProcessStat,readTaskStats,unreadableIsAbsent} from './process-stat/main.ts';

const LEAF=fileURLToPath(new URL('./process-stat/main.ts',import.meta.url));
const require=createRequire(import.meta.url);
function record(pid:number,{state='S',fields=52,processor='5'}:{state?:string;fields?:number;processor?:string}={}){
  const values=Array<string>(fields).fill('0');values[0]=state;
  for(const [at,value] of [[1,1],[2,41],[3,41],[11,5],[12,7],[13,11],[14,13],[19,123]] as const)values[at]=String(value);
  if(fields>36)values[36]=processor;
  return `${pid} (worker (name)) ${values.join(' ')}`;
}

test('the owner leaf imports only node:fs, so the sealed oracle namespace carries it whole',()=>{
  const {API}=require('typescript/sync') as typeof import('typescript/sync'),ast=require('typescript/ast') as typeof import('typescript/ast');
  const api=new API();
  try{
    // Its own directory is the namespace: any relative import would escape it.
    const graph=compileRuntimeModules(fileURLToPath(new URL('./process-stat/',import.meta.url)),'main.ts',{api,ast});
    assert.deepEqual(graph.modules.map(module=>module.source),['main.ts']);
    const lease=api.createSourceFile(LEAF,fs.readFileSync(LEAF,'utf8')),specifiers:string[]=[];
    try{
      const visit=(node:import('typescript/ast').Node):void=>{
        if(ast.isImportDeclaration(node)||ast.isExportDeclaration(node)){if(node.moduleSpecifier&&ast.isStringLiteralLikeNode(node.moduleSpecifier))specifiers.push(node.moduleSpecifier.text);}
        else if(ast.isCallExpression(node)&&(node.expression.kind===ast.SyntaxKind.ImportKeyword||ast.isIdentifier(node.expression)&&node.expression.text==='require'))specifiers.push('<dynamic>');
        node.forEachChild(visit);
      };
      visit(lease.sourceFile);
    }finally{lease.dispose();}
    assert.deepEqual(specifiers,['node:fs']);
  }finally{api.close();}
});

test('a full record names its state, command and last processor; a short one omits only the processor',()=>{
  assert.deepEqual(processStat(record(13,{state:'D'})),{parent:1,group:41,session:41,cpu:36,own:12,started:123,busy:true,live:true,
    state:'D',comm:'worker (name)',processor:5});
  const short=processStat(record(13,{fields:20}));
  assert.equal(short.processor,undefined);assert.equal('processor' in short,false);
  assert.equal(processStat(record(13,{state:'Z'})).live,false);
  assert.throws(()=>processStat(record(13,{processor:'-1'})),/invalid process activity counters/);
  assert.throws(()=>processStat(record(13,{processor:'x'})),/invalid process activity counters/);
});

test('task records share the recheck; gone tasks are absent and other failures follow the caller policy',()=>{
  const reads:number[]=[],rows=new Map<number,(string|Error)[]>([
    [1,[record(1)]],[2,['2 (exiting) R',record(2,{processor:'7'})]],[3,[Object.assign(Error('gone'),{code:'ESRCH'})]],
    [4,[Object.assign(Error('denied'),{code:'EACCES'})]],[5,['','']],
  ]),counts=new Map<number,number>();
  const read=(tid:number)=>{reads.push(tid);const at=counts.get(tid)??0;counts.set(tid,at+1);const value=rows.get(tid)![Math.min(at,rows.get(tid)!.length-1)]!;if(value instanceof Error)throw value;return value;};
  const errors:string[]=[];
  const tasks=readTaskStats(9,rows.keys(),(tid,error)=>{errors.push(tid+': '+error.message);},read);
  assert.deepEqual([...tasks.keys()].sort(),[1,2]);assert.equal(tasks.get(2)!.processor,7);
  assert.deepEqual(reads,[1,2,3,4,5,2,5]);
  assert.equal(errors.length,2);
  assert.match(errors[0]!,/^4: cannot read process 9 task 4 stat: .*denied/);
  assert.match(errors[1]!,/^5: invalid process 9 task 5 stat after recheck/);
  counts.clear();
  assert.throws(()=>readTaskStats(9,[4],undefined,read),/cannot read process 9 task 4 stat/);
  assert.deepEqual([...readTaskStats(9,[4,5,1],unreadableIsAbsent,read).keys()],[1]);
});

test('the nullable policy makes an unreadable or malformed record absent instead of throwing',()=>{
  for(const value of [Object.assign(Error('denied'),{code:'EACCES'}),'72 (short) R']){
    const read=()=>{if(value instanceof Error)throw value;return value;};
    assert.equal(readProcessStat(72,read,unreadableIsAbsent),undefined);
    assert.throws(()=>readProcessStat(72,read),/process 72 stat/);
  }
});

test('the live reader keeps the fs it captured at load after governed code replaces and syncs builtins',()=>{
  const original=fs.readFileSync;let replaced=0;
  fs.readFileSync=((...args:Parameters<typeof original>)=>{replaced++;return original(...args);}) as typeof original;
  syncBuiltinESMExports();
  try{
    const own=readProcessStat(process.pid);
    assert.ok(own?.live);assert.equal(own.comm.length>0,true);
    assert.equal(replaced,0,'the owner read through the replaced readFileSync');
  }finally{fs.readFileSync=original;syncBuiltinESMExports();}
});

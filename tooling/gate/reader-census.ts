// A repeatable, read-only reader census, with its classification kept in the
// reviewed record rather than in executable selector policy.
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {hostEnvironment} from './canonical-environment.ts';
import {newTestScratch} from './test-scratch.ts';
import {removable} from './run-temporary.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {collectReaderCensus} from './reader-census-graph.ts';
import {classifyLosses,encodeIndex,firstLosses,readClassifications,sliceBudgets} from './reader-census-analysis.ts';

const RECORD=fileURLToPath(new URL('../../docs/records/reader-inputs-728/summary.json',import.meta.url));
const REVIEW=fileURLToPath(new URL('../../docs/records/reader-inputs-728/sites.tsv',import.meta.url));
const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const USAGE='usage: reader-census.ts reproduce <output> | inspect <source> <output> [classifications.tsv]';
export type CensusCommand={kind:'reproduce';output:string}|{kind:'inspect';source:string;output:string;review:string};

export function parseCensusCommand(args:readonly string[]):CensusCommand{
  if(args[0]==='reproduce'&&args.length===2&&args[1]&&!args[1].startsWith('-'))return {kind:'reproduce',output:resolve(args[1])};
  if(args[0]==='inspect'&&(args.length===3||args.length===4)&&args.slice(1).every(arg=>arg&&!arg.startsWith('-'))){
    return {kind:'inspect',source:resolve(args[1]!),output:resolve(args[2]!),review:resolve(args[3]??REVIEW)};
  }
  throw Error(USAGE);
}

function storedRecord(){
  const value:unknown=JSON.parse(readFileSync(RECORD,'utf8'));
  assert.ok(value&&typeof value==='object');
  const row=value as Record<string,unknown>,index=row.edgeIndex;
  assert.ok(typeof row.source==='string'&&/^[a-f0-9]{40}$/.test(row.source));
  assert.ok(typeof row.nodeVersion==='string'&&/^v\d+\.\d+\.\d+$/.test(row.nodeVersion));
  assert.ok(index&&typeof index==='object');
  const sha256=(index as Record<string,unknown>).sha256;
  assert.ok(typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256));
  return {source:row.source,node:row.nodeVersion,sha256};
}

export async function inspectReaders(command:Extract<CensusCommand,{kind:'inspect'}>){
  assert.equal(resolve(process.cwd()),command.source,'reader census must start in its selected source tree');
  mkdirSync(command.output,{recursive:true});
  const observed=await collectReaderCensus(command.source,command.output);
  const classified=classifyLosses(firstLosses(observed.capture),readClassifications(readFileSync(command.review,'utf8')));
  const held=new Set(observed.before.unplaced.map(row=>row.path));
  const rises=observed.after.unplaced.filter(row=>!held.has(row.path));
  assert.deepEqual(rises,[],'reader census switch-off adds fallback paths');
  const index=encodeIndex(classified,observed.metadata.source,process.version);
  writeFileSync(join(command.output,'edges.json'),index.bytes);
  writeFileSync(join(command.output,'classified.json'),JSON.stringify(classified,null,2)+'\n');
  writeFileSync(join(command.output,'slice-budgets.json'),JSON.stringify(sliceBudgets(classified),null,2)+'\n');
  console.log(JSON.stringify({source:observed.metadata.source,edges:index.edges,bytes:Buffer.byteLength(index.bytes),sha256:index.sha256,newFallback:rises.length}));
  return index;
}

export function reproduceReaders(output:string):void{
  const record=storedRecord();assert.equal(process.version,record.node,'reader census recorded Node version');
  mkdirSync(output,{recursive:true});
  const source=newTestScratch('728-reproduction-source'),base=hostEnvironment(process.env);
  const env={...base,GIT_DIR:join(source,'.git'),GIT_WORK_TREE:source,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
  // The object store is read only. Git config, index, refs and all writes have
  // an explicit private GIT_DIR; this source copy is never a shared worktree.
  const objects=resolve(SOURCE,execFileSync('/usr/bin/git',['rev-parse','--git-path','objects'],{cwd:SOURCE,encoding:'utf8',env:base}).trim());
  const git=(...args:string[])=>execFileSync('/usr/bin/git',args,{cwd:source,encoding:'utf8',env,maxBuffer:64<<20});
  try{
    git('init','--quiet','--initial-branch=source');
    mkdirSync(join(source,'.git/objects/info'),{recursive:true});
    writeFileSync(join(source,'.git/objects/info/alternates'),objects+'\n');
    git('read-tree',record.source);git('checkout-index','--all');git('update-ref','HEAD',record.source);
    // Private hard-link membership retains the parser's ownership boundary.
    // These provisioned package bytes are immutable throughout the census.
    execFileSync('/usr/bin/cp',['--archive','--link',join(SOURCE,'node_modules'),join(source,'node_modules')],{env:base});
    execFileSync(process.execPath,[fileURLToPath(import.meta.url),'inspect',source,output,REVIEW],{cwd:source,env,stdio:'inherit'});
    const actual=createHash('sha256').update(readFileSync(join(output,'edges.json'))).digest('hex');
    assert.equal(actual,record.sha256,'reader census reproduced index digest');
    console.log(JSON.stringify({verified:actual}));
  }finally{removable(source);rmSync(source,{recursive:true,force:true});}
}

runAsCommand(import.meta.url,async()=>{
  const command=parseCensusCommand(process.argv.slice(2));
  if(command.kind==='reproduce')reproduceReaders(command.output);
  else await inspectReaders(command);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmodSync,cpSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {hostObservations} from './host-observations.ts';
import {CaseMemoryBroker} from './case-memory-broker.ts';
import {createTokenPool} from './token-pool.ts';
import {caseHistoryFile,caseMemoryKey,readCaseHistory} from './step-scheduling.ts';
import {generatedJavaScript} from './generated-javascript.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const PROJECT='tests/outcomes/a-comparison-of-letters',MiB=2**20;

test('integrity leases staged listings by their source case and preserves its history across staging roots',async t=>{
  const dir=testScratch(t,'integrity-case-identity'),commands=join(dir,'commands.jsonl');
  const compiler=join(dir,'compiler.ts');
  writeFileSync(compiler,generatedJavaScript(`#!${process.execPath}
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(process.env.CONTROL_COMMANDS,JSON.stringify(args)+'\\n');
if(args[0]==='hir')process.stdout.write('func control() -> void {\\n}\\n\\n1 function(s), nothing refused\\n');
`));chmodSync(compiler,0o755);
  // Resource decisions are supplied. The real child uses a live clock and an
  // already-listening token server; no scheduling interval decides its result.
  const memory=ownMemory(join(dir,'observations'),{clock:{kind:'live'},resident:{kind:'fixed',defaultBytes:16*MiB},scopePeak:{kind:'fixed',bytes:32*MiB,resettable:true}});
  const identities:string[]=[],forecasts:(number|undefined)[]=[],failures:unknown[]=[];
  const staged:string[]=[];
  for(const variant of ['before','first','second']){
    const root=join(dir,variant);copyModuleClosure(['tooling/conformance/integrity.ts'],root);
    mkdirSync(dirname(join(root,PROJECT)),{recursive:true});cpSync(join(ROOT,PROJECT),join(root,PROJECT),{recursive:true});
    if(variant==='before'){
      const file=join(root,'tooling/conformance/integrity.ts'),source=readFileSync(file,'utf8');
      assert.ok(source.includes('},{project,backend:'));
      writeFileSync(file,source.replace('},{project,backend:','},{project:args.at(-1),backend:'));
    }
    const env=fixtureEnvironment(t,{...memory,HOME:join(dir,variant+'-home'),NTS_BIN:compiler,NTS_GATE_STEP:'integrity',
      NTS_GATE_TOKEN_HELD:'',NTS_INTEGRITY_JOBS:'1',CONTROL_COMMANDS:commands});
    const host=hostObservations(env);
    const broker=new CaseMemoryBroker({root,env,host,boundary:()=>{throw Error('no live boundary is used by this observation control');},report:message=>failures.push(message)});
    const group='/fixture/nts-test-integrity-'+randomUUID()+'.slice';
    const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,now:()=>0,
      prepare:request=>{
        broker.prepare(request);const lease=request.memory;assert.ok(lease);
        identities.push(lease.key);forecasts.push(lease.forecast);
        lease.attach(group,256*MiB);
      },completed:request=>broker.completed(request),failed:error=>failures.push(error)});
    const address=await pool.start();assert.ok(address);
    let output='';
    try{
      const child=spawn(process.execPath,[join(root,'tooling/conformance/integrity.ts'),PROJECT],{cwd:root,env:{...env,NTS_GATE_TOKENS:address},stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',part=>{output+=part;});child.stderr.on('data',part=>{output+=part;});
      const [code,signal]=await once(child,'close');
      if(variant==='before'){
        assert.notEqual(code,0,output);assert.match(output,/outside its source tree/);
        assert.equal(existsSync(commands),false,'the refused lease starts no compiler');
        assert.equal(identities.length,0);
      }else{
        assert.equal(code,0,`${signal??''}\n${output}`);
        assert.match(output,/1 of 1 project\(s\) measured/);
        const calls=readFileSync(commands,'utf8').trim().split('\n').map(line=>JSON.parse(line) as string[]);
        const latest=calls.slice(-4);assert.equal(latest.length,4);
        assert.ok(latest.every(args=>isAbsolute(args.at(-1)!)&&!args.at(-1)!.startsWith(root+'/')),'the compiler still reads the scratch copy');
        staged.push(latest[0]!.at(-1)!);
      }
      assert.equal(pool.total,0);broker.flush('integrity');
    }finally{pool.close();}
  }
  const key=caseMemoryKey({step:'integrity',backend:'c',path:PROJECT});
  assert.equal(identities.length,8);assert.ok(identities.every(identity=>identity===key));
  assert.notEqual(staged[0],staged[1]);assert.ok(forecasts.slice(4).every(value=>value!==undefined));
  const history=readCaseHistory(caseHistoryFile('integrity',memory,ROOT));
  assert.deepEqual([...history.keys()],[key]);assert.ok(history.get(key)!.every(peak=>peak===32*MiB));
  assert.deepEqual(failures,[]);
});

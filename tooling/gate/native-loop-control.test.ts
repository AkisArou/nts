import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {fileInput} from './reader-inputs/main.ts';

const DRIVER=fileInput(new URL('../cli/tests/fixtures/node-loop-driver.cjs',import.meta.url));

async function observe(source:string,valid:boolean){
  const completed=Promise.withResolvers<void>();
  const observed={workers:0,exitCode:0,errors:[] as string[],output:[] as string[]};
  class Worker {
    private message:((sum:number)=>void)|undefined;
    constructor(_file:string,_options:unknown){observed.workers++;}
    once(event:string,callback:(value:number)=>void){
      if(event==='message')this.message=callback;
      if(event==='exit'){assert.ok(this.message);this.message(336);callback(0);}
      return this;
    }
  }
  runInNewContext(source,{
    __filename:'private-driver.cjs',
    require(name:string){
      if(name==='node:assert/strict')return assert;
      if(name==='node:worker_threads')return {Worker,isMainThread:true};
      assert.equal(name,'private-addon.node');
      return {sameLoop:()=>true,privateDefault:()=>valid,start:async()=>42};
    },
    process:{argv:['node','private-driver.cjs','private-addon.node'],
      set exitCode(code:number){observed.exitCode=code;completed.resolve();}},
    console:{log(value:unknown){observed.output.push(String(value));completed.resolve();},
      error(error:unknown){observed.errors.push(String(error));}},
  });
  await completed.promise;
  return observed;
}

test('an invalid native loop acquires no workers before its refusal',async()=>{
  const observed=await observe(readFileSync(DRIVER,'utf8'),false);
  assert.equal(observed.workers,0);
  assert.equal(observed.exitCode,1);
  assert.equal(observed.errors.length,1);
  assert.match(observed.errors[0]!,/bundled uv must not bind Node symbols/);
  assert.deepEqual(observed.output,[]);
});

test('a valid native loop keeps both worker completions and the full checksum',async()=>{
  const observed=await observe(readFileSync(DRIVER,'utf8'),true);
  assert.equal(observed.workers,2);
  assert.equal(observed.exitCode,0);
  assert.deepEqual(observed.errors,[]);
  assert.deepEqual(observed.output,['host-loop-ok 32 1344']);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from '../landing/run-fixture.ts';
import {gateEnvironment} from './canonical-environment.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {spawnTest,TEST_HANG_MS} from './test-wait.ts';
import {canonicalLocation,outsideSource} from './source-containment.ts';

function inventory(root:string):string[] {
  const paths:string[]=[];
  const visit=(directory:string)=>{
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
      const path=join(directory,entry.name);paths.push(path);
      if(entry.isDirectory())visit(path);
    }
  };
  visit('');return paths.sort();
}

test('source containment resolves existing ancestors on both sides',t=>{
  const f=fixture(t),alias=join(f.own,'source-alias');symlinkSync(f.tree,alias);
  const absent=join(alias,'not-created','child');
  assert.equal(canonicalLocation(absent),join(f.tree,'not-created','child'));
  assert.throws(()=>outsideSource(alias,absent,'test destination'),/test destination resolves inside source tree/);
  assert.equal(outsideSource(alias,f.tree+'-sibling','test destination'),f.tree+'-sibling');
  assert.equal(existsSync(join(f.tree,'not-created')),false);
});

for(const kind of ['root','target','alias-root','alias-target','outside','sibling-prefix','outside-alias'] as const){
  test(`the runner validates its ${kind} run directory before namespace creation`,t=>{
    const f=fixture(t),alias=join(f.own,'source-alias'),external=join(f.own,'external');
    symlinkSync(f.tree,alias);mkdirSync(external);
    const outsideAlias=join(f.own,'external-alias');symlinkSync(external,outsideAlias);
    const requested={root:f.tree,target:join(f.tree,'target','new-run'),
      'alias-root':alias,'alias-target':join(alias,'target','new-run'),
      outside:join(external,'new-run'),'sibling-prefix':f.tree+'-sibling',
      'outside-alias':join(outsideAlias,'new-run')}[kind];
    const owned=ownMemory(join(f.own,'run-memory'));
    const prepared=gateEnvironment(f.options([]).env??{}, {run:join(f.own,'launcher'),oracleRoot:f.tree,owned});
    const env={...prepared.env,NTS_GATE_RUN_DIR:requested};
    const before=inventory(f.tree),unit='nts-731-'+randomUUID().slice(0,8),manager=fixtureEnvironment(t);
    const stop=()=>spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8',env:manager});
    t.after(stop);
    let result;
    try{
      result=spawnTest('systemd-run',['--user','--unit='+unit,'--collect','--wait','--quiet','--pipe',
        '-p','Nice=19','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec='+Math.ceil(TEST_HANG_MS/1000),
        '--working-directory='+f.tree,...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([key,value])=>'--setenv='+key+'='+value),
        process.execPath,join(f.tree,'tooling/gate/run.mjs'),'731-unknown-step'],
        {encoding:'utf8',env:manager},'owned gate run directory control');
    }finally{stop();}
    const said=result.stdout+result.stderr;
    assert.equal(result.status,2,said);
    if(['root','target','alias-root','alias-target'].includes(kind)){
      assert.match(said,/NTS_GATE_RUN_DIR resolves inside source tree/);
      assert.deepEqual(inventory(f.tree),before,'refusal creates no source namespace');
      assert.equal(existsSync(join(f.tree,'target')),false);
    }else{
      assert.match(said,/name no such step: 731-unknown-step/);
      assert.doesNotMatch(said,/resolves inside source tree/);
      assert.ok(existsSync(join(requested,'tmp')),'the accepted directory reaches canonical namespace creation');
    }
  });
}

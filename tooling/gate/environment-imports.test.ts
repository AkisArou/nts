import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectHostSource} from './test-host-audit.ts';
import {movedEnvironmentImportProblems} from './environment-imports.ts';
import {inspectRecordPublications} from './test-readiness.ts';

function problems(file:string,source:string):string[]{
  const result:string[]=[];
  inspectHostSource(file,source,undefined,(_file,_source,facts)=>{
    result.push(...movedEnvironmentImportProblems(facts));
    inspectRecordPublications(file,source,undefined,facts,(_text,generated,offset)=>result.push(...movedEnvironmentImportProblems(generated,[],offset)));
  },undefined,
    (facts,offset,argv)=>result.push(...movedEnvironmentImportProblems(facts,argv,offset)));
  return result;
}
test('moved environment APIs are rejected in direct and generated module imports',()=>{
  for(const source of [
    "import {ownedCacheEnvironment} from './canonical-environment.ts';",
    "import {writeFileSync} from 'node:fs'; const child=`import {ownedCacheEnvironment} from './canonical-environment.ts';`; writeFileSync('child.mjs',child);",
    "import {writeFileSync} from 'node:fs'; const url=new URL('./canonical-environment.ts',import.meta.url).href; const child=`import {ownedCacheEnvironment} from ${JSON.stringify(url)};`; writeFileSync('child.mjs',child);",
  ])assert.ok(problems('tooling/gate/fixture.ts',source).some(row=>row.includes('ownedCacheEnvironment must be imported')),source);
  assert.deepEqual(problems('tooling/gate/fixture.ts',"const child=`import {ownedCacheEnvironment} from './host-environment.ts';`;"),[]);
  assert.deepEqual(problems('tooling/gate/fixture.ts',"const inspected=`import {ownedCacheEnvironment} from './canonical-environment.ts';`;"),[],'quoted inspection source is not an executable program');
});
test('Node eval and heredoc imports use the shared shell observer and actual module argument',()=>{
  const old=`node -e 'const {oracleToolchainLocation}=await import(process.argv[1]);' "$root/tooling/gate/canonical-environment.ts"\n`;
  assert.ok(problems('tooling/shell.sh',old).some(row=>row.includes('oracleToolchainLocation must be imported')));
  assert.deepEqual(problems('tooling/shell.sh',old.replace('canonical-environment.ts','host-environment.ts')),[]);
  assert.ok(problems('tooling/shell.sh',`node --input-type=module - <<'JS'\nimport {ownedCacheEnvironment} from './canonical-environment.ts';\nJS\n`).length);
});
test('moved oracle APIs are rejected through the same direct, generated and shell observer',()=>{
  for(const source of [
    "import {oracleRecipeIdentity} from '../differential/oracle-emit.ts';",
    "import {writeFileSync} from 'node:fs'; const child=`import {OracleWorker,oracleRecipeIdentity} from '../differential/oracle-emit.ts';`; writeFileSync('child.mjs',child);",
    "import {writeFileSync} from 'node:fs'; const url=new URL('../differential/oracle-emit.ts',import.meta.url).href; const child=`const {oracleRecipeIdentity}=await import(${JSON.stringify(url)});`; writeFileSync('child.mjs',child);",
  ])assert.ok(problems('tooling/gate/fixture.ts',source).some(row=>row.includes('oracleRecipeIdentity must be imported')),source);
  assert.deepEqual(problems('tooling/gate/fixture.ts',"import {oracleRecipeIdentity} from '../differential/oracle-runtime.ts'; import {OracleWorker} from '../differential/oracle-emit.ts';"),[]);
  assert.ok(problems('tooling/shell.sh',`node --input-type=module - <<'JS'\nimport {OracleBudgetError} from './oracle-emit.ts';\nJS\n`).some(row=>row.includes('OracleBudgetError must be imported')));
});

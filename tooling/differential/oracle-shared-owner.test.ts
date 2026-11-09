// A module a program imports from outside its own project is emitted by the
// Node oracle inside the project that owns it, the nearest tsconfig.json above
// it, and that project's whole program is checked. The owner's roots therefore
// decide which other files can stop a program's oracle.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {oracleToolchainLocation} from '../gate/canonical-environment.ts';
import {prepareOracle,removeOracleSnapshot} from './oracle-emit.ts';
import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';

const REPOSITORY=fileURLToPath(new URL('../..',import.meta.url));
await setupOracleTestEnvironment();
const toolchain=oracleToolchainLocation();
const owners=(manifest:string)=>(JSON.parse(readFileSync(manifest,'utf8')).groups as {project:string}[]).map(group=>group.project).sort();

test('a program importing the shared benchmark modules is prepared in their own project, never the aggregate of every case',async t=>{
  const fixture=join(REPOSITORY,'tests/programs/awfy-dictionary-hole-slots');
  const directory=mkdtempSync(join(tmpdir(),'nts-oracle-shared-owner-'));t.after(()=>removeOracleSnapshot(directory));
  const prepared=await prepareOracle({toolchain,entry:join(fixture,'src/main.ts'),project:join(fixture,'tsconfig.json'),directory});
  assert.deepEqual(owners(prepared.manifest),[join(REPOSITORY,'benchmarks/common/tsconfig.json'),join(fixture,'tsconfig.json')].sort());
});

test("a declaration outside the program stops its oracle when the shared module's project includes it, and not when the module has a project of its own",async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-owner-roots-'));t.after(()=>removeOracleSnapshot(root));
  const write=(name:string,text:string)=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};
  const options={extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{types:['node'],typeRoots:[join(REPOSITORY,'node_modules/@types')]}};
  write('package.json','{"type":"module"}');
  // The shared side, as benchmarks/ is: an aggregate over every case and the shared modules.
  write('shared/tsconfig.json',JSON.stringify({...options,include:['cases','common']}));
  write('shared/common/value.ts','export const value=23;\n');
  // One case's declaration that does not check, as lebab-wtb's types/recast/main.d.ts does not.
  write('shared/cases/other/named.d.ts','export declare const named:number;\n');
  write('shared/cases/other/main.d.ts',"export { visit } from './named.js';\n");
  // The program, as a tests/programs fixture is, imports one shared module.
  write('program/tsconfig.json',JSON.stringify({...options,include:['src']}));
  write('program/src/main.ts',"import {value} from '../../shared/common/value.ts';\nconsole.log(value);\n");
  const prepare=(name:string)=>prepareOracle({toolchain,entry:join(root,'program/src/main.ts'),directory:join(root,name)});
  await assert.rejects(prepare('aggregate'),/oracle TypeScript rejected the program \(status 2\): .*cases\/other\/main\.d\.ts.*has no exported member 'visit'/s);
  // The control differs in one thing: the shared modules have a project of their own.
  write('shared/common/tsconfig.json',JSON.stringify({...options,include:['*.ts']}));
  const prepared=await prepare('own');
  assert.deepEqual(owners(prepared.manifest),[join(root,'program/tsconfig.json'),join(root,'shared/common/tsconfig.json')].sort());
});

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {catalogueFiles,runMemberCatalogue} from './member-catalogue.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {testEnvironment} from '../gate/test-environment.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {removable} from '../gate/run-temporary.ts';

const CATALOGUE='compiler/codegen/jvm/member-names.json';
function fixture(t:TestContext){
  const root=newTestScratch('jvm-members');t.after(()=>{removable(root);rmSync(root,{recursive:true,force:true});});
  const model={version:1,prefix:'@synthetic.',observer:{legacy_raising_suffix:'raising'},
    name_escape:{ascii_literal:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_',escaped_non_ascii:[]},
    roles:[{rust:'FIXED',stem:'fixed',key:'none'},{rust:'body',stem:'body',key:'name'}],
    java_templates:[{template:'runtime/jvm/member-templates/Synthetic.java.in',output:'runtime/jvm/Synthetic.java'}]};
  mkdirSync(dirname(join(root,CATALOGUE)),{recursive:true});writeFileSync(join(root,CATALOGUE),JSON.stringify(model));
  const template=join(root,model.java_templates[0]!.template);mkdirSync(dirname(template),{recursive:true});
  writeFileSync(template,'class Synthetic { String marker = "@@FIXED@@"; }\n');
  writeFileSync(join(root,'runtime/jvm/nts-runtime.jar'),Buffer.from([0x50,0x4b,0x03,0x04]));
  const generated=runMemberCatalogue({root,check:false,directories:['compiler','runtime/jvm','tooling'],report:()=>{}});
  assert.equal(generated,0);
  const inputs=catalogueFiles(root),baseline=new Map(inputs.map(path=>[path,readFileSync(join(root,path))]));
  const initialized=spawnSync('git',gitArguments(['init','--quiet']),{cwd:root,encoding:'utf8',env:testEnvironment()});
  assert.equal(initialized.status,0,initialized.stderr);
  const run=(check=true)=>{
    const stdout:string[]=[],stderr:string[]=[];let status:number;
    try{status=runMemberCatalogue({root,check,directories:['compiler','runtime/jvm','tooling'],
      report:line=>stdout.push(line),error:line=>stderr.push(line)});}
    catch(error){status=1;stderr.push(String(error));}
    return {status,stdout:stdout.join('\n'),stderr:stderr.join('\n')};
  };
  return {root,inputs,baseline,model,run};
}

// Migrated from catalogue_sources_are_fresh_and_exclusive. The real step
// applies this same operation to its declared production population.
test('the actual catalogue operation retains fresh outputs and reproduces their exact bytes',t=>{
  const {root,inputs,baseline,run}=fixture(t),clean=run();
  assert.equal(clean.status,0,clean.stderr);assert.match(clean.stdout,/checked \d+ JVM member sources/);
  const generated=join(root,'compiler/codegen/jvm/generated-members.json');
  writeFileSync(generated,readFileSync(generated,'utf8')+' ');
  const stale=run();assert.equal(stale.status,1,stale.stderr);assert.match(stale.stderr,/source is stale/);
  const repaired=run(false);assert.equal(repaired.status,0,repaired.stderr);
  for(const input of inputs)assert.deepEqual(readFileSync(join(root,input)),baseline.get(input),input);
  assert.equal(run().status,0);
});

// Migrated from exclusivity_cannot_be_bypassed_by_a_literal_nul and its
// actual member-scanner.test.ts; unknown source/data remain under the scan.
test('the actual exclusivity scanner retains NUL, unknown data, ZIP and declared-JAR controls',t=>{
  const {root,model,run}=fixture(t);
  const path='tooling/namespace-probe.ts';mkdirSync(dirname(join(root,path)),{recursive:true});
  for(const [label,nul]of [['escaped','\\u0000'],['literal',String.fromCharCode(0)]]){
    writeFileSync(join(root,path),`const value = "${nul}";\n// ${model.prefix}\n`);
    const syntax=spawnSync(process.execPath,['--check',path],{cwd:root,encoding:'utf8',env:testEnvironment()});
    assert.equal(syntax.status,0,`${label}: source must be valid: ${syntax.stderr}`);
    const checked=run();assert.equal(checked.status,1,`${label}: reserved name in valid source must fail`);
    assert.match(checked.stderr,/reserved JVM member prefix outside its catalogue/);
    assert(checked.stderr.includes(path),checked.stderr);assert(!checked.stderr.includes('source is stale'),checked.stderr);
  }
  rmSync(join(root,path));
  const escaped=[...model.prefix].map(ch=>'\\u{'+ch.codePointAt(0)!.toString(16)+'}').join('');
  writeFileSync(join(root,path),'// '+escaped+'\n');
  const unicode=run();assert.equal(unicode.status,1);assert(unicode.stderr.includes(path),unicode.stderr);
  rmSync(join(root,path));
  const ignored='tooling/ignored.data';writeFileSync(join(root,'.gitignore'),ignored+'\n');
  writeFileSync(join(root,ignored),model.prefix);assert.equal(run().status,0,'ignored untracked data is outside Git enumeration');
  const added=spawnSync('git',gitArguments(['add','--force','--',ignored]),{cwd:root,encoding:'utf8',env:testEnvironment()});
  assert.equal(added.status,0,added.stderr);assert.equal(run().status,1,'a tracked ignored path remains in cached enumeration');
  const removed=spawnSync('git',gitArguments(['rm','--force','--',ignored]),{cwd:root,encoding:'utf8',env:testEnvironment()});
  assert.equal(removed.status,0,removed.stderr);assert.equal(run().status,0);
  const unknown='tooling/namespace-probe.data';writeFileSync(join(root,unknown),`${String.fromCharCode(0)}${model.prefix}`);
  const data=run();assert.equal(data.status,1,'unknown NUL-bearing data must remain under exclusivity');assert(data.stderr.includes(unknown),data.stderr);
  rmSync(join(root,unknown));
  const unknownJar='tooling/namespace-probe.jar';
  writeFileSync(join(root,unknownJar),Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04,0]),Buffer.from(model.prefix)]));
  const jar=run();assert.equal(jar.status,1,'unknown ZIP-looking path is not a declared artifact');assert(jar.stderr.includes(unknownJar),jar.stderr);
  rmSync(join(root,unknownJar));assert.equal(run().status,0);
  writeFileSync(join(root,'runtime/jvm/nts-runtime.jar'),'not a ZIP archive');
  const corrupt=run();assert.equal(corrupt.status,1);assert.match(corrupt.stderr,/declared JVM runtime artifact is not a ZIP archive/);
});

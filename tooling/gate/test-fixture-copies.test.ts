import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {test} from 'node:test';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {inspectFixtureCopies,fixtureCopyProblems} from './test-fixture-copies.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';

function inspect(source:string,file='tooling/gate/fixture.test.ts',root='/owned'){
 const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
 const api=new API(),lease=api.createSourceFile(file,source);
 try{return inspectFixtureCopies(root,file,source,lease.sourceFile);}finally{lease.dispose();api.close();}
}
const imports=`import {copyFileSync,symlinkSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {copyModuleClosure} from './module-closure-fixture.ts';const ROOT='/owned';`;

test('fixture copies follow a new import and run the complete staged graph',t=>{
 const own=testScratch(t,'fixture-copy-control'),source=join(own,'source');mkdirSync(source);
 writeFileSync(join(source,'entry.ts'),"console.log(19);\n");
 const first=join(own,'first');copyModuleClosure(['entry.ts'],first,{sourceRoot:source});
 const run=(root:string)=>spawnTest(process.execPath,[join(root,'entry.ts')],{env:fixtureEnvironment(t),encoding:'utf8'});
 assert.equal(run(first).stdout,'19\n');
 writeFileSync(join(source,'entry.ts'),"import {answer} from './new.ts';console.log(answer);\n");
 writeFileSync(join(source,'new.ts'),'export const answer=42;\n');
 const second=join(own,'second');copyModuleClosure(['entry.ts'],second,{sourceRoot:source});
 const result=run(second);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'42\n');
 assert.equal(readFileSync(join(second,'new.ts'),'utf8'),'export const answer=42;\n');
});

for(const [label,body] of [
 ['hand list',`for(const file of ['tooling/gate/entry.ts','tooling/gate/helper.ts'])copyFileSync(join(ROOT,file),join('/fixture',file));`],
 ['manual tail',`copyModuleClosure(['tooling/gate/entry.ts'],'/fixture');symlinkSync(join(ROOT,'tooling/gate/helper.ts'),'/fixture/helper.ts');`],
 ['regex discovery',`const source=readFileSync(join(ROOT,'tooling/gate/entry.ts'),'utf8');for(const match of source.matchAll(/from .*/g))symlinkSync(new URL('../'+match[1],import.meta.url),join('/fixture',match[1]));`],
] as const)test(`the source audit rejects ${label}`,()=>{
 const rows=inspect(imports+body);assert.ok(rows.length>0,label);
 assert.ok(fixtureCopyProblems('/owned',rows).every(line=>line.includes('outside copyModuleClosure')));
});

test('copy aliases and CommonJS destructuring cannot hide a dependency tail',()=>{
 const source=`const {copyFileSync:copy}=require('node:fs');const path=require('node:path');const source=path.join('/owned','tooling/gate/helper.ts');const alias=copy;alias(source,'/fixture/helper.ts');`;
 assert.equal(inspect(source).length,1);
});

test('data, package installs and already-staged mutations stay explicit inputs',()=>{
 assert.deepEqual(inspect(imports+`copyFileSync(join(ROOT,'tooling/gate/data.json'),'/fixture/data.json');copyFileSync('/toolchains/node/index.js','/fixture/node_modules/x/index.js');copyModuleClosure(['tooling/gate/entry.ts'],'/fixture');const source=readFileSync('/fixture/tooling/gate/entry.ts','utf8');writeFileSync('/fixture/tooling/gate/entry.ts',source.replace('one','two'));`),[]);
});

test('a whole-namespace exclusion cannot authorize a selected dependency list',()=>{
 const file='tooling/census/sampling-cli.test.ts';
 assert.deepEqual(inspect(imports+`for(const name of readdirSync(join(ROOT,'tooling')))symlinkSync(join(ROOT,'tooling',name),join('/fixture/tooling',name));`,file),[]);
 assert.equal(inspect(imports+`for(const name of ['gate','census'])symlinkSync(join(ROOT,'tooling',name),join('/fixture/tooling',name));`,file).length,2);
});

test('a standalone entry exclusion expires when its entry gains a dependency',t=>{
 const root=testScratch(t,'standalone-entry'),directory=join(root,'tooling/gate');mkdirSync(directory,{recursive:true});
 const file=join(directory,'costs.mjs');writeFileSync(file,"import fs from 'node:fs';export const value=1;\n");
 const rows=inspect(`import {copyFileSync} from 'node:fs';copyFileSync('${file}','/fixture/costs.mjs');`,'tooling/apple/ios-readiness.test.ts',root);
 assert.equal(rows.length,1);assert.deepEqual(fixtureCopyProblems(root,rows),[]);
 writeFileSync(file,"import './helper.ts';\n");writeFileSync(join(directory,'helper.ts'),'export const value=1;\n');
 assert.equal(fixtureCopyProblems(root,rows).length,1);
});

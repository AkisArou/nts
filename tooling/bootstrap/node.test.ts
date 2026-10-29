import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {DEPENDENCIES,digest,inputFiles,nodePin,prepare,publishedHash,resolveRecipe,verifySource} from './node.ts';

function scratch(){const p=process.env.TMPDIR??join(homedir(),'.cache/nts-tests');mkdirSync(p,{recursive:true});return mkdtempSync(join(p,'node-bootstrap-'));}
function tree(root:string){
 mkdirSync(join(root,'src'),{recursive:true});
 writeFileSync(join(root,'src/node_version.h'),'#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 20\n#define NODE_PATCH_VERSION 0\n');
 for(const name of DEPENDENCIES){mkdirSync(join(root,'deps',name),{recursive:true});writeFileSync(join(root,'deps',name,'fixture.c'),'/* unchanged upstream */\n');}
}

test('release checksum lookup is an exact unique filename match',()=>{
 const hash='1'.repeat(64);
 assert.equal(publishedHash(hash+'  node-v24.20.0.tar.xz\n','node-v24.20.0.tar.xz'),hash);
 assert.throws(()=>publishedHash(hash+'  node-v24.20.0.tar.xz.other\n','node-v24.20.0.tar.xz'));
 assert.throws(()=>publishedHash((hash+'  wanted\n').repeat(2),'wanted'));
});

test('verified acquisition publishes atomically and reuse is offline',async()=>{
 const dir=scratch(),version='24.20.0',root=join(dir,'root'),source=join(dir,'node-v'+version);
 mkdirSync(root);writeFileSync(join(root,'.tool-versions'),'nodejs '+version+'\n');tree(source);
 const archive=join(dir,'source.tar.xz');execFileSync('tar',['-cJf',archive,'-C',dir,'node-v'+version]);const bytes=readFileSync(archive);
 const server=createServer((req,res)=>{if(req.url?.endsWith('SHASUMS256.txt'))res.end(digest(bytes)+'  node-v'+version+'.tar.xz\n');else res.end(bytes);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const destination=join(dir,'prepared');
 try {
  await prepare(destination,root,base);verifySource(destination,version);
  await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()));
  await prepare(destination,root,'http://127.0.0.1:1');
  writeFileSync(join(destination,'deps/uv/fixture.c'),'modified\n');assert.throws(()=>verifySource(destination,version),/changed|incomplete/);
 }finally{server.close();rmSync(dir,{recursive:true,force:true});}
});

test('checksum failure leaves no prepared tree and a wrong version is rejected',async()=>{
 const dir=scratch();writeFileSync(join(dir,'.tool-versions'),'nodejs 24.20.0\n');
 const server=createServer((req,res)=>res.end(req.url?.endsWith('SHASUMS256.txt')?'0'.repeat(64)+'  node-v24.20.0.tar.xz\n':'wrong archive'));
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address==='object');
 try {
  const dest=join(dir,'prepared');await assert.rejects(prepare(dest,dir,'http://127.0.0.1:'+address.port),/checksum/);assert.equal(existsSync(dest),false);
  tree(dest);writeFileSync(join(dest,'NTS-SOURCE.json'),JSON.stringify({version:'24.19.0',archive_sha256:'0'.repeat(64),files:inputFiles(dest)}));
  assert.throws(()=>verifySource(dest,'24.20.0'),/version/);
 }finally{await new Promise<void>(done=>server.close(()=>done()));rmSync(dir,{recursive:true,force:true});}
});

test('committed recipe equals fresh upstream GYP evaluation without machine paths',()=>{
 const root=resolve(import.meta.dirname,'../..'),source=join(root,'third_party/node-source');
 assert.equal(nodePin(root),'24.20.0');
 resolveRecipe(source,undefined,true);
 const text=readFileSync(join(root,'build/node-deps/recipes.json'),'utf8');
 assert.ok(!text.includes(root));
 const registry=JSON.parse(text),recipe=registry.plans.find(p=>p.target==='x86_64-unknown-linux-gnu'),zlib=recipe.targets.find((t:{name:string})=>t.name==='zlib');
 assert.deepEqual(zlib.dependencies,['zlib_data_chunk_simd','zlib_adler32_simd']);
 assert.ok(recipe.targets.some((t:{name:string,cflags:string[]})=>t.name==='zlib_adler32_simd'&&t.cflags.includes('-mssse3')));
 assert.deepEqual(recipe.targets.find((t:{name:string})=>t.name==='openssl').dependencies,['zlib','brotli','zstd']);
 assert.equal(registry.plans.length,9);
 for(const abi of ['gnu','musl']) {
  const arm=registry.plans.find(p=>p.target==='aarch64-unknown-linux-'+abi);
  assert.ok(arm.public.openssl.includes.some(p=>p.includes('linux-aarch64/asm')));
  assert.ok(arm.targets.find(t=>t.name==='openssl').sources.some(p=>p.endsWith('.S')));
 }
 for(const plan of registry.plans)for(const target of plan.targets)for(const source of target.sources)
  assert.ok(source in registry.files,source+' is absent from the shared pack');
 for(const plan of registry.plans.filter(p=>p.object_format==='coff')) {
  assert.ok(plan.public.uv.libraries.includes('-lws2_32'));
  assert.ok(!plan.targets[0].defines.includes('BUILDING_UV_SHARED=1'));
 }
});

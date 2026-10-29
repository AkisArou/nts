import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {check,forbidden,needed} from './node-deps-elf.ts';
// The gate's tooling entry point also verifies the bootstrap's committed graph.
import '../bootstrap/node.test.ts';

test('ELF dependency guard names every owned library and rejects malformed entries',()=>{
 for(const name of ['libcrypto.so.3','libssl.so.3','libbrotlicommon.so.1','libbrotlidec.so.1','libbrotlienc.so.1','libz.so.1','libzstd.so.1','libuv.so.1'])assert.ok(forbidden(name));
 for(const name of ['libc.so.6','libm.so.6','libzebra.so.1','libstdc++.so.6'])assert.ok(!forbidden(name));
 assert.deepEqual(needed('  0x1 (NEEDED) Shared library: [libc.so.6]\n'),['libc.so.6']);
 assert.throws(()=>needed('  0x1 (NEEDED) missing library name'));
});

test('a real fake forbidden SONAME fails while an ordinary ELF passes',{skip:process.platform!=='linux'},()=>{
 const parent=process.env.TMPDIR??join(homedir(),'.cache/nts-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'node-deps-elf-'));
 const run=(args:string[])=>{const result=spawnSync('clang',args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
 try {
  writeFileSync(join(dir,'library.c'),'int owned(void){return 7;}\n');
  writeFileSync(join(dir,'bad.c'),'int owned(void);int main(void){return owned()!=7;}\n');
  writeFileSync(join(dir,'good.c'),'int main(void){return 0;}\n');
  run(['-shared','-fPIC',join(dir,'library.c'),'-Wl,-soname,libcrypto.so.999','-o',join(dir,'library.so')]);
  run([join(dir,'bad.c'),join(dir,'library.so'),'-o',join(dir,'bad')]);
  run([join(dir,'good.c'),'-o',join(dir,'good')]);
  assert.throws(()=>check(join(dir,'bad')),/libcrypto.so.999/);
  assert.ok(!check(join(dir,'good')).some(forbidden));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

// Diagnostic reproduction of Node v26.13.0 test/pummel/
// test-buffer-large-size-{slowbuffer,buffer-alloc-unsafe-slow,
// buffer-alloc-unsafe,buffer-alloc}.js. The upstream files remain the gated
// subjects. Change only extent=full to extent=one for the matching control.
// Run in a named unit with core dumps disabled; the typed full case may abort.
import {Buffer as NativeBuffer} from 'node:buffer';
const [mode,pattern,extent]=process.argv.slice(2);
if(!['node','ts'].includes(mode)||!['module-slow','global-slow','unsafe','alloc'].includes(pattern)||!['full','one'].includes(extent))
  throw Error('oversized-utf8.mjs <node|ts> <module-slow|global-slow|unsafe|alloc> <full|one>');
let BufferImpl=NativeBuffer;
if(mode==='ts') {
  await import('../bindings.node.mjs');
  BufferImpl=(await import('../src/main.ts')).Buffer;
  globalThis.Buffer=BufferImpl;
}
const bytes=2**31;
const log=value=>process.stdout.write(JSON.stringify(value)+'\n');
log({phase:'before-allocation',mode,pattern,bytes});
const buffer=pattern==='module-slow'?BufferImpl.allocUnsafeSlow(bytes):
  pattern==='global-slow'?globalThis.Buffer.allocUnsafeSlow(bytes):
  pattern==='unsafe'?globalThis.Buffer.allocUnsafe(bytes):globalThis.Buffer.alloc(bytes);
buffer[0]=65;
log({phase:'allocated',length:buffer.length,backingBytes:buffer.buffer.byteLength,byteOffset:buffer.byteOffset});
log({phase:'before-decode',encoding:'utf8',start:0,end:extent==='full'?buffer.length:1});
try {
  const value=buffer.toString('utf8',0,extent==='full'?buffer.length:1);
  log({phase:'decoded',length:value.length});
  log({phase:'result',...(extent==='one'?{value}:{length:value.length})});
} catch(error) {
  log({phase:'result',error:error.code,name:error.name,message:error.message});
}

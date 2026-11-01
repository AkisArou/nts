// Controls for the four unchanged Node v26.13.0 pummel/test-buffer-large-size-
// {slowbuffer,buffer-alloc-unsafe-slow,buffer-alloc-unsafe,buffer-alloc}.js
// subjects. Keep the same 2**31 allocation; change only the decoded extent
// from the whole buffer to one initialized byte. The full cases remain named
// port defects; this guard does not claim that their string-limit gap is fixed.
const assert=require('node:assert');
const {Buffer:ModuleBuffer}=require('node:buffer');
const bytes=2**31;
for(const allocate of [
  ()=>ModuleBuffer.allocUnsafeSlow(bytes),
  ()=>Buffer.allocUnsafeSlow(bytes),
  ()=>Buffer.allocUnsafe(bytes),
  ()=>Buffer.alloc(bytes),
]) {
  const buffer=allocate();
  buffer[0]=65;
  assert.strictEqual(buffer.length,bytes);
  assert.strictEqual(buffer.toString('utf8',0,1),'A');
}

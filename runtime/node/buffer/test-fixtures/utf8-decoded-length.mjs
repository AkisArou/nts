// The pre-allocation length pass must count replacement characters and
// supplementary pairs exactly like Node, including partial/invalid UTF-8.
import assert from 'node:assert/strict';
import {utf8DecodedLength,kStringMaxLength} from '../src/string-length.ts';
import {Buffer} from 'node:buffer';
assert.equal(kStringMaxLength,536870888);
let checked=0;
const check=bytes=>{
  for(let start=0;start<=Math.min(1,bytes.length);start++) {
    assert.equal(utf8DecodedLength(bytes,start,bytes.length),Buffer.from(bytes).toString('utf8',start).length);
    checked++;
  }
};
for(let a=0;a<256;a++) {
  check(new Uint8Array([a]));
  for(let b=0;b<256;b++)check(new Uint8Array([a,b]));
}
for(const a of [0,0x41,0x80,0xbf,0xc0,0xc2,0xdf,0xe0,0xed,0xef,0xf0,0xf4,0xf5,0xff])
  for(const b of [0,0x80,0x8f,0x90,0x9f,0xa0,0xbf,0xc0])
    for(const c of [0,0x80,0x8f,0x90,0x9f,0xa0,0xbf,0xc0])
      for(const d of [0x80,0xbf,0xff])check(new Uint8Array([a,b,c,d]));
console.log(JSON.stringify({checked}));

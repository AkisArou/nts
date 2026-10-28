import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeResult} from './layouts-native.ts';
import {heapCommand} from './layouts-heap.ts';

test('native interval adapter retains exact work and output checks',()=>{
 const value={checksum:'3ff0000000000000',n:2,warmup:1,sink:3,nsPerOp:10,elapsedNs:20};
 assert.equal(nativeResult(JSON.stringify(value),2,1,value.checksum).sink,3);
 for(const bad of [{...value,n:3},{...value,sink:2},{...value,warmup:0},{...value,elapsedNs:22},{...value,checksum:'7ff8000000000000'}])
  assert.throws(()=>nativeResult(JSON.stringify(bad),2,1,value.checksum));
 assert.throws(()=>nativeResult(JSON.stringify(value)+'\n{}',2,1,value.checksum));
});

test('heap placement belongs only to the measured executable argv',()=>{
 const argv=heapCommand(['/program','2'],'/helper.so',101,'/fresh/heap.jsonl');
 assert.deepEqual(argv,['/usr/bin/env','LD_PRELOAD=/helper.so','NTS_LAYOUT_HEAP_SEED=101','NTS_LAYOUT_HEAP_REPORT=/fresh/heap.jsonl','/program','2']);
 assert.throws(()=>heapCommand(['/program'],'relative.so',101,'/fresh/heap.jsonl'));
 assert.throws(()=>heapCommand(['/program'],'/helper.so',0,'/fresh/heap.jsonl'));
});

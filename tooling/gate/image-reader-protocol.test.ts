import assert from 'node:assert/strict';
import {test} from 'node:test';
import {imageReaderFrame,readImageReaderFrames,IMAGE_READER_FRAME_BYTES,imageReaderReply,IMAGE_READER_REPLY_BYTES} from './image-reader-protocol.ts';

async function* chunks(bytes:Buffer,width:number){for(let at=0;at<bytes.length;at+=width)yield bytes.subarray(at,at+width);}
async function decoded(bytes:Buffer,width=17){const rows=[];for await(const row of readImageReaderFrames(chunks(bytes,width)))rows.push(row);return rows;}
test('image reader frames preserve consecutive large requests across arbitrary pipe boundaries',async()=>{
  const rows=[{request:1,argv:'a'.repeat(48*1024),environment:'x'.repeat(48*1024)},
    {request:2,argv:'b'.repeat(48*1024),environment:'🌲'.repeat(20*1024)}];
  const wire=Buffer.concat(rows.map(imageReaderFrame));assert.ok(wire.length>96*1024);
  for(const width of [3,4096,65536])assert.deepEqual(await decoded(wire,width),rows);
});
test('image reader frames refuse short headers, short bodies and malformed JSON by name',async()=>{
  const wire=imageReaderFrame({request:'complete'});
  await assert.rejects(decoded(wire.subarray(0,3)),/short frame.*header/);
  await assert.rejects(decoded(wire.subarray(0,-1)),/short frame.*body/);
  const malformed=Buffer.from([0,0,0,1,123]);await assert.rejects(decoded(malformed),/malformed JSON frame/);
});
test('image reader frames accept the exact bound and refuse invalid sizes before allocating a body',async()=>{
  for(const size of [0,IMAGE_READER_FRAME_BYTES+1]){
    const header=Buffer.alloc(4);header.writeUInt32BE(size);await assert.rejects(decoded(header),/invalid frame length/);
  }
  assert.throws(()=>imageReaderFrame(undefined),/not JSON/);
  const exact='x'.repeat(IMAGE_READER_FRAME_BYTES-2),wire=imageReaderFrame(exact);
  assert.equal(wire.length,IMAGE_READER_FRAME_BYTES+4);
  assert.deepEqual(await decoded(wire,65536),[exact]);
  assert.throws(()=>imageReaderFrame('x'.repeat(IMAGE_READER_FRAME_BYTES-1)),/exceeds its bound/);
});

test('image reader replies accept their exact bound and refuse one extra byte',async()=>{
  const exact='x'.repeat(IMAGE_READER_REPLY_BYTES-2),wire=imageReaderReply(exact);
  assert.equal(wire.length,IMAGE_READER_REPLY_BYTES+4);
  assert.deepEqual(await decoded(wire,65536),[exact]);
  assert.throws(()=>imageReaderReply(exact+'x'),/exceeds its bound/);
});

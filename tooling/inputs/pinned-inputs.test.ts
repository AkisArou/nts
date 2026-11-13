import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {testScratch} from '../gate/test-scratch.ts';
import {acquirePinnedInput,pinnedInput,pinnedInputCache,pinnedInputFile,readPinnedInput} from './pinned-inputs.ts';

const bytes=Buffer.from('a pinned Unicode source\n');
const catalog={version:1,inputs:{sample:{url:'https://example.invalid/source.txt',sha256:createHash('sha256').update(bytes).digest('hex'),version:'17.0.0'}}};
const input=pinnedInput('sample',catalog);

test('only explicit acquisition fetches, and every offline read verifies the actual bytes',async t=>{
  const cache=testScratch(t,'pinned-inputs');let calls=0;
  const fetcher:typeof fetch=async url=>{assert.equal(url,input.url);calls++;return new Response(bytes);};
  assert.throws(()=>readPinnedInput(input,{cache}),/missing sample.*--acquire sample/);
  assert.equal(calls,0);
  const file=await acquirePinnedInput(input,{cache,fetcher});
  assert.equal(file,pinnedInputFile(input,cache));assert.equal(calls,1);
  assert.deepEqual(readPinnedInput(input,{cache}),bytes);
  await acquirePinnedInput(input,{cache,fetcher});assert.equal(calls,1,'a verified immutable input needs no network');
  const record=JSON.parse(readFileSync(file,'utf8'));
  record.bytesBase64=Buffer.from('changed cached content').toString('base64');writeFileSync(file,JSON.stringify(record));
  assert.throws(()=>readPinnedInput(input,{cache}),/sample SHA-256 mismatch/);
  await assert.rejects(acquirePinnedInput(input,{cache,fetcher}),/sample SHA-256 mismatch/);
  assert.equal(calls,1,'corruption is refused rather than silently replaced');
});

test('a bad acquisition never publishes a usable cache row',async t=>{
  const cache=testScratch(t,'pinned-input-failure');
  await assert.rejects(acquirePinnedInput(input,{cache,fetcher:async()=>new Response('wrong bytes')}),/sample SHA-256 mismatch/);
  assert.equal(existsSync(pinnedInputFile(input,cache)),false);
  await assert.rejects(acquirePinnedInput(input,{cache,fetcher:async()=>new Response(null,{status:503})}),/cannot acquire sample.*HTTP 503/);
  assert.equal(existsSync(pinnedInputFile(input,cache)),false);
});

test('an unsupported content record survives acquisition byte for byte',async t=>{
  const cache=testScratch(t,'pinned-input-version'),file=pinnedInputFile(input,cache),record='{"version":2,"future":"owned elsewhere"}\n';
  writeFileSync(file,record);
  const fetcher:typeof fetch=async()=>{throw Error('future content must not fetch');};
  await assert.rejects(acquirePinnedInput(input,{cache,fetcher}),/invalid content record.*left untouched/);
  assert.equal(readFileSync(file,'utf8'),record);
});

test('fixtures require an explicit cache capability, including an empty marker',()=>{
  assert.throws(()=>pinnedInputCache({NTS_TEST_ENVIRONMENT:''}),/fixture cache capability missing: NTS_PINNED_INPUTS_CACHE/);
  assert.equal(pinnedInputCache({NTS_TEST_ENVIRONMENT:'',NTS_PINNED_INPUTS_CACHE:'/private/pins'}),'/private/pins');
});

test('the catalog owns a valid exact HTTPS source identity',()=>{
  const real=pinnedInput('unicode-idna-17');assert.equal(real.version,'17.0.0');
  assert.equal(real.sha256,'beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf');
  assert.throws(()=>pinnedInput('missing',catalog),/invalid catalog entry/);
  assert.throws(()=>pinnedInput('sample',{...catalog,version:2}),/invalid catalog entry/);
  assert.throws(()=>pinnedInput('sample',{version:1,inputs:{sample:{...catalog.inputs.sample,url:'http://example.invalid'}}}),/HTTPS/);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {projectSummary} from './summary-facts.ts';

test('summary projection validates chunked JSON and keeps only bounded decision facts',()=>{
  const text=JSON.stringify({schema:1,started:'2026-11-25',wall_s:3,verdict:'green',interrupted:null,
    environment:{canonical:true},scope_cleanup:{state:'complete'},case_costs:{version:1,status:'partial',error_count:0,errors:[],steps:{x:{cases:['é\\\"😀',1e20,null,true]}}}}).replace('"schema"','"sch\\u0065ma"');
  const bytes=Buffer.from(text);
  for(const width of [1,2,7,65536]){
    function* chunks(){for(let at=0;at<bytes.length;at+=width)yield bytes.subarray(at,at+width);}
    const result=projectSummary(chunks());
    assert.equal(result.digest,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.bytes,bytes.length);
    assert.deepEqual(result.facts.get('schema'),{kind:'scalar',value:1});
    assert.deepEqual(result.facts.get('case_costs.errors'),{kind:'array',empty:true});
    assert.deepEqual(result.facts.get('case_costs.steps'),{kind:'object',empty:false});
    assert.ok(!result.facts.has('case_costs.steps.x'));
  }
});

for(const text of ['{"ignored":[1,]}','{"ignored":"bad\\q"}','{"ignored":"bad\\u00x0"}',
  '{"ignored":"unterminated','{"ignored":01}','{"ignored":true false}','{"ignored":{"x":1,}}',
  '{"schema":1,"sch\\u0065ma":1}','{} trailing','[]','{"schema":"'+ 'a'.repeat(4096)+'"}',
  '{"ignored":'+ '['.repeat(258)+'0'+']'.repeat(258)+'}'])test('invalid or ambiguous summary refuses: '+text.slice(0,60),()=>{
  assert.throws(()=>projectSummary([Buffer.from(text)]));
});

test('invalid UTF-8 in an ignored population refuses',()=>{
  assert.throws(()=>projectSummary([Buffer.from('{"ignored":"'),Uint8Array.of(0xff),Buffer.from('"}')]));
});

test('ignored strings beyond V8 whole-string capacity remain bounded',()=>{
  const block=Buffer.alloc(65536,97),repeats=8193; // 536,936,448 characters, beyond V8's 536,870,888.
  function* chunks(){yield Buffer.from('{"schema":1,"ignored":"');for(let n=0;n<repeats;n++)yield block;yield Buffer.from('"}');}
  const result=projectSummary(chunks());
  assert.ok(result.bytes>536870888);
  assert.equal(result.facts.size,2);
  assert.deepEqual(result.facts.get('schema'),{kind:'scalar',value:1});
});

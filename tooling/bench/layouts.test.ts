import test from "node:test";
import assert from "node:assert/strict";
import {body,compareLayouts,layoutDeltas,orderingWarnings,spread,symbolOrder,textSymbols} from "./layouts.ts";
import {readOnlyConstants} from "./layouts-elf.ts";
import {experiment} from "./layouts-plan.ts";
import {rangeTable} from "./layouts-record.ts";

test("per-layout delta range retains both winning and losing draws",()=>{
  const deltas=layoutDeltas([0.825,0.92,0.97,1.02,1.111].map((ratio,i)=>({timeA:1000+i,timeB:(1000+i)*ratio})));
  assert.ok(Math.abs(deltas.min+0.175)<1e-12);
  assert.ok(Math.abs(deltas.max-0.111)<1e-12);
  assert.ok(Math.abs(deltas.span-0.286)<1e-12);
  assert.throws(()=>layoutDeltas([{timeA:0,timeB:1}]));
});

test("layout mode rejects unequal work, duplicate coverage and invalid plans before linking",()=>{
  const pair={name:'words',backend:'c',n:10,checksum:'3ff0000000000000',arms:['base','contents'].map(name=>({name,command:'clang++',args:['input.o','-fuse-ld=lld'],cwd:'/build',hot:['work']}))};
  const plan={seeds:[101,307,509,701,907],pairs:[pair,{...pair,backend:'llvm'}]};
  assert.equal(experiment(plan),plan);
  assert.throws(()=>experiment({...plan,seeds:[1,2,3,4,4]}));
  assert.throws(()=>experiment({...plan,pairs:[pair,pair]}));
  assert.throws(()=>experiment({...plan,pairs:[pair,{...pair,backend:'llvm',n:11}]}));
  assert.throws(()=>experiment({...plan,pairs:[{...pair,checksum:'7ff8000000000000'}]}));
  assert.throws(()=>experiment({...plan,pairs:[{...pair,arms:[]}]}));
});

test("range publication rejects incomplete or duplicate sittings",()=>{
  const values=[900,950,1000,1050,1100],measurements=spread(values);
  const summary={name:'words',backend:'llvm',layouts:[101,307,509,701,907].map((seed,i)=>({seed,timeA:values[i],timeB:values[i],rounds:Array(5).fill({timeA:values[i],timeB:values[i]})})),time:{base:measurements,changed:measurements,ratio:1,floor:0.2,verdict:'inside layout floor'}};
  const checkpoint={state:'PASS',current:null,completed:85};
  assert.match(rangeTable(checkpoint,[summary]),/20\.00%\/20\.00%/);
  assert.throws(()=>rangeTable({...checkpoint,state:'FAIL'},[summary]));
  assert.throws(()=>rangeTable({...checkpoint,current:{}},[summary]));
  assert.throws(()=>rangeTable({...checkpoint,completed:84},[summary]));
  assert.throws(()=>rangeTable({...checkpoint,completed:170},[summary,summary]));
  assert.throws(()=>rangeTable(checkpoint,[{...summary,time:{...summary.time,ratio:0.8}}]));
  assert.throws(()=>rangeTable(checkpoint,[{...summary,time:{...summary.time,base:{...measurements,mean:900}}}]));
});

test("anonymous RIP constants compare by bytes without erasing changed arithmetic",()=>{
  const image=Buffer.alloc(512);image.set([0x7f,0x45,0x4c,0x46,2,1]);image.writeUInt16LE(62,18);
  image.writeBigUInt64LE(64n,32);image.writeUInt16LE(56,54);image.writeUInt16LE(1,56);
  image.writeUInt32LE(1,64);image.writeUInt32LE(4,68);image.writeBigUInt64LE(0x1000n,80);image.writeBigUInt64LE(512n,96);
  image.writeDoubleLE(-0,128);
  const nm="1070 4 r near_string",symbol={name:"work",address:0x2000,bytes:8};
  const line="2000: vmovsd xmm0,QWORD PTR [rip+0x78] # 1080 <near_string+0x10>";
  const original=body(line,symbol,readOnlyConstants(image,nm));
  assert.match(original,/constant:8:0000000000000080/);
  const changed=Buffer.from(image);changed.writeDoubleLE(0,128);
  assert.notEqual(original,body(line,symbol,readOnlyConstants(changed,nm)));
  assert.equal(readOnlyConstants(image,nm)(0x1070,"near_string",1),undefined);
  changed.writeUInt32LE(6,68);
  assert.equal(readOnlyConstants(changed,nm)(0x1080,"near_string+0x10",8),undefined);
  assert.throws(()=>readOnlyConstants(Buffer.alloc(3),""));
});

test("only documented ordering diagnostics can survive a successful link",()=>{
  const warning="ld.lld: warning: <internal>: unable to order undefined symbol: internalized\n";
  assert.deepEqual(orderingWarnings(warning),[warning.trim()]);
  assert.deepEqual(orderingWarnings(""),[]);
  assert.equal(orderingWarnings(warning+"ld.lld: warning: unresolved relocation\n"),null);
  assert.equal(orderingWarnings("ld.lld: error: undefined symbol: missing"),null);
});

test("orders reproduce and preserve exactly the common symbol population",()=>{
  const names=Array.from({length:100},(_,i)=>"function_"+i);
  const orders=[101,307,509,701,907].map(seed=>symbolOrder(names,seed));
  assert.equal(new Set(orders.map(o=>o.join("\n"))).size,5);
  for(const [index,order] of orders.entries()){
    assert.deepEqual(order.toSorted(),names.toSorted());
    assert.deepEqual(order,symbolOrder(names.toReversed(),[101,307,509,701,907][index]));
  }
  assert.throws(()=>symbolOrder(names,0));
  assert.throws(()=>symbolOrder(["same","same"],1));
});

test("only actual sized text functions enter the ordering",()=>{
  assert.deepEqual(textSymbols("00001000 00000020 T work\n00002000 00000008 d data\n U malloc\n00003000 00000010 t helper"),[
    {name:"helper",address:0x3000,bytes:16},{name:"work",address:0x1000,bytes:32}
  ]);
  assert.throws(()=>textSymbols(" U missing"));
  assert.throws(()=>textSymbols("1000 10 T work\n2000 10 T work"));
});

test("placement normalizes while registers, constants and internal offsets stay evidence",()=>{
  const old="1000: mov eax,0x1234\n1005: lea rdi,[rip+0x25] # 1030 <words>\n100c: call 2000 <helper>\n1011: ret";
  const moved="3000: mov eax,0x1234\n3005: lea rdi,[rip+0x95] # 30a0 <words>\n300c: call 9000 <helper>\n3011: ret";
  const a={name:"work",address:0x1000,bytes:18},b={...a,address:0x3000};
  assert.equal(body(old,a),body(moved,b));
  assert.notEqual(body(old,a),body(moved.replace("0x1234","0x1235"),b));
  assert.notEqual(body(old,a),body(moved.replace("eax","edx"),b));
  assert.notEqual(body(old,a),body(moved.replace("3011:","3010:"),b));
  assert.throws(()=>body("",a));
});

test("layout decisions use means and include layout spread, not the best link",()=>{
  const result=compareLayouts([90,100,110,100,100],[100,90,100,110,100],0.01);
  assert.equal(result.ratio,1);assert.equal(result.floor,0.2);
  assert.equal(result.verdict,"inside layout floor");
  assert.equal(compareLayouts([100,100,100,100,100],[80,80,80,80,80],0.01).verdict,"improves");
  assert.equal(compareLayouts([100,100,100,100,100],[111,111,111,111,111],0.01).verdict,"REGRESSES");
  assert.throws(()=>compareLayouts([100],[90],0));
  assert.throws(()=>spread([NaN]));assert.throws(()=>spread([0]));
});

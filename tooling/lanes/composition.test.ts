import{test}from"node:test";
import assert from"node:assert/strict";
import{compose}from"./composition.ts";
const a={id:"a",sha:"a",at:2},b={id:"b",sha:"b",at:1},c={id:"c",sha:"c",at:0};
const ancestor=(x:string,y:string)=>"abc".indexOf(x)<"abc".indexOf(y);
test("a reverse-queued stack composes ancestors first with each landing's own range",()=>{
 const planned=compose([c,b,a],ancestor);
 assert.deepEqual(planned.map(p=>p.entry.id),["a","b","c"]);
 assert.deepEqual(planned.map(p=>p.from),[undefined,"a","b"]);
 assert.deepEqual(planned[2].prerequisites.map(p=>p.id),["a","b"]);
 assert.deepEqual(planned.slice(0,2).map(p=>p.entry.id),["a","b"],"train limits apply after ancestry ordering");
});
test("unrelated tips and equal-tip aliases retain submission order",()=>{
 const alias={...a,id:"alias",at:3};
 assert.deepEqual(compose([alias,c,b,a],()=>false).map(p=>p.entry.id),["c","b","a","alias"]);
 assert.equal(compose([a,alias],()=>true)[1].from,undefined);
});
test("inconsistent ancestry fails closed",()=>{
 assert.throws(()=>compose([a,b],()=>true),/cyclic/);
 assert.throws(()=>compose([a,a],ancestor),/duplicate/);
});

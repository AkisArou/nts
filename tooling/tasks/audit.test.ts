import assert from "node:assert/strict";
import { test } from "node:test";
import { audit, capture, cycles, parseRowLists, type Issue, type Snapshot, type Options } from "./audit.ts";
import { renderCard } from "./spec.ts";
import type { Gh } from "./new.ts";
const now="2026-11-10T18:00:00Z";
const stream:Issue={number:1,title:"Stream",labels:["area:compiler","kind:parent"],state:"OPEN",parent:null,children:[2],updatedAt:now,body:"The stream."};
const group:Issue={number:2,title:"Group",labels:["area:compiler","kind:group"],state:"OPEN",parent:1,children:[3],updatedAt:now,body:renderCard({Goal:"Prove the layout",Why:"The row loses",Design:"docs/foundations/objects.md",Parts:"- [ ] One change","Done when":"The group is at the bar","Tests and rows":"Existing benchmark identifiers: arrays. Fixture tests/programs/bitwise",Parent:"#1"})};
const task:Issue={number:3,title:"One layout fix",labels:["task","area:compiler","kind:wrong-answer"],state:"OPEN",parent:2,children:[],updatedAt:now,body:renderCard({Goal:"Fix the answer",Why:"The fixture differs",Paths:"compiler/core/src/hir/layout.rs","Done when":"The paired fixture agrees","Tests and rows":"tests/programs/bitwise",Parent:"#2"})};
const snapshot=():Snapshot=>({version:1,complete:true,capturedAt:now,issues:structuredClone([stream,group,task]),branches:["3-layout"]});
const options:Options={streams:[1],cases:["arrays"],rows:[{page:"docs/foundations/objects.md",name:"objects",rows:["arrays"]}],exists:()=>true};
const codes=(s:Snapshot,o=options)=>audit(s,o).findings.map(f=>f.code);

test("a complete stream/group/task snapshot has no drift",()=>{assert.deepEqual(audit(snapshot(),options).findings,[]);});
test("wrong roles, prose parents and closed groups cannot hide open work",()=>{
 const s=snapshot();s.issues[2]!.parent=1;s.issues[1]!.state="CLOSED";
 const found=codes(s);assert.ok(found.includes("parent-role"));assert.ok(found.includes("parent-card"));assert.ok(found.includes("closed-parent"));
});
test("wanted held or unscoped leaves stay visible without task",()=>{
 const s=snapshot();s.issues[2]!.labels=["area:compiler","kind:wrong-answer","state:held"];s.issues[2]!.body=renderCard({Goal:"Wanted work",Paths:"to scope when taken",Parent:"#2"});
 assert.ok(!codes(s).includes("labels"));s.issues[2]!.labels.unshift("task");assert.ok(codes(s).includes("labels"));assert.ok(codes(s).includes("card"));
});
test("cycles are diagnosed with no depth cutoff, including dependency cycles",()=>{
 const chain=new Map<number,number[]>();for(let n=0;n<10000;n++)chain.set(n,[n+1]);chain.set(10000,[9999]);assert.deepEqual(cycles(chain),[[9999,10000,9999]]);
 const s=snapshot();s.issues[1]!.body=renderCard({...importCard(group.body),"Depends on":"#3"});s.issues[2]!.body=renderCard({...importCard(task.body),"Depends on":"#2"});assert.ok(codes(s).includes("dependency-cycle"));
});
import { parseCard } from "./spec.ts";
function importCard(body:string){return parseCard(body).card;}
test("missing row ownership, stale IDs and missing controls are separate findings",()=>{
 const found=codes(snapshot(),{...options,cases:["arrays","new-row"],rows:[{page:"docs/foundations/objects.md",name:"objects",rows:["deleted-row"]}],exists:()=>false});
 for(const code of ["unowned-row","stale-row","fixture","design"])assert.ok(found.includes(code),code);
 const s=snapshot();s.issues[1]!.body=s.issues[1]!.body.replace("identifiers: arrays.","identifiers: missing.");assert.ok(codes(s).includes("row"));
});
test("incomplete/auth/rate-limited snapshots cannot be clean",()=>{
 const s={...snapshot(),complete:false,reason:"GitHub rate limit"};const r=audit(s,options);assert.equal(r.complete,false);assert.ok(r.errors>0);assert.equal(r.findings[0]!.code,"incomplete");
 const duplicate=snapshot();duplicate.issues.push({...duplicate.issues[0]!});assert.equal(audit(duplicate,options).complete,false);
});
test("active protections report deferred drift and never change snapshot data",()=>{
 const s=snapshot();s.issues[2]!.parent=1;const before=JSON.stringify(s);const r=audit(s,{...options,protected:[3]});assert.equal(JSON.stringify(s),before);assert.ok(r.findings.some(f=>f.issue===3&&f.protected&&f.severity==="info"));
});
test("old ready backlog is informational and a closed branch remains visible",()=>{
 const s=snapshot();s.branches=["99-missing"];s.issues[2]!.updatedAt="2026-10-01T00:00:00Z";const r=audit(s,options);
 assert.equal(r.findings.find(f=>f.code==="queue-age")!.severity,"info");assert.ok(r.findings.some(f=>f.code==="branch-issue"));
});

/** The stand-in rejects every possible write; children paginate independently. */
function github(fail=false){
 const calls:string[][]=[];
 const node=(number:number,hasNext=false)=>({number,title:`Issue ${number}`,body:"body",state:"OPEN",updatedAt:now,closedAt:null,labels:{nodes:[],pageInfo:{hasNextPage:false}},parent:null,subIssues:{nodes:hasNext?[{number:8}]:[],pageInfo:{hasNextPage:hasNext,endCursor:hasNext?"child-1":null}}});
 const run:Gh=args=>{
  calls.push([...args]);
  if(args[0]==="repo")return "o/r";
  assert.equal(args[0],"api");assert.ok(!args.some(a=>a.includes("mutation")),"audit has no mutation adapter");
  if(args.includes("--method")){assert.equal(args[args.indexOf("--method")+1],"GET");return JSON.stringify([[{name:"3-layout"}],[{name:"main"}]]);}
  if(fail)throw Error("GitHub rate limit");
  const q=args.find(a=>a.startsWith("query="))!;
  if(q.includes("issue(number:"))return JSON.stringify({data:{repository:{issue:{subIssues:{nodes:[{number:9}],pageInfo:{hasNextPage:false,endCursor:null}}}}}});
  const second=args.includes("cursor=issue-1");return JSON.stringify({data:{repository:{issues:{totalCount:2,nodes:[node(second?2:1,!second)],pageInfo:{hasNextPage:!second,endCursor:second?null:"issue-1"}}}}});
 };return{run,calls};
}
test("capture paginates issues, sub-issues and branches with read-only calls",()=>{
 const g=github(),s=capture(g.run,now);assert.equal(s.complete,true);assert.deepEqual(s.issues.map(i=>i.number),[1,2]);assert.deepEqual(s.issues[0]!.children,[8,9]);assert.deepEqual(s.branches,["3-layout","main"]);assert.ok(g.calls.some(a=>a.includes("cursor=issue-1")));assert.ok(g.calls.some(a=>a.includes("cursor=child-1")));
});
test("a capture failure remains explicitly incomplete with partial evidence",()=>{const s=capture(github(true).run,now);assert.equal(s.complete,false);assert.match(s.reason!,/rate limit/);});

test("canonical rows ignore prose and fenced examples, and stop at the next section",()=>{
 const text="- `prose`\n## Rows\n### maps\n- `map-and-set`\n```md\n- `example`\n```\n## Evidence\n- `not-a-row`\n";
 assert.deepEqual(parseRowLists("docs/foundations/objects.md",text),[{page:"docs/foundations/objects.md",name:"maps",rows:["map-and-set"]}]);
});

test("a task's local branch counts even when it was never pushed",()=>{
 const s=snapshot();s.branches=[];s.refs=["3-layout"];s.issues[2]!.updatedAt="2026-10-01T00:00:00Z";
 assert.ok(!codes(s).includes("queue-age"));
});

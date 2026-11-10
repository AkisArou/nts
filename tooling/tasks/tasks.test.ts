// Shared card, role, creation and label contracts, against a read/write gh stand-in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrafts, draftProblems, prepareDrafts, cliDraft, type Draft, type Gh } from "./new.ts";
import { sync, syncPlan } from "./labels.ts";
import { bodyProblems, labelProblems, readSpec, renderCard, REQUIRED, parseCard, parentProblems } from "./spec.ts";
import { BRANCH, issueBranch, issueOfBranch, slugOf } from "./branch.ts";
import { issuesNamed, withFixes } from "./links.ts";
const spec=readSpec();
const card=renderCard({Goal:"Compile one control",Why:"The fixture fails",Paths:"compiler/core/src/hir/flow.rs","Done when":"The control agrees","Tests and rows":"tests/programs/bitwise",Parent:"Group"});
const parent:Draft={n:1,title:"Stream",labels:["area:tooling","kind:parent"],parent:null,body:"The stream.\n"};
const group:Draft={n:2,id:"new:group",title:"Group",labels:["area:tooling","kind:group"],parent:"Stream",body:renderCard({Goal:"Hold the final design",Why:"Several changes",Design:"docs/workflow.md",Parts:"- [ ] One final change","Done when":"All wanted parts land","Tests and rows":"No throughput benchmark applies; tooling/tasks/tasks.test.ts checks the contract",Parent:"Stream"})};
const child:Draft={n:3,title:"Do one thing",labels:["task","area:tooling","kind:foundation"],parent:"Group",body:card};

test("roles retain one area/kind and optional state, with task only on an unblocked leaf",()=>{
 assert.deepEqual(spec.rules,{area:"exactly one",kind:"exactly one",state:"at most one"});
 assert.deepEqual(labelProblems(child.labels,spec),[]);
 assert.deepEqual(labelProblems(["area:compiler","kind:abort"],spec),[],"unready wanted work stays visible");
 assert.match(labelProblems([...child.labels,"state:held"],spec).join(),/cannot carry task/);
 assert.match(labelProblems(["task",...group.labels],spec).join(),/not a task/);
 assert.match(labelProblems(["task",...parent.labels],spec).join(),/not a task/);
 assert.match(labelProblems(["task","kind:abort"],spec).join(),/exactly one area/);
 assert.match(labelProblems(["area:compiler","kind:abort","kind:refusal"],spec).join(),/exactly one kind/);
 assert.match(labelProblems(["area:compiler","kind:abort","state:held","state:parked"],spec).join(),/at most one state/);
 assert.match(labelProblems(["bug","area:compiler","kind:abort"],spec).join(),/unknown label/);
});
test("one parser enforces nonempty sections/order in CLI and browser forms",()=>{
 assert.deepEqual(bodyProblems(card,["task"]),[]);assert.equal(REQUIRED.length,5);
 assert.deepEqual(bodyProblems("free text",parent.labels),[]);
 assert.match(bodyProblems(card.replace("**Done when:** The control agrees","**Done when:**"),["task"]).join(),/no Done when/);
 assert.match(bodyProblems(card.replace("**Paths:** compiler/core/src/hir/flow.rs","**Paths:** to scope when taken"),["task"]).join(),/concrete Paths/);
 const browser=card.replace(/^\*\*([^*]+):\*\* (.*)$/gm,"### $1\n$2");assert.deepEqual(bodyProblems(browser,["task"]),[]);
 assert.match(bodyProblems(card+"\n**Why:** repeated\n",["task"]).join(),/repeats Why/);
 assert.match(bodyProblems("**Why:** why\n\n"+card,["task"]).join(),/out of order/);
 assert.deepEqual(bodyProblems(group.body,group.labels),[]);
 assert.match(bodyProblems(group.body.replace(/\*\*Tests and rows:\*\*[^\n]*/,"**Tests and rows:**"),group.labels).join(),/no Tests and rows/);
 assert.equal(parseCard(browser).card.Parent,"Group");
});
test("a batch is stream/group/leaf, with symbolic ids and cycles rejected",()=>{
 assert.deepEqual([...draftProblems([child,group,parent],spec)],[]);
 assert.deepEqual([...draftProblems([parent,group,{...child,parent:"new:group",body:card.replace("Parent:** Group","Parent:** {{issue:new:group}}") }],spec)],[]);
 assert.match(draftProblems([parent,child],spec).get(3)!.join(),/not resolved/);
 assert.match(draftProblems([parent,group,{...child,parent:"Stream",body:card.replace("Parent:** Group","Parent:** Stream")}],spec).get(3)!.join(),/group parent/);
 assert.match(draftProblems([parent,group,{...child,parent:null}],spec).get(3)!.join(),/group parent/);
 assert.match(draftProblems([parent,group,child,{...child,n:4}],spec).get(4)!.join(),/not unique/);
 assert.match(draftProblems([{...group,parent:"Do one thing"},child],spec).get(2)!.join(),/cycle/);
});

function fakeGh(initial:{number:number;title:string;labels?:string[];body?:string;state?:string;parent?:number|null}[]=[]){
 const issues=initial.map(i=>({...i,labels:i.labels??group.labels,body:i.body??group.body,state:i.state??"OPEN",parent:i.parent??null}));
 const calls:string[][]=[],made:{title:string;body:string;labels:string[]}[]=[],links:[string,string][]=[];
 const run:Gh=(args,input)=>{
  calls.push([...args]);const [a,b]=args;
  if(a==="issue"&&b==="list")return JSON.stringify(issues);
  if(a==="repo")return "o/r\n";
  if(a==="issue"&&b==="view"){
   if(args.includes("--jq"))return `ID_${args[2]}\n`;
   const i=issues.find(i=>i.number===Number(args[2]));if(!i)throw Error("unknown issue");
   return JSON.stringify({...i,id:`ID_${i.number}`,labels:i.labels.map(name=>({name}))});
  }
  if(a==="issue"&&b==="create"){
   const title=args[args.indexOf("--title")+1]!,labels=args.flatMap((arg,k)=>arg==="--label"?[args[k+1]!]:[]),number=500+issues.length;
   made.push({title,body:input!,labels});issues.push({number,title,labels,body:input!,state:"OPEN",parent:null});return `https://github.com/o/r/issues/${number}\n`;
  }
  if(a==="api"){
   if(args.some(a=>a.startsWith("query=mutation"))){const p=args.find(a=>a.startsWith("p="))!,c=args.find(a=>a.startsWith("c="))!;links.push([p,c]);issues.find(i=>`c=ID_${i.number}`===c)!.parent=Number(p.replace("p=ID_",""));return "{}";}
   const n=Number(args.find(a=>a.startsWith("n="))!.slice(2));return JSON.stringify({data:{repository:{issue:{parent:issues.find(i=>i.number===n)!.parent===null?null:{number:issues.find(i=>i.number===n)!.parent}}}}});
  }
  throw Error(`unexpected gh ${args.join(" ")}`);
 };return{run,calls,made,links};
}
test("create checks numeric parent roles read-only before any issue mutation",()=>{
 const g=fakeGh([{number:472,title:"Stream",labels:parent.labels}]);
 const invalid={...child,parent:472,body:card.replace("Parent:** Group","Parent:** #472")};
 assert.throws(()=>createDrafts([invalid],g.run,()=>{},0),/group parent/);
 assert.equal(g.made.length,0);assert.ok(g.calls.every(a=>a[0]==="issue"&&a[1]==="view"));
 const good=fakeGh([{number:700,title:"Group",labels:group.labels}]);
 assert.deepEqual(prepareDrafts([{...child,parent:700,body:card.replace("Parent:** Group","Parent:** #700")}],good.run).map(d=>d.n),[3]);
 assert.match(parentProblems(child.labels,{number:1,title:"closed",state:"CLOSED",labels:group.labels}).join(),/closed/);
});
test("parent-first creation writes links and records each partial effect before linking",()=>{
 const g=fakeGh(),effects:string[]=[];
 const made=createDrafts([child,group,parent],g.run,()=>{},0,e=>effects.push(JSON.stringify(e)));
 assert.deepEqual(made.map(e=>e.number),[500,501,502]);
 assert.match(g.made[1]!.body,/Parent:\*\* #500/);assert.match(g.made[2]!.body,/Parent:\*\* #501/);
 assert.equal(g.links.length,2);assert.ok(effects.some(e=>e.includes('"linked":false')));assert.ok(made.every(e=>e.linked));
});
test("closed or changed existing titles are never blindly skipped",()=>{
 const p={number:700,title:"Group",labels:group.labels},body=card.replace("Parent:** Group","Parent:** #700");
 for(const state of ["CLOSED","OPEN"]){const g=fakeGh([p,{number:701,title:child.title,body:state==="OPEN"?body+"changed":body,labels:child.labels,state,parent:700}]);
 assert.throws(()=>createDrafts([{...child,parent:700,body}],g.run,()=>{},0),/differs or is closed/);assert.equal(g.made.length,0);}
});
test("CLI roles use the same parent/card contract as batches",()=>{
 const args=["--role","task","--kind","foundation","--area","tooling","--title","A task","--parent","700","--goal","g","--why","w","--paths","tooling/tasks/","--done","d","--tests","t"];
 assert.ok(cliDraft(args).labels.includes("task"));assert.ok(!cliDraft([...args,"--state","held"]).labels.includes("task"));
 assert.ok(!cliDraft([...args,"--unready"]).labels.includes("task"));
 assert.throws(()=>cliDraft(args.map(x=>x==="foundation"?"group":x)),/role disagrees/);
});

test("the label sync makes what is missing, writes what changed, and only reports a label the file lacks", () => {
  const have = [{ name: "task", color: "0E8A16", description: spec.labels[0]!.description }, { name: "area:compiler", color: "ffffff", description: "old" }, { name: "bug", color: "d73a4a", description: "x" }];
  const plan = syncPlan(spec, have);
  assert.ok(!plan.make.some(label => label.name === "task"), "a colour differing only in case is the same");
  assert.deepEqual(plan.edit.map(label => label.name), ["area:compiler"]);
  assert.deepEqual(plan.extra, ["bug"]);
  assert.equal(plan.make.length, spec.labels.length - 2);
});

test("--prune deletes a label the file lacks, and says how many issues carry it; without it nothing is deleted", () => {
  const calls: string[][] = [];
  const have = [...spec.labels, { name: "wontfix", color: "ffffff", description: "x" }];
  const run: Gh = args => {
    calls.push([...args]);
    if (args[0] === "label" && args[1] === "list") return JSON.stringify(have);
    if (args[1] === "list" && args.includes("--label")) return JSON.stringify(args[0] === "issue" ? [{ number: 1 }, { number: 2 }] : [{ number: 3 }]);
    return "";
  };
  const lines: string[] = [];
  sync(run, spec, { dry: false, prune: false }, line => lines.push(line));
  assert.ok(!calls.some(args => args[1] === "delete"), "no --prune: nothing is deleted");
  assert.deepEqual(lines, ["kept, not in .github/labels.json: wontfix"]);
  calls.length = 0; lines.length = 0;
  sync(run, spec, { dry: false, prune: true }, line => lines.push(line));
  assert.deepEqual(calls.filter(args => args[1] === "delete"), [["label", "delete", "wontfix", "--yes"]]);
  assert.deepEqual(lines, ["delete wontfix (carried by 3 issue(s) or pull request(s))"]);
  calls.length = 0;
  sync(run, spec, { dry: true, prune: true }, () => {});
  assert.ok(!calls.some(args => args[1] === "delete"), "a dry run deletes nothing");
});

test("a task's branch is its issue number and a slug, and only the number counts", () => {
  assert.equal(issueBranch(516, "LLVM: at least as fast as C"), "516-llvm-at-least-as-fast-as-c");
  assert.equal(issueBranch(42), "42");
  assert.equal(issueOfBranch("516-llvm-linkage-nsw"), 516);
  assert.equal(issueOfBranch("42"), 42);
  for (const branch of ["compiler/llvm-linkage-nsw", "0516-x", "516-", "516-X", "516--x", "x-516", "main"]) assert.equal(issueOfBranch(branch), null, branch);
  assert.throws(() => issueBranch(0), /positive integer/);
  assert.equal(slugOf("Map and Set: by the proven layout, their contents", 4), "map-and-set-by");
  assert.ok(BRANCH.test("547-records-listed-kinds"));
});

test("a commit names its issue as closed, with GitHub's keywords, or as Part of it; a bare mention or a longer number does not count", () => {
  assert.deepEqual(issuesNamed("gate: one ledger\n\nFixes #590\n"), [590]);
  assert.deepEqual(issuesNamed("Closes: #12, resolved #13 and fixed #14"), [12, 13, 14]);
  assert.deepEqual(issuesNamed("records: by kind\n\nPart of #547\n\nFixes #547\n"), [547], "each issue once");
  assert.deepEqual(issuesNamed("see #590, the pull request #69 and T335"), []);
  assert.deepEqual(issuesNamed("Fixes #5900"), [5900]);
  assert.ok(!issuesNamed("Fixes #5900").includes(590), "#5900 is not #590");
});

test("Fixes #N goes in a paragraph of its own, ahead of the trailers", () => {
  const trailer = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
  assert.equal(withFixes(`tasks: a thing\n\nWhy it is.\n\n${trailer}\n`, 42), `tasks: a thing\n\nWhy it is.\n\nFixes #42\n\n${trailer}\n`);
  assert.equal(withFixes(`tasks: a thing\n\n${trailer}\n  continued\nSigned-off-by: A <a@b>`, 42), `tasks: a thing\n\nFixes #42\n\n${trailer}\n  continued\nSigned-off-by: A <a@b>\n`);
  assert.equal(withFixes("tasks: a thing", 42), "tasks: a thing\n\nFixes #42\n", "a subject alone");
  assert.equal(withFixes("docs: the rule\n\nNote: a paragraph, not trailers.\nIt goes on.\n", 7), "docs: the rule\n\nNote: a paragraph, not trailers.\nIt goes on.\n\nFixes #7\n");
  assert.equal(withFixes("fix: the subject looks like one\n", 7), "fix: the subject looks like one\n\nFixes #7\n", "the subject is never a trailer block");
  assert.deepEqual(issuesNamed(withFixes(`a\n\n${trailer}`, 42)), [42]);
  assert.throws(() => withFixes("a", 0), /positive integer/);
});

test("a misspelled dry-run flag and unknown options cannot accidentally create issues",()=>{
 assert.throws(()=>cliDraft(["--dry-runn"]),/unknown argument/);
 assert.throws(()=>cliDraft(["--title"]),/needs a value/);
 assert.throws(()=>cliDraft(["--kind","foundation","--kind","abort"]),/duplicate/);
});
test("symbolic dependencies are resolved and cyclic tasks are refused before writes",()=>{
 const a={...child,n:8,id:"a",title:"A",body:renderCard({...parseCard(card).card,"Depends on":"{{issue:b}}"})};
 const b={...child,n:9,id:"b",title:"B",body:renderCard({...parseCard(card).card,"Depends on":"{{issue:a}}"})};
 assert.match(draftProblems([parent,group,a,b],spec).get(8)!.join(),/dependency cycle/);
});

test("symbolic dependencies are created first and rendered as real issue numbers",()=>{
 const a={...child,n:8,id:"a",title:"A",body:renderCard({...parseCard(card).card,"Depends on":"{{issue:b}}"})};
 const b={...child,n:9,id:"b",title:"B"};const g=fakeGh();
 createDrafts([a,b,group,parent],g.run,()=>{},0);
 assert.deepEqual(g.made.map(i=>i.title),["Stream","Group","B","A"]);
 assert.match(g.made[3]!.body,/Depends on:\*\* #502/);
 assert.throws(()=>cliDraft(["--parent","0"]),/positive issue number/);
});

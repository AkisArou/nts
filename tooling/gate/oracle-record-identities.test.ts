import assert from "node:assert/strict";
import {mkdirSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {test,type TestContext} from "node:test";
import {domainDeclaration,fixtureOf,readRecords,recordPath,writeRecords,type OracleIdentityInputs,type OracleRow} from "../differential/oracle-records.ts";
import {findPending} from "../records/record-pending.ts";
import {domainConstraints,oracleIdentityProblems,oracleIdentityScope,oracleSourceDigests} from "./oracle-record-identities.ts";
import {testScratch} from "./test-scratch.ts";
import {fixtureEnvironment} from "./test-environment.ts";
import {ToolingInstrumentError} from "./step-result.ts";

function fixture(t:TestContext){
  const root=testScratch(t,"oracle-identity"),source="tests/programs/subject/src/main.ts";
  mkdirSync(dirname(join(root,source)),{recursive:true});mkdirSync(join(root,"benchmarks/cases"),{recursive:true});
  writeFileSync(join(root,source),"export function work(n:number):number{return n;}\n");
  writeFileSync(join(root,"tests/programs/subject/tsconfig.json"),'{"files":["src/main.ts"]}');
  const row:OracleRow={kind:"measured",source,signature:"a".repeat(64),keys:{jvm:"b".repeat(32)},cases_sha256:"c".repeat(64),driver_sha256:"d".repeat(64),count:2,complete:true};
  writeRecords(root,{version:1,generator_version:1,generator_digest:"e".repeat(32),seed:null,rows:[row]});
  return {root,source,row,env:fixtureEnvironment(t),domain:join(root,source).replace(/\.ts$/,".domains.json")};
}
const declaration=()=>({version:1,functions:{work:{n:{min:0,max:4,integer:true,reason:"a finite workload"}}}});

test("adding a domain without deleting the old population is red; deletion makes that fixture pending",t=>{
  const f=fixture(t);
  assert.deepEqual(oracleIdentityProblems(f.root,readRecords(f.root).rows,f.env),[]);
  assert.deepEqual(findPending(f.root,"oracle-counts"),[]);
  writeFileSync(f.domain,JSON.stringify(declaration()));
  const errors=oracleIdentityProblems(f.root,readRecords(f.root).rows,f.env);
  assert.equal(errors.length,1);assert.match(errors[0]!,/input_domain changed; delete this fixture's oracle record/);
  assert.deepEqual(findPending(f.root,"oracle-counts"),[],"the retained stale row used to hide this pending work");
  rmSync(join(f.root,recordPath(fixtureOf(f.source))));
  assert.deepEqual(oracleIdentityProblems(f.root,readRecords(f.root).rows,f.env),[]);
  assert.deepEqual(findPending(f.root,"oracle-counts").map(one=>one.name),["tests/programs/subject"]);
});

test("domain bounds and flags are identity inputs; explanation, defaults and formatting are not",t=>{
  const f=fixture(t),value=declaration();
  f.row.input_domain={identity:"f".repeat(32),declaration:domainDeclaration(value)};
  writeFileSync(f.domain,JSON.stringify(value));
  assert.deepEqual(oracleIdentityProblems(f.root,[f.row],f.env),[]);
  const reworded={version:1,functions:{work:{n:{reason:"the same domain explained",allowNaN:false,integer:true,max:4,min:0}}}};
  writeFileSync(f.domain,JSON.stringify(reworded,null,4));
  assert.deepEqual(oracleIdentityProblems(f.root,[f.row],f.env),[]);
  assert.equal(domainConstraints(domainDeclaration(reworded)),domainConstraints(f.row.input_domain.declaration));
  for(const changed of [{...reworded.functions.work.n,max:5},{...reworded.functions.work.n,integer:false},{...reworded.functions.work.n,allowNaN:true}]){
    writeFileSync(f.domain,JSON.stringify({version:1,functions:{work:{n:changed}}}));
    assert.match(oracleIdentityProblems(f.root,[f.row],f.env)[0]!,/input_domain changed/);
  }
  rmSync(f.domain);
  assert.match(oracleIdentityProblems(f.root,[f.row],f.env)[0]!,/input_domain changed/);
});

test("a recorded source_digest is rechecked from owned bytes, while measured body changes keep their population",t=>{
  const f=fixture(t),digest=oracleSourceDigests(f.root,[f.source],f.env).get(f.source)!;
  const identity:OracleIdentityInputs={source:f.source,source_digest:digest,signature:f.row.signature,keys:f.row.keys,cases_sha256:f.row.cases_sha256,driver_sha256:f.row.driver_sha256};
  assert.deepEqual(oracleIdentityProblems(f.root,[identity],f.env),[]);
  writeFileSync(join(f.root,f.source),"export function work(n:number):number{return n+1;}\n");
  assert.match(oracleIdentityProblems(f.root,[identity],f.env)[0]!,/source_digest changed/);
  assert.deepEqual(oracleIdentityProblems(f.root,[f.row],f.env),[],"a measured row carries no body-only empty-oracle exception");
  for(const name of ["keys","signature","cases_sha256","driver_sha256"])assert.ok(oracleIdentityScope().split("require native plans: ")[1]?.includes(name));
});

test("an incomplete source hash observation is an instrument failure, never stale identity evidence",t=>{
  const f=fixture(t);
  for(const stdout of ["", "not-a-digest  "+f.source, "a".repeat(32)+"  another-source"]){
    assert.throws(()=>oracleSourceDigests(f.root,[f.source],f.env,request=>{
      assert.equal(request.command,"xxhsum");assert.deepEqual(request.args,["-H128","--",f.source]);
      return {pid:0,status:0,signal:null,stdout,stderr:"",output:[null,stdout,""]};
    }),error=>error instanceof ToolingInstrumentError&&/oracle source_digest/.test(error.message));
  }
});

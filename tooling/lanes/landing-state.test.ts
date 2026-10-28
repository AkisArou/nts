import {test} from "node:test"; import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";import {join} from "node:path";
import {queuedLandings} from "./landing-state.ts";
test("status combines durable and legacy entries while omitting all recorded dispositions",t=>{
 const base=join(homedir(),".cache/nts-scratch/landing-state");mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,"run-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const dir of ["pending","queue","results","submission-dispositions","withdrawals"])mkdirSync(join(root,dir));
 for(const [id,dir]of [["new","pending"],["old","queue"],["landed","queue"],["refused","queue"]])writeFileSync(join(root,dir,id+".json"),JSON.stringify({id,sha:id,tree:id,at:0}));
 writeFileSync(join(root,"results/landed.json"),JSON.stringify({state:"landed"}));writeFileSync(join(root,"submission-dispositions/refused.json"),JSON.stringify({state:"refused"}));writeFileSync(join(root,"withdrawals/new.json"),"{}");
 const rows=queuedLandings(root,120000);assert.deepEqual(rows.map(r=>r.id).sort(),["new","old"]);assert.equal(rows.find(r=>r.id==="new").withdrawalRequested,true);
});

import assert from "node:assert/strict";
import {appendFileSync} from "node:fs";

import {join} from "node:path";
import {test} from "node:test";
import {capped} from "./attempt262.ts";
import {materialise, workspace} from "./project.ts";
import {outputOracle} from "./output-oracle.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {removeOracleSnapshot} from '../differential/oracle-emit.ts';

import {setupOracleTestEnvironment} from '../differential/oracle-test-fixture.ts';

await setupOracleTestEnvironment();

for (const language of ["js", "ts"] as const) for (const module of [false, true]) {
  test(`the ${language} output oracle preserves the ${module ? "module" : "script"} source goal and harness`, async () => {
    const scratch = newTestScratch("output-oracle-case");
    try {
      const project = workspace(join(scratch, "project"), language);
      const source = `/*---\nflags: [${module ? "module" : ""}]\n---*/\nassert.sameValue(2 + 2, 4); assert.sameValue(this === undefined, ${language === "ts" || module}); console.log("before"); console.error("error"); try { console.log("body"); } finally { console.log("finally"); }`;
      materialise(project, source, undefined, language);
      const tools = { language, memoryCapKb: 6_000_000 };
      const result = (await outputOracle(project, scratch, source, tools, (command, args) => capped(tools, command, args)));
      assert.deepEqual(result, { ok: true, output: { stdout: "before\nbody\nfinally\n", stderr: "error\n" } });
    } finally { removeOracleSnapshot(scratch); }
  });
}

test('a census harness snapshot finalizes before an output verdict escapes',async t=>{
  for(const changed of [false,true])await t.test(changed?'changed original harness':'unchanged control',async()=>{
    const scratch=newTestScratch('output-oracle-finalization');
    try{
      const project=workspace(join(scratch,'project'),'js'),source='assert.sameValue(2+2,4);console.log(19);';
      materialise(project,source,undefined,'js');
      const tools={language:'js',memoryCapKb:6_000_000};let launches=0;
      const result=await outputOracle(project,scratch,source,tools,(command,args)=>{
        launches++;if(changed)appendFileSync(join(project,'src/harness.ts'),'\n// changed original after preparation\n');
        return capped(tools,command,args);
      });
      assert.equal(launches,1,'the subject reaches the real Node launch boundary');
      t.diagnostic(JSON.stringify({changed,result}));
      if(changed){assert.equal(result.ok,false,'a changed original cannot publish a census verdict');if(!result.ok)assert.match(result.why,/snapshot finalization held|filesystem file changed/);}
      else assert.deepEqual(result,{ok:true,output:{stdout:'19\n',stderr:''}});
    }finally{removeOracleSnapshot(scratch);}
  });
});

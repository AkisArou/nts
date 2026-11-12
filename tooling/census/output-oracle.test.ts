import assert from "node:assert/strict";
import {appendFileSync,existsSync,readFileSync,writeFileSync} from "node:fs";

import {join} from "node:path";
import {test} from "node:test";
import {capped} from "./attempt262.ts";
import {materialise, workspace} from "./project.ts";
import {outputOracle} from "./output-oracle.ts";
import {waitFor} from "../gate/test-wait.ts";
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

test('the terminal file publishes while a subject grandchild still runs',async()=>{
  const scratch=newTestScratch('output-oracle-grandchild'),live=join(scratch,'grandchild-live'),release=join(scratch,'grandchild-release'),ended=join(scratch,'grandchild-ended');
  // The grandchild owns a release barrier, and inherits neither output pipes nor
  // a terminal-record fd. The driver's atomic file is independent of its life.
  const grandchild=`const fs=require('node:fs');
const [live,release,ended]=process.argv.slice(1);
const finish=()=>{if(!fs.existsSync(release))return;watch.close();fs.unlinkSync(live);fs.writeFileSync(ended,'ended');};
const watch=fs.watch(require('node:path').dirname(release),finish);
fs.writeFileSync(live,'alive');process.send('ready');finish();`;
  const source=`/*---\nflags: [module]\n---*/
const {spawn}=process.getBuiltinModule('node:child_process');
const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)},${JSON.stringify(live)},${JSON.stringify(release)},${JSON.stringify(ended)}],{stdio:['ignore','ignore','ignore','ipc']});
await new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',resolve);});
child.disconnect();child.unref();console.log('subject finished');`;
  try{
    const project=workspace(join(scratch,'project'),'js');materialise(project,source,undefined,'js');
    const tools={language:'js',memoryCapKb:6_000_000};
    const result=await outputOracle(project,scratch,source,tools,(command,args)=>capped(tools,command,args));
    assert.deepEqual(result,{ok:true,output:{stdout:'subject finished\n',stderr:''}});
    assert.equal(readFileSync(live,'utf8'),'alive','the grandchild remains behind its barrier');
    assert.deepEqual(JSON.parse(readFileSync(join(scratch,'output-oracle-terminal.json'),'utf8')),{complete:true});
  }finally{
    writeFileSync(release,'finish the owned grandchild');
    if(existsSync(live))await waitFor('the terminal control grandchild to exit',()=>existsSync(ended));
    removeOracleSnapshot(scratch);
  }
});

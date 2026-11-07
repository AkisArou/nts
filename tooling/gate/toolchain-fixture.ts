// A private installation proves which executable a launch selected. Other
// invocations run the test's real Node; no host installation is created.
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";

export function nodeInstallation(installations:string,pin:string,log:string,reported=pin):string{
  const node=join(installations,pin,"bin/node");mkdirSync(dirname(node),{recursive:true});
  writeFileSync(node,`#!${process.execPath}
import {appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');
if(process.argv[2]==='--version')console.log(${JSON.stringify("v"+reported)});
else {const result=spawnSync(${JSON.stringify(process.execPath)},process.argv.slice(2),{env:process.env,stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status??1;}
`,{mode:0o755});
  return node;
}

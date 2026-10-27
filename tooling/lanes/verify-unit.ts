// Explicitly start ONE idle-only shadow batch using immutable, landed tooling.
import {spawnSync} from "node:child_process";
import {mkdirSync,mkdtempSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {systemdEnvironment} from "../gate/environment.ts";

function checked(command:string,args:string[],cwd:string):string {
  const result=spawnSync(command,args,{cwd,encoding:"utf8"});
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}
try {
  if (process.argv.length !== 2) throw new Error("usage: node tooling/lanes/verify-unit.ts (one manual shadow batch)");
  const root=checked("git",["rev-parse","--show-toplevel"],process.cwd());
  const sha=checked("git",["rev-parse","HEAD"],root);
  checked("git",["merge-base","--is-ancestor",sha,"main"],root);
  const directory=join(homedir(),".cache/nts-land/verification/submissions");mkdirSync(directory,{recursive:true});
  const submission=mkdtempSync(join(directory,"shadow-")),tree=join(submission,"tree"),log=join(submission,"verify.log");
  checked("git",["worktree","add","--detach",tree,sha],root);
  checked("sh",[join(tree,"tooling/lanes/inputs.sh"),"lane",root,tree],root);
  checked("systemd-run",["--user","--collect","--quiet","--unit=nts-verify-shadow",`--working-directory=${tree}`,
    `--property=StandardOutput=file:${log}`,`--property=StandardError=file:${log}`,"--property=Nice=19",
    `--property=LimitCORE=${process.env.NTS_COREDUMPS === "1" ? "infinity" : "0"}`,
    ...systemdEnvironment(),process.execPath,join(tree,"tooling/lanes/verify.ts")],root);
  console.log(`one shadow batch requested as nts-verify-shadow\nlog: ${log}`);
} catch (error) {console.error(`verify-unit: ${String(error)}`);process.exitCode=1;}

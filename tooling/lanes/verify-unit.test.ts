import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync,spawnSync} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

function fixture(t:{after(fn:()=>void):void}) {
  const directory=mkdtempSync(join(tmpdir(),"verify-unit-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=join(directory,"repo"),home=join(directory,"home"),bin=join(directory,"bin"),capture=join(directory,"args.json");
  mkdirSync(join(root,"tooling/lanes"),{recursive:true});mkdirSync(home);mkdirSync(bin);
  writeFileSync(join(bin,"systemd-run"),`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE,JSON.stringify(process.argv.slice(2)));\n`,{mode:0o755});
  writeFileSync(join(root,"tooling/lanes/inputs.sh"),'test "$1" = lane\n');
  writeFileSync(join(root,"tooling/lanes/verify.ts"),'throw new Error("launcher must not run a gate itself");\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith("GIT_") && !k.startsWith("NTS_")));
  Object.assign(env,{HOME:home,PATH:`${bin}:${process.env.PATH}`,CAPTURE:capture,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"});
  const git=(...args:string[])=>execFileSync("git",args,{cwd:root,env,encoding:"utf8"}).trim();
  git("init","-qb","main");git("add","tooling");git("commit","-qm","landed verifier");
  const launch=()=>spawnSync(process.execPath,[new URL("./verify-unit.ts",import.meta.url).pathname],{cwd:root,env,encoding:"utf8"});
  return {root,capture,git,launch};
}

test("manual launcher starts one immutable shadow unit with normal environment",t=>{
  const f=fixture(t),sha=f.git("rev-parse","HEAD"),result=f.launch();assert.equal(result.status,0,result.stderr);
  const args=JSON.parse(readFileSync(f.capture,"utf8")) as string[];
  assert.ok(args.includes("--unit=nts-verify-shadow"));assert.ok(args.includes("--property=LimitCORE=0"));
  assert.ok(args.includes("--property=Nice=19"));assert.equal(args.some(a=>/Restart|NTS_JOBS|NTS_GATE_SLOTS|NTS_GATE_JOBS/.test(a)),false);
  const tree=args.find(a=>a.startsWith("--working-directory="))!.slice("--working-directory=".length);
  assert.equal(execFileSync("git",["rev-parse","HEAD"],{cwd:tree,encoding:"utf8"}).trim(),sha);
  assert.match(args.at(-1)!,/tooling\/lanes\/verify\.ts$/);
});

test("unlanded verifier tooling cannot start a shadow run",t=>{
  const f=fixture(t);f.git("switch","-qc","tsrs/unreviewed");writeFileSync(join(f.root,"feature"),"change");
  f.git("add","feature");f.git("commit","-qm","not landed");
  const result=f.launch();assert.equal(result.status,1);assert.equal(existsSync(f.capture),false);
});

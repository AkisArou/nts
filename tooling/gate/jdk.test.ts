import assert from "node:assert/strict";
import {test} from "node:test";
import {existsSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {chooseJdk,declaredJdk,isDeclaredJdk,resolveJdk,type JdkIdentity} from "./jdk.ts";
import {gateEnvironment,reportEnvironment} from "./canonical-environment.ts";
import {newTestScratch} from "./test-scratch.ts";
import {removable} from "./run-temporary.ts";
import {ownMemory} from "./test-memory.ts";
import {fixtureEnvironment} from "./test-environment.ts";

const DECLARED=['IMPLEMENTOR="Amazon.com Inc."','JAVA_RUNTIME_VERSION="21.0.5+11-LTS"'];
const identity:JdkIdentity={lines:DECLARED,name:"Amazon.com Inc. 21.0.5+11-LTS"};

function scratch(t:{after(fn:()=>void):void},name:string):string {
  const dir=newTestScratch(name);t.after(()=>{removable(dir);rmSync(dir,{recursive:true,force:true});});return dir;
}
/** A JDK home with the tools build.sh runs and the given release lines. */
function jdk(home:string,release:string[],tools=["javac","jar"]):string {
  mkdirSync(join(home,"bin"),{recursive:true});
  for(const tool of tools)writeFileSync(join(home,"bin",tool),"#!/bin/sh\nexit 0\n",{mode:0o755});
  writeFileSync(join(home,"release"),[...release,'JAVA_VERSION="x"',""].join("\n"));
  return home;
}

test("the tree declares the JDK that built its runtime jar, by its release identity",()=>{
  const declared=declaredJdk();
  assert.ok(declared);
  assert.deepEqual(declared.lines,DECLARED);
  assert.equal(declared.name,"Amazon.com Inc. 21.0.5+11-LTS");
});

test("a declaration other than the two release lines is refused by name",t=>{
  const root=scratch(t,"jdk-declaration");mkdirSync(join(root,"runtime/jvm"),{recursive:true});
  const file=join(root,"runtime/jvm/jdk.txt");
  writeFileSync(file,'# comment\nIMPLEMENTOR="Amazon.com Inc."\n');
  assert.throws(()=>declaredJdk(root),/must name IMPLEMENTOR and JAVA_RUNTIME_VERSION/);
  writeFileSync(file,'IMPLEMENTOR="Amazon.com Inc."\nJAVA_VERSION="21"\n');
  assert.throws(()=>declaredJdk(root),/expected one line each of IMPLEMENTOR and JAVA_RUNTIME_VERSION/);
  rmSync(file);
  assert.equal(declaredJdk(root),undefined);
});

test("only a JDK whose release file has both declared lines exactly is the declared one",t=>{
  const root=scratch(t,"jdk-identity");
  assert.equal(isDeclaredJdk(jdk(join(root,"match"),DECLARED),identity),true);
  assert.equal(isDeclaredJdk(jdk(join(root,"newer"),['IMPLEMENTOR="Arch Linux"','JAVA_RUNTIME_VERSION="27"']),identity),false);
  assert.equal(isDeclaredJdk(jdk(join(root,"vendor"),['IMPLEMENTOR="Eclipse Adoptium"',DECLARED[1]!]),identity),false);
  assert.equal(isDeclaredJdk(jdk(join(root,"version"),[DECLARED[0]!,'JAVA_RUNTIME_VERSION="21.0.6+7-LTS"']),identity),false);
  assert.equal(isDeclaredJdk(jdk(join(root,"unquoted"),['IMPLEMENTOR=Amazon.com Inc.',DECLARED[1]!]),identity),false);
  assert.equal(isDeclaredJdk(jdk(join(root,"runtime-only"),DECLARED,["java"]),identity),false);
  assert.equal(isDeclaredJdk(join(root,"absent"),identity),false);
});

test("the declared JDK is found among installations whatever JAVA_HOME the launcher names",t=>{
  const root=scratch(t,"jdk-resolve"),asdf=join(root,"asdf"),system=join(root,"system");
  const other=jdk(join(system,"java-27-openjdk"),['IMPLEMENTOR="Arch Linux"','JAVA_RUNTIME_VERSION="27"']);
  const installed=jdk(join(asdf,"corretto-21.0.5.11.1"),DECLARED);
  for(const launcher of [{JAVA_HOME:other},{},{JAVA_HOME:join(root,"missing")}])
    assert.equal(resolveJdk(identity,launcher,[asdf,system]),installed);
  // A launcher already on the declared JDK keeps its exact spelling.
  const own=jdk(join(root,"own"),DECLARED);
  assert.equal(resolveJdk(identity,{JAVA_HOME:own},[asdf,system]),own);
  assert.equal(resolveJdk(identity,{JAVA_HOME:other},[system]),undefined);
});

test("choosing points JAVA_HOME and JDK_HOME at the declared JDK, or leaves the launcher's",t=>{
  const root=scratch(t,"jdk-choose"),installed=jdk(join(root,"installs/corretto"),DECLARED);
  const host:NodeJS.ProcessEnv={JAVA_HOME:"/other",JDK_HOME:"/other"};
  assert.deepEqual(chooseJdk(host,host,new URL("../..",import.meta.url).pathname,[join(root,"installs")]),
    {identity:identity.name,home:installed,declared:true});
  assert.equal(host.JAVA_HOME,installed);assert.equal(host.JDK_HOME,installed);
  const none:NodeJS.ProcessEnv={JAVA_HOME:"/other"};
  assert.deepEqual(chooseJdk(none,none,new URL("../..",import.meta.url).pathname,[]),{identity:identity.name,home:"/other",declared:false});
  assert.equal(none.JAVA_HOME,"/other");
});

test("a canonical environment runs the declared JDK and its report names the path",t=>{
  const root=scratch(t,"jdk-gate"),installs=join(root,"installs");
  const installed=jdk(join(installs,"corretto"),DECLARED);
  const other=jdk(join(root,"java-27"),['IMPLEMENTOR="Arch Linux"','JAVA_RUNTIME_VERSION="27"']);
  const base=fixtureEnvironment(t),owned=ownMemory(join(root,"memory"));
  for(const [name,JAVA_HOME] of [["declared",installed],["other",other],["unset",undefined]] as const){
    const planned=gateEnvironment({...base,JAVA_HOME,JDK_HOME:JAVA_HOME},{run:join(root,"run-"+name),owned,jdkInstallations:[installs]});
    assert.equal(planned.env.JAVA_HOME,installed,name);assert.equal(planned.env.JDK_HOME,installed,name);
    assert.equal(planned.env.PATH!.split(":").indexOf(join(installed,"bin")),1,name);
    assert.deepEqual(planned.report.jdk,{identity:identity.name,home:installed,declared:true});
    assert.equal(planned.report.host.JAVA_HOME,installed);
    let log="";reportEnvironment(planned.report,text=>log+=text);
    assert.match(log,new RegExp(`gate: JDK ${installed} \\(Amazon\\.com Inc\\. 21\\.0\\.5\\+11-LTS`));
    // A step's own canonical child keeps the same JDK.
    const child=gateEnvironment(planned.env,{run:join(planned.temporary.path,"child"),jdkInstallations:[installs]});
    assert.equal(child.env.JAVA_HOME,installed);assert.deepEqual(child.report.jdk,planned.report.jdk);
  }
  const missing=gateEnvironment({...base,JAVA_HOME:other,JDK_HOME:other},{run:join(root,"run-missing"),owned,jdkInstallations:[]});
  assert.equal(missing.env.JAVA_HOME,other);
  assert.deepEqual(missing.report.jdk,{identity:identity.name,home:other,declared:false});
  let log="";reportEnvironment(missing.report,text=>log+=text);
  assert.match(log,/no installed JDK is Amazon\.com Inc\. 21\.0\.5\+11-LTS \(runtime\/jvm\/jdk\.txt\); JAVA_HOME stays .*java-27/);
});

test("build.sh refuses a JDK other than the declared one by name, before compiling",t=>{
  const root=scratch(t,"jdk-build"),other=jdk(join(root,"java-27"),['IMPLEMENTOR="Arch Linux"','JAVA_RUNTIME_VERSION="27"']);
  const script=new URL("../../runtime/jvm/build.sh",import.meta.url).pathname,out=join(root,"out.jar");
  const {JAVA_HOME:_launcher,JDK_HOME:_jdk,...env}=fixtureEnvironment(t);
  const refused=spawnSync("sh",[script,out],{env:{...env,JAVA_HOME:other},encoding:"utf8"});
  assert.equal(refused.status,1,refused.stderr);
  assert.equal(refused.stderr,`runtime/jvm/build.sh: the runtime jar is built by Amazon.com Inc. 21.0.5+11-LTS (runtime/jvm/jdk.txt); JAVA_HOME=${other} is Arch Linux 27\n`);
  const unset=spawnSync("sh",[script,out],{env,encoding:"utf8"});
  assert.equal(unset.status,1,unset.stderr);
  assert.match(unset.stderr,/built by Amazon\.com Inc\. 21\.0\.5\+11-LTS \(runtime\/jvm\/jdk\.txt\); JAVA_HOME is unset/);
  assert.equal(existsSync(out),false);
});

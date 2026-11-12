import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {testScratch} from "../gate/test-scratch.ts";
import {fixtureEnvironment} from "../gate/test-environment.ts";
import {artifactFiles,toolIdentity} from "../gate/artifact-shadow.ts";
import {artifactResult,completeVerifier,verifierEnvironment,type VerifierResult} from "../gate/artifact-reuse.ts";
import {infrastructureProbe} from "../gate/infrastructure-probe.ts";
import {vmToolFlags} from "../jvm/vm-flags.ts";
import {createVerifierDriver,type DriverCommand} from "./jvm-verifier-driver.ts";

test("one compilation serves concurrent projects and the next corpus command; source, javac and class changes are checked",async t=>{
  const root=testScratch(t,"verifier-driver-owner"),source=join(root,"JvmVerify.java"),env=fixtureEnvironment(t);
  writeFileSync(source,"supplied verifier source");
  let version=1,calls=0;
  const run:DriverCommand=async(_command,args)=>{
    calls++;const directory=args[args.indexOf("-d")+1]!;mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,"JvmVerify.class"),"supplied compiled driver "+calls);
    return {status:0,stdout:"",stderr:""};
  };
  const options={root:join(root,"run"),source,javac:"/declared/jdk/bin/javac",env,run,identify:()=>({version})};
  const owner=createVerifierDriver(),[first,second]=await Promise.all([owner(options),owner(options)]);
  assert.deepEqual(first,second);assert.equal(calls,1);
  assert.deepEqual(await createVerifierDriver()(options),first,"a new command validates the run-local manifest");assert.equal(calls,1);
  writeFileSync(join(first.directory,"JvmVerify.class"),"corrupt class");
  await createVerifierDriver()(options);assert.equal(calls,2);
  version++;const changedJdk=await owner(options);assert.notEqual(changedJdk.directory,first.directory);assert.equal(calls,3);
  writeFileSync(source,"changed source");const changedSource=await owner(options);
  assert.notEqual(changedSource.directory,changedJdk.directory);assert.equal(calls,4);
});

test("an incomplete compilation never becomes a driver and a changing source is refused",async t=>{
  const root=testScratch(t,"verifier-driver-refusal"),source=join(root,"JvmVerify.java"),env=fixtureEnvironment(t);
  writeFileSync(source,"source");
  const options={root,source,javac:"/declared/jdk/bin/javac",env,identify:()=>({version:1})};
  await assert.rejects(createVerifierDriver()({...options,run:async()=>({status:1,stdout:"",stderr:"compile failed"})}),/verifier driver javac failed/);
  await assert.rejects(createVerifierDriver()({...options,run:async(_command,args)=>{
    writeFileSync(join(args[args.indexOf("-d")+1]!,"JvmVerify.class"),"class");writeFileSync(source,"changed");
    return {status:0,stdout:"",stderr:""};
  }}),/source or javac changed during compilation/);
});

test("real compiled and source-launched drivers return identical verifier facts, with driver and JDK reuse keys",async t=>{
  const root=testScratch(t,"verifier-driver-real"),parent=fixtureEnvironment(t);
  const java=parent.JAVA_HOME?join(parent.JAVA_HOME,"bin/java"):"/usr/bin/java",env=verifierEnvironment(java,parent);
  assert.ok(env.JAVA_HOME);const javac=join(env.JAVA_HOME,"bin/javac");
  const source=fileURLToPath(new URL("./JvmVerify.java",import.meta.url)),out=join(root,"program");mkdirSync(out);
  const program=join(root,"A.java");writeFileSync(program,'public class A { static { if (true) throw new Error("must not initialize"); } public int value() { return 2; } }');
  const command=(executable:string,args:string[],environment:NodeJS.ProcessEnv=env)=>infrastructureProbe({purpose:"verifier driver wiring",command:executable,args,env:environment});
  command(javac,[...vmToolFlags(javac),"-d",out,program]);
  const driver=await createVerifierDriver()({root:join(root,"run"),source,javac,env,identify:toolIdentity,
    run:async(executable,args,environment)=>command(executable,args,environment)});
  const before=command(java,[...vmToolFlags(java),"-Xverify:all","-cp",out,source,out]);
  const after=command(java,[...vmToolFlags(java),"-Xverify:all","-cp",out+":"+driver.directory,"JvmVerify",out]);
  const facts=({status,signal,stdout,stderr}:typeof before)=>({status,signal,stdout,stderr});
  assert.deepEqual(facts(after),facts(before));assert.equal(after.stdout,"VERIFIED 1 OF 1\n");
  const costs=join(root,"costs");mkdirSync(costs);
  const cacheEnv={...parent,NTS_GATE_SHADOW_DIR:join(root,"cache"),NTS_GATE_CASE_COSTS_DIR:costs,NTS_GATE_STEP:"jvm-verifies",NTS_GATE_RUN_DIR:root};
  let calls=0,identity=driver.identity;
  const inputs=()=>({files:[...artifactFiles(out),...artifactFiles(driver.directory,"verifier-driver")],values:{driver:identity}});
  const fresh=async()=>{calls++;return {result:{status:0,signal:null,error:null,stdout:after.stdout,stderr:after.stderr},cpu_s:null};};
  const accept=(value:unknown):value is VerifierResult=>completeVerifier(value,1);
  await artifactResult("jvm-verifies",inputs,fresh,accept,"A",{env:cacheEnv});
  await artifactResult("jvm-verifies",inputs,fresh,accept,"A",{env:cacheEnv,log:()=>{}});assert.equal(calls,1);
  identity={...identity,javac:{changed:"JDK"}};await artifactResult("jvm-verifies",inputs,fresh,accept,"A",{env:cacheEnv});assert.equal(calls,2);
  identity={...identity,source_sha256:"changed driver"};await artifactResult("jvm-verifies",inputs,fresh,accept,"A",{env:cacheEnv});assert.equal(calls,3);
});

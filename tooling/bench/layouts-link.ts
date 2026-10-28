// Relink immutable ThinLTO inputs with seeded function orders. Caller owns the
// bounded build scope; no workload executes here. Keep shipping flags intact.
import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,statfsSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {body,orderingWarnings,symbolOrder,textSymbols,type Symbol} from "./layouts.ts";
import {readOnlyConstants} from "./layouts-elf.ts";

export type LinkArm={name:string;command:string;args:string[];cwd:string;hot:string[]};
export type LinkPlan={arms:LinkArm[];seeds:number[]};

async function admitted(out:string){
  for(;;){
    const mem=/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo","utf8"));
    const disk=statfsSync(out);
    if(!mem||disk.bavail*disk.bsize<40*1024**3)throw Error("layout admission unavailable");
    if(Number(mem[1])>=14*1024**2)return;
    await new Promise(r=>setTimeout(r,10000));
  }
}

export async function linkLayouts(plan:LinkPlan,out:string){
  if(plan.arms.length!==2||new Set(plan.arms.map(a=>a.name)).size!==2||plan.seeds.length<5||new Set(plan.seeds).size!==plan.seeds.length)throw Error("two arms and five unique seeds required");
  for(const arm of plan.arms)if(!/^[a-zA-Z0-9_-]+$/.test(arm.name)||!arm.hot.length||arm.args.includes("-o"))throw Error("invalid link arm");
  mkdirSync(out);
  const operations:any[]=[],references=new Map<string,{binary:string;symbols:Symbol[];bodies:Map<string,string>}>();
  function run(command:string,args:string[],cwd:string,stem:string,ordering=false){
    const started=new Date().toISOString();
    const r=spawnSync(command,args,{cwd,encoding:"utf8",timeout:180000,maxBuffer:64<<20});
    writeFileSync(stem+".stdout",r.stdout??"");writeFileSync(stem+".stderr",r.stderr??"");
    operations.push({argv:[command,...args],cwd,started,end:new Date().toISOString(),status:r.status,signal:r.signal,error:r.error?.message});
    writeFileSync(join(out,"commands.json"),JSON.stringify(operations,null,2));
    if(r.status!==0||r.signal||r.error||(r.stderr?.trim()&&(!ordering||orderingWarnings(r.stderr)===null)))throw Error("layout command failed: "+stem);
    return r.stdout;
  }
  const inspect=(binary:string,arm:LinkArm,stem:string)=>{
    const nm=run("nm",["-S","--defined-only",binary],arm.cwd,stem+"-nm");
    const symbols=textSymbols(nm),constant=readOnlyConstants(readFileSync(binary),nm);
    const assembly=run("objdump",["-d","--no-show-raw-insn","-Mintel",binary],arm.cwd,stem+"-asm");
    const bodies=new Map<string,string>();
    for(const name of arm.hot){
      const found=symbols.find(s=>s.name===name);if(!found)throw Error("missing hot function: "+name);
      bodies.set(name,body(assembly,found,constant));
    }
    return{binary,symbols,bodies};
  };
  for(const arm of plan.arms){
    await admitted(out);const stem=join(out,arm.name+"-reference"),binary=stem+".bin";
    run(arm.command,[...arm.args,"-o",binary],arm.cwd,stem+"-link");
    references.set(arm.name,inspect(binary,arm,stem));
  }
  const union=[...new Set([...references.values()].flatMap(r=>r.symbols.map(s=>s.name)))];
  const rows:any[]=[];
  for(const seed of plan.seeds){
    const order=symbolOrder(union,seed);
    for(const arm of plan.arms){
      await admitted(out);
      const reference=references.get(arm.name)!;
      const names=new Set(reference.symbols.map(s=>s.name));
      const stem=join(out,arm.name+"-"+seed),ordering=stem+".order",binary=stem+".bin";
      writeFileSync(ordering,order.filter(name=>names.has(name)).join("\n")+"\n");
      run(arm.command,[...arm.args,"-Wl,--symbol-ordering-file="+ordering,"-o",binary],arm.cwd,stem+"-link",true);
      const actual=inspect(binary,arm,stem);
      const hot=arm.hot.map(name=>{
        const found=actual.symbols.find(s=>s.name===name)!;
        if(actual.bodies.get(name)!==reference.bodies.get(name))throw Error("layout changed instructions: "+stem+" "+name);
        return found;
      });
      const warnings=orderingWarnings(readFileSync(stem+"-link.stderr","utf8"))!;
      rows.push({arm:arm.name,seed,binary,ordering,warnings,hot,functions:actual.symbols});
      writeFileSync(join(out,"layouts.json"),JSON.stringify({state:"RUNNING",rows},null,2));
    }
  }
  for(const arm of plan.arms){
    const selected=rows.filter(r=>r.arm===arm.name);
    if(new Set(selected.map(r=>JSON.stringify(r.functions.map((s:Symbol)=>[s.name,s.address])))).size!==plan.seeds.length)throw Error("duplicate link layouts");
    for(const name of arm.hot)if(new Set(selected.map(r=>r.hot.find((s:Symbol)=>s.name===name).address)).size<2)throw Error("hot function did not move: "+name);
  }
  writeFileSync(join(out,"layouts.json"),JSON.stringify({state:"PASS",seeds:plan.seeds,rows},null,2));
  return rows;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [input,out]=process.argv.slice(2);
  if(!input||!out)throw Error("layouts-link.ts <link-plan.json> <fresh output directory>");
  await linkLayouts(JSON.parse(readFileSync(input,"utf8")),resolve(out));
}

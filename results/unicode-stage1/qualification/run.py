from pathlib import Path
import os,subprocess,time,json,sys
root=Path('/home/akisarou/Projects/nts-lanes/helper2-unicode-stage1');p=Path(__file__).parent;cache=Path.home()/'.cache/nts-tmp';rows=[]
while subprocess.check_output(['systemctl','--user','show','nts-helper2-unicode-family-qualification-r2','-p','ActiveState','--value'],text=True).strip() in ['active','activating']:time.sleep(5)
prior=json.loads((cache/'helper2-unicode-family-143/qualification/stages.json').read_text());assert len(prior)==2 and all(r['status']==0 for r in prior),prior
(p/'tmp').mkdir(exist_ok=True)
base={**os.environ,'TMPDIR':str(p/'tmp'),'NTS_CHECKERS':'1','NTS_BIN':str(root/'target/release/nts'),'CARGO_BUILD_JOBS':'4','RUST_TEST_THREADS':'4'}
def run(name,args):
 while int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024<14*2**30:time.sleep(5)
 env=base.copy()
 if name=='dry':
  for key in ['NTS_CHECKERS','NTS_BIN','CARGO_BUILD_JOBS']:env.pop(key,None)
 start=time.time()
 with (p/(name+'.log')).open('w') as f:r=subprocess.run(args,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
 rows.append(dict(name=name,args=args,status=r.returncode,seconds=time.time()-start));(p/'stages.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:sys.exit(r.returncode)
run('fmt',['cargo','fmt'])
run('clang-format',['clang-format','--style=file','--dry-run','-Werror','runtime/c/nts_unicode.c','runtime/c/nts_unicode.h'])
run('build-dev',['cargo','build','--profile','nts-dev','-p','nts-cli'])
run('tests',['cargo','test','--profile','nts-dev','--no-fail-fast','-p','nts-unicode','-p','nts-codegen-c','-p','nts-codegen-llvm','-p','nts-codegen-jvm','-p','nts-bench','-p','nts-frontend-tsrs'])
run('clippy',['cargo','clippy','--workspace','--all-targets','--','-D','warnings'])
run('guards',['node',str(p/'guards.mts')])
for directory,record in [('language','language'),('built-ins','builtins'),('annexB','annexb'),('staging','staging'),('harness','harness')]:
 run('test262-'+record,['node','tooling/census/conformance262.ts','--under','test/'+directory,'--recorded','results/test262/c/'+record+'.tsv','--rows',str(p/(record+'.rows.jsonl')),'--json',str(p/(record+'.json'))])
run('tooling',['bash','tooling/gate/all.sh','--call','tooling'])
run('strict',['node','node_modules/typescript/bin/tsc','--project',str(p/'tsconfig.json')])
run('dry',['node','tooling/lanes/land.ts',subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'--dry-run'])

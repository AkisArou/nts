from pathlib import Path
import os,subprocess,time,json,sys
root=Path('/home/akisarou/Projects/nts-lanes/helper2-unicode-stage1');p=Path(__file__).parent
rows=[]
for name,cmd in [('release',['cargo','build','--release']),('census',['node','tooling/gate/tooling-runner.ts','tooling/gate/unicode-census.test.ts']),('memory',['bash','tooling/memory/run.sh','--case','tests/memory/case-convert-unchanged'])]:
 while int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024<14*2**30:time.sleep(5)
 started=time.time()
 env={**os.environ,'NTS_BIN':str(root/'target/release/nts'),'NTS_CHECKERS':'1','CARGO_BUILD_JOBS':'4','TMPDIR':str(p/'tmp')};(p/'tmp').mkdir(exist_ok=True)
 with (p/(name+'.log')).open('w') as f:r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
 rows.append(dict(name=name,command=cmd,status=r.returncode,seconds=time.time()-started));(p/'stages.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:sys.exit(r.returncode)

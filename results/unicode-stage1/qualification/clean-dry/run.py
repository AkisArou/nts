from pathlib import Path
import subprocess,json,time,os,sys
p=Path(__file__).parent;root=Path('/home/akisarou/Projects/nts-lanes/helper2-unicode-stage1');tip=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip();started=time.time();env=dict(os.environ)
for key in ['NTS_BIN','NTS_CHECKERS','CARGO_BUILD_JOBS','RUST_TEST_THREADS']:env.pop(key,None)
with(p/'dry.log').open('w')as f:r=subprocess.run(['node','tooling/lanes/land.ts',tip,'--dry-run'],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
(p/'result.json').write_text(json.dumps({'tip':tip,'status':r.returncode,'seconds':time.time()-started})+'\n');sys.exit(r.returncode)

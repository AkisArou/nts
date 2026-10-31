from pathlib import Path
import subprocess,os,json,time,hashlib,sys,shutil
p=Path(__file__).parent;root=Path('/home/akisarou/Projects/nts-lanes/helper2-fixed-outcome-guards-c69');pin=Path('/home/akisarou/.cache/nts-pins/c69dfaaaead8/nts');sha='fd93b5ab01c26b4c220423bc993933a4ddf9e22f2e16436d3d46b919034f256a'
assert hashlib.sha256(pin.read_bytes()).hexdigest()==sha
provenance=json.loads(pin.with_name('provenance.json').read_text());assert provenance['sha']=='c69dfaaaead89c6e7498da4effa7720277778b49' and provenance['clean'] and provenance['applied']is None
names=[x['name']for x in json.loads((p/'fix-provenance.json').read_text())];stages=[];snapshots=[]
env={**os.environ,'NTS_BIN':str(pin),'NTS_CHECKERS':'1','TMPDIR':str(p/'tmp')}
for repeat in range(3):
 while int(next(l.split()[1]for l in Path('/proc/meminfo').read_text().splitlines()if l.startswith('MemAvailable:')))*1024<14*2**30:time.sleep(5)
 start=time.time();args=['node','tooling/conformance/outcomes-check.ts','--record',*names]
 with(p/f'record-{repeat}.log').open('w')as out,(p/f'record-{repeat}.err').open('w')as err:r=subprocess.run(args,cwd=root,env=env,stdout=out,stderr=err)
 stage={'repeat':repeat,'command':args,'status':r.returncode,'seconds':time.time()-start,'pin':str(pin),'sha256':sha};stages.append(stage);(p/'stages.json').write_text(json.dumps(stages,indent=2)+'\n');assert r.returncode==0,stage
 snap=p/f'records-{repeat}';snap.mkdir();raw={}
 for name in names:
  f=root/'tests/outcomes'/name/'outcome.json';raw[name]=f.read_bytes();shutil.copyfile(f,snap/(name+'.json'));x=json.loads(raw[name]);assert x['category']=='agrees',(name,x)
 snapshots.append(raw);print('record',repeat,'all11 agree',flush=True)
assert all(s==snapshots[0]for s in snapshots),'measured records differ between fresh runs'
assert all((p/f'record-{i}.log').read_bytes()==(p/'record-0.log').read_bytes()for i in [1,2]),'official stdout differs'
assert all((p/f'record-{i}.err').read_bytes()==(p/'record-0.err').read_bytes()for i in [1,2]),'official stderr differs'
proof={'status':0,'runs':3,'guards':len(names),'allRecordsByteIdentical':True,'officialStdoutByteIdentical':True,'officialStderrByteIdentical':True,'pinProvenance':provenance,'records':{name:hashlib.sha256(data).hexdigest()for name,data in snapshots[0].items()}}
(p/'triple-result.json').write_text(json.dumps(proof,indent=2)+'\n');print('triple byte-exact PASS',flush=True)

import json,pathlib,collections,sys
ROOT=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path('/home/akisarou/.cache/nts-scratch/compiler2/proofs-a')
FLAGS={'-fsanitize=function','-fno-sanitize-recover=function'}
def lines(p):
 return [json.loads(s) for s in p.read_text().splitlines() if s.strip()] if p.exists() else []
def classify(row, suppress_sampler=False):
 folder=pathlib.Path(row['stdout']).parent
 try:report=json.loads(pathlib.Path(row['stdout']).read_text())
 except Exception as e:return dict(category='unmeasured',reason='No valid final report: '+str(e),completed_measurement=False)
 error=report.get('error')
 if error:
  kind=error.get('kind')
  if kind=='native_build':return dict(category='build-failure',reason=error['message'],completed_measurement=False)
  if kind in ('typecheck','oracle_coverage') or kind=='internal' and row['name']=='tests/programs/library' and "Cannot find package '@nts/config'" in error.get('message',''):
   return dict(category='rejected-input',reason=kind+': '+error['message'],completed_measurement=False)
  return dict(category='unmeasured',reason=kind+': '+error['message'],completed_measurement=False)
 counts=report.get('counts') or {};oracle=report.get('oracle') or {}
 closed=bool(oracle.get('complete')) and counts.get('timeouts',0)==0 and not report.get('incomplete') and counts.get('expected',-1)==sum(counts.get(k,0) for k in ('compared','unavailable','runtime_declined'))
 runs=[] if suppress_sampler else lines(folder/'runtime-stderr.jsonl')
 links=[] if suppress_sampler else [x for x in lines(folder/'clang.jsonl') if '-c' not in x.get('args',[]) and '-o' in x.get('args',[]) and pathlib.Path(x['args'][x['args'].index('-o')+1]).name=='check' and FLAGS.issubset(x.get('injected',[]))]
 sampler=bool(runs and links)
 finding=any('runtime error: call to function' in x.get('stderr','') and 'incorrect function type' in x.get('stderr','') for x in runs)
 if finding and sampler:
  return dict(category='function-report',reason='Instrumented runtime reported incompatible function type',sampler_active=sampler,closed_report=closed,completed_measurement=False,runs=len(runs))
 if counts.get('expected')==0 and counts.get('functions')==0 and closed and not runs:
  return dict(category='named-decline' if report.get('refusals') else 'no-runnable-exports',reason='No exported runtime population; no execution claimed',completed_measurement=False,closed_report=True,refusals=report.get('refusals',[]))
 if counts.get('compared',0)==0 and counts.get('unavailable',0)>0 and not runs:
  return dict(category='named-decline',reason='Every available binding was declined before execution',completed_measurement=False,closed_report=closed)
 if not sampler or not closed:
  return dict(category='unmeasured',reason='No sampler-active completed population',sampler_active=sampler,closed_report=closed,completed_measurement=False)
 if counts.get('aborts',0) or counts.get('runtime_declined',0):
  return dict(category='runtime-decline',reason='Sampler observed an explicit runtime decline/abort',sampler_active=True,closed_report=True,completed_measurement=False,runs=len(runs))
 completed=counts.get('compared',0)>0 and all(x.get('status')==0 for x in runs)
 return dict(category='completed' if completed else 'unmeasured',reason='Program ran to completion with sampler active' if completed else 'Runtime did not complete',sampler_active=True,closed_report=True,completed_measurement=completed,runs=len(runs),compared=counts.get('compared'),unavailable=counts.get('unavailable'),disagreements=counts.get('disagreements'))
def load(arm):return json.loads((ROOT/arm/'result.json').read_text())['rows']
def self_test():
 rows=load('function-programs-uniform2')
 wanted=[('rejected-input','tests/programs/invalid'),('build-failure','tests/programs/an-async-generator'),('completed','tests/programs/a-bare-return-where-a-value-is-declared')]
 results=[]
 for expected,name in wanted:
  row=next(x for x in rows if x['name']==name and x['provider']=='nogc');got=classify(row)
  assert got['category']==expected,(expected,got)
  results.append(dict(control=expected,source=row['stdout'],result=got))
 complete=next(x for x in rows if x['name']==wanted[2][1] and x['provider']=='nogc')
 assert classify(complete,True)['category']=='unmeasured'
 # The old structured-report predicate incorrectly classifies the first two controls.
 assert sum(x['control']!='completed' for x in results)==2
 return results
if __name__=='__main__':
 controls=self_test();out=pathlib.Path(__file__).parent
 (out/'controls.json').write_text(json.dumps(dict(controls=controls,missing_sampler_control='unmeasured',old_structured_predicate_fails=2),indent=2)+'\n')
 table={};allrows={}
 for arm in ('function-programs-main1','function-programs-uniform2'):
  rows=[dict(row=row,classification=classify(row)) for row in load(arm)];allrows[arm]=rows
  table[arm]={provider:dict(collections.Counter(x['classification']['category'] for x in rows if x['row']['provider']==provider)) for provider in ('nogc','rc')}
  (out/(arm+'.json')).write_text(json.dumps(rows,indent=2)+'\n')
 (out/'table.json').write_text(json.dumps(dict(table=table,controls='controls.json',note='Raw reports are reclassified, never re-recorded. Findings, runtime declines and named refusals are distinct from completed executions.'),indent=2)+'\n')
 print(json.dumps(table,indent=2))

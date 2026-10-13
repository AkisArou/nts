from pathlib import Path
from collections import Counter
import json,re
p=Path('/home/akisarou/.cache/nts-parallel-20261004/mainctl/tmp/field-reach')
raw=[l.split('\t') for l in (p/'licenses-8677.txt').read_text().splitlines() if l.startswith('NTS_FIELD_LICENSES\t')]
old=json.loads((p/'legacy-queue-final.json').read_text())['rows'];keys={(r['config'],r['face']) for r in old};rows=[];causes=Counter();occurrences=Counter();unique={};clear={'unproven init':'initialization fix','no concrete supplier':'new: supplier/flow proof','missing writable member':'new: member supply','narrow store':'new: storage transport','method-value awaiting D':'D'}
def kind(reason):
 if 'without initialization' in reason:return 'unproven init'
 if reason=='no concrete supplier':return reason
 if 'writable field missing' in reason:return 'missing writable member'
 if 'field write requiring' in reason:return 'narrow store'
 return reason
for r in raw:
 if (r[1],r[2]) not in keys:continue
 reasons=[]
 for part in r[7].split(';'):
  if ': ' not in part:continue
  member,reason=part.split(': ',1);cause=kind(reason);causes[cause]+=1;reasons.append(dict(member=member,reason=reason,cause=cause,cleared_by=clear.get(cause,'new')));unique[(re.sub(r'<\d+>','<N>',r[2]),member,cause)]=reason
 method=int(r[4])==int(r[5])==0
 for cause in set(x['cause'] for x in reasons) or ({'method-value awaiting D'} if method else set()):occurrences[cause]+=1
 rows.append(dict(config=r[1],face=r[2],licensed_fields=int(r[4]),declined_fields=int(r[5]),licensed_members=r[6].split(';') if r[6] else [],reasons=reasons,method_only=method))
assert len(rows)==127
report=dict(candidate_sha='86772bac51bbd960398377f52756f655334039dd',baseline_occurrences=127,licensed_occurrences=sum(r['licensed_fields']>0 for r in rows),fully_licensed_field_occurrences=sum(r['licensed_fields']>0 and r['declined_fields']==0 for r in rows),licensed_fields=sum(r['licensed_fields'] for r in rows),method_only_occurrences=sum(r['method_only'] for r in rows),remaining_field_members_by_cause=dict(causes),occurrences_by_cause=dict(occurrences),dedup_members_by_cause=dict(Counter(k[2] for k in unique)),rows=rows)
(p/'legacy-queue-8677.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='rows'},indent=2))

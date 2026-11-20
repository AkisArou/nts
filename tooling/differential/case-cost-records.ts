// One process may append interleaved sessions. Keep the legacy logical file
// order so regrouping the observations does not reorder summary populations.
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export type CaseCostSession={file:string;name:string;rows:Record<string,unknown>[]};

export function* caseCostSessions(root:string,errors:string[]):Generator<CaseCostSession> {
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const match=/^check-(\d+)(?:-(\d+))?\.jsonl$/.exec(entry.name);
    if(!entry.isFile()||!match)continue;
    const file=join(root,entry.name),legacy=match[2]!==undefined;
    const sessions=new Map<string,Record<string,unknown>[]>();
    try{
      for(const line of readFileSync(file,'utf8').split('\n').filter(Boolean)){
        let row:Record<string,unknown>;
        try{row=JSON.parse(line) as Record<string,unknown>;}
        catch{errors.push(`partial JSON: ${entry.name}`);continue;}
        if(!row||typeof row!=='object'||Array.isArray(row)){
          errors.push(`invalid case observation: ${entry.name}`);continue;
        }
        if(!legacy&&(!Number.isSafeInteger(row.session)||(row.session as number)<0)){
          errors.push(`invalid case session: ${entry.name}`);continue;
        }
        const name=legacy?entry.name:`check-${match[1]}-${row.session}.jsonl`;
        let rows=sessions.get(name);
        if(!rows){rows=[];sessions.set(name,rows);}
        rows.push(row);
      }
      for(const [name,rows] of [...sessions].sort(([a],[b])=>a<b?-1:a>b?1:0))yield {file,name,rows};
    }catch(error){errors.push(`${entry.name}: ${(error as Error).message}`);}
  }
}

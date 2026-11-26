// Sessions may interleave across producers. Consumers sort their derived
// records by name, retaining legacy order without holding all original rows.
import {readdirSync,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';

export type CaseCostSession={file:string;name:string;rows:Record<string,unknown>[]};

export async function* caseCostSessions(root:string,errors:string[]):AsyncGenerator<CaseCostSession> {
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const match=/^check-(\d+)(?:-(\d+))?\.jsonl$/.exec(entry.name);
    const worker=/^check-worker-\d+\.jsonl(?:\.gz)?$/.test(entry.name);
    if(!entry.isFile())continue;
    if(!worker&&/^check-worker-\d+\.jsonl(?:\.gz)?\..+$/.test(entry.name)){errors.push(`incomplete check publication: ${entry.name}`);continue;}
    if(!match&&!worker)continue;
    const file=join(root,entry.name),legacy=match?.[2]!==undefined;
    const sessions=new Map<string,{name:string;rows:Record<string,unknown>[]}>();
    const producers=new Map<string,string>(),completed=new Set<string>();
    const input=createReadStream(file),decoded=entry.name.endsWith('.gz')?input.pipe(createGunzip()):input;
    const lines=createInterface({input:decoded,crlfDelay:Infinity});
    // pipe does not forward a source error to the decoder.
    input.on('error',error=>decoded.destroy(error));
    try{
      for await(const line of lines){
        if(!line)continue;
        let row:Record<string,unknown>;
        try{row=JSON.parse(line) as Record<string,unknown>;}
        catch{errors.push(`partial JSON: ${entry.name}`);continue;}
        if(!row||typeof row!=='object'||Array.isArray(row)){
          errors.push(`invalid case observation: ${entry.name}`);continue;
        }
        let pid=match?.[1],producer='';
        if(worker){
          if(!Number.isSafeInteger(row.producer)||(row.producer as number)<1||!Number.isSafeInteger(row.pid)||(row.pid as number)<1
            ||!row.record||typeof row.record!=='object'||Array.isArray(row.record)){
            errors.push(`invalid worker producer: ${entry.name}`);continue;
          }
          pid=String(row.pid);producer=String(row.producer);row=row.record as Record<string,unknown>;
          const previous=producers.get(producer);
          if(previous!==undefined&&previous!==pid){errors.push(`changed worker producer PID: ${entry.name}`);continue;}
          producers.set(producer,pid);
        }
        if(!legacy&&(!Number.isSafeInteger(row.session)||(row.session as number)<0)){
          errors.push(`invalid case session: ${entry.name}`);continue;
        }
        const name=legacy?entry.name:`check-${pid}-${row.session}.jsonl`,key=producer+':'+name;
        let session=sessions.get(key);
        if(worker&&(completed.has(key)||row.event==='case'&&session)){
          errors.push(`duplicate completed or live case session: ${entry.name}: ${name}`);continue;
        }
        if(!session){session={name,rows:[]};sessions.set(key,session);}
        session.rows.push(row);
        // A worker stream may contain the entire corpus. Release completed
        // sessions immediately; consumers sort their small derived records by
        // legacy name instead of retaining every original phase row.
        if(worker&&row.event==='end'&&row.phase==='check.total'){
          sessions.delete(key);completed.add(key);yield {file,...session};
        }
      }
      for(const session of [...sessions.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0))yield {file,...session};
    }catch(error){errors.push(`${entry.name}: ${(error as Error).message}`);}
    finally{lines.close();decoded.destroy();input.destroy();}
  }
}

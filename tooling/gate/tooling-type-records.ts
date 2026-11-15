// The diagnostic row format is shared by the checker and records transport.
export type DiagnosticCounts=Record<string,number>;
export type ProjectTypeRecord={modules:string[];counts:DiagnosticCounts;source:string};
export type DiagnosticRecord={version:2;projects:Record<string,ProjectTypeRecord>};
export const TOOLING_PROJECT='tooling/tsconfig.json';
export const TOOLING_DIAGNOSTICS='results/tooling-types/diagnostics.json';
const canonical=(name:string)=>name.length>0&&!name.startsWith('/')&&!/[\\\x00-\x1f]/.test(name)&&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
const moduleName=(name:string)=>canonical(name)&&/\.(?:[cm]?[jt]sx?)$/.test(name)&&!name.split('/').includes('node_modules');
export const projectName=(name:string)=>canonical(name)&&/(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(name);
function counts(value:unknown):DiagnosticCounts {
  if(typeof value!=='object'||value===null||Array.isArray(value))throw Error('invalid type diagnostic counts');
  for(const [file,count]of Object.entries(value))if(!moduleName(file)||!Number.isSafeInteger(count)||Number(count)<=0)throw Error('invalid type diagnostic count: '+file);
  return value as DiagnosticCounts;
}
export function parseProjectTypeRecord(value:unknown):ProjectTypeRecord {
  if(typeof value!=='object'||value===null||Array.isArray(value))throw Error('invalid type project row');
  if(Object.keys(value).sort().join()!=='counts,modules,source')throw Error('invalid type project row fields');
  const row=value as {modules?:unknown;counts?:unknown;source?:unknown};
  if(!Array.isArray(row.modules)||row.modules.some(file=>typeof file!=='string'||!moduleName(file))||new Set(row.modules).size!==row.modules.length
      ||typeof row.source!=='string'||!/^sha256:[a-f0-9]{64}$/.test(row.source))throw Error('invalid type project inventory or source identity');
  const actual=counts(row.counts),modules=row.modules as string[];
  if(Object.keys(actual).some(file=>!modules.includes(file)))throw Error('type diagnostic module is outside its project inventory');
  return {modules:[...modules].sort(),counts:actual,source:row.source};
}
export function parseDiagnosticRecord(value:unknown):DiagnosticRecord {
  if(typeof value!=='object'||value===null||Array.isArray(value))throw Error('invalid tooling diagnostic record');
  const record=value as {version?:unknown;modules?:unknown;projects?:unknown};
  if(record.version!==2||typeof record.projects!=='object'||record.projects===null||Array.isArray(record.projects))throw Error('invalid tooling diagnostic record');
  const projects:Record<string,ProjectTypeRecord>={};
  for(const [name,row]of Object.entries(record.projects)){if(!projectName(name))throw Error('invalid type project name: '+name);projects[name]=parseProjectTypeRecord(row);}
  return {version:2,projects};
}
export function projectTypeChanges(actual:ProjectTypeRecord,previous:ProjectTypeRecord,absent:ReadonlySet<string>=new Set()):{problems:string[];improved:string[]} {
  const problems:string[]=[],improved:string[]=[];
  for(const file of previous.modules)if(!actual.modules.includes(file)&&!absent.has(file))problems.push('checked module missing from its project: '+file);
  for(const [file,count]of Object.entries(actual.counts))if(count>(previous.counts[file]??0))problems.push(`${file}: strict diagnostics rose from ${previous.counts[file]??0} to ${count}`);
  for(const [file,count]of Object.entries(previous.counts))if((actual.counts[file]??0)<count)improved.push(`${file}: strict diagnostics fell from ${count} to ${actual.counts[file]??0}`);
  return {problems,improved};
}
export function projectTypeRows(text:string|null):Map<string,string>{
  const record=text===null?{version:2 as const,projects:{}}:parseDiagnosticRecord(JSON.parse(text));
  return new Map(Object.entries(record.projects).sort(([a],[b])=>a.localeCompare(b)).map(([name,row])=>[name,JSON.stringify(row)]));
}
export function mergedProjectTypeRows(text:string|null,updates:ReadonlyMap<string,string>):string {
  const record=text===null?{version:2 as const,projects:{} as Record<string,ProjectTypeRecord>}:parseDiagnosticRecord(JSON.parse(text));
  for(const [name,text]of updates){if(!projectName(name))throw Error('invalid type project name: '+name);record.projects[name]=parseProjectTypeRecord(JSON.parse(text));}
  return serializeDiagnosticRecord(record);
}
export function serializeDiagnosticRecord(record:DiagnosticRecord):string {
  const projects=Object.fromEntries(Object.entries(record.projects).sort(([a],[b])=>a.localeCompare(b)).map(([name,row])=>{
    parseProjectTypeRecord(row);
    return [name,{modules:[...row.modules].sort(),counts:Object.fromEntries(Object.entries(row.counts).filter(([,n])=>n>0).sort()),source:row.source}];
  }));
  return JSON.stringify({version:2,projects},null,2)+'\n';
}

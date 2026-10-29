// Shell native fixtures report their terminal stage once per case. A wall
// guard ends observation; it does not establish a wrong program answer.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publishHung,publishToolingFailure,ToolingInstrumentError} from '../gate/step-result.ts';

export type NativeCase = {stage:'compile'|'elf'|'run';name:string;status:number};
export function parseCases(text:string):NativeCase[] {
 const rows:NativeCase[]=[];
 for(const line of text.trimEnd().split('\n')) {
  const [stage,name,status,...extra]=line.split('\t');
  if(extra.length||!['compile','elf','run'].includes(stage)||!name||!status||!/^(?:0|[1-9]\d{0,2})$/.test(status)||Number(status)>255)
   throw new ToolingInstrumentError('tooling-setup','invalid or empty native case result');
  if(stage!=='run'&&Number(status)===0)throw new ToolingInstrumentError('tooling-setup','a nonterminal native stage cannot establish a pass');
  rows.push({stage:stage as NativeCase['stage'],name,status:Number(status)});
 }
 return rows;
}
export function summarizeCases(cases:NativeCase[]) {
 if(!cases.length)throw new ToolingInstrumentError('tooling-setup','native fixture run recorded no cases');
 const unavailable=cases.filter(row=>row.stage==='run'&&row.status===124);
 const failures=cases.filter(row=>row.status!==0&&!unavailable.includes(row));
 const passed=cases.length-failures.length-unavailable.length;
 return {version:1,verdict:failures.length?'FAIL':unavailable.length?'UNAVAILABLE':'PASS',passed,failures,unavailable,cases};
}
export function publishCases(cases:NativeCase[],env:NodeJS.ProcessEnv=process.env) {
 const result=summarizeCases(cases);
 // Aggregate first: an observed real failure must not be hidden by another
 // case's unavailable measurement. There is one publication per invocation.
 if(result.verdict==='UNAVAILABLE')publishHung('native wall guard ended observation: '+result.unavailable.map(row=>row.name).join(', '),env);
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new ToolingInstrumentError('tooling-setup','native-case-result.ts <cases.tsv> <result.json>');
  const result=publishCases(parseCases(readFileSync(input,'utf8')));
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  process.exitCode=result.verdict==='FAIL'?1:result.verdict==='UNAVAILABLE'?3:0;
 } catch(error) {
  const instrument=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error));
  publishToolingFailure(instrument);console.error(instrument.message);process.exitCode=2;
 }
}

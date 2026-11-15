// Command entries name their own options; inherited policy is never forwarded
// by an environment-wide allowlist. Resource and image handoffs have owners.
import {ToolingInstrumentError} from './step-result.ts';
export type OracleOption='text'|'positive'|'nonnegative'|'integer'|'backend'|'toggle'|'measurement-cpu';
export function oracleCommandOptions(env:NodeJS.ProcessEnv,specification:Readonly<Record<string,OracleOption>>):NodeJS.ProcessEnv{
  const values:NodeJS.ProcessEnv={};
  for(const [name,kind]of Object.entries(specification)){
    const value=env[name];if(value===undefined)continue;
    let valid=!value.includes('\0');
    switch(kind){
      case 'text':valid&&=value.length>0;break;
      case 'positive':valid&&=/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0;break;
      case 'nonnegative':valid&&=/^\d+$/.test(value)&&Number.isSafeInteger(Number(value));break;
      case 'integer':valid&&=/^-?\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)!==0;break;
      case 'backend':valid&&=['c','llvm','jvm'].includes(value);break;
      case 'toggle':valid&&=value==='0'||value==='1';break;
      case 'measurement-cpu':valid&&=value==='4';break;
    }
    if(!valid)throw new ToolingInstrumentError('tooling-setup',`invalid oracle entry command option ${name}: ${JSON.stringify(value)}`);
    values[name]=value;
  }
  return values;
}

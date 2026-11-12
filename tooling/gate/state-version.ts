// A stable numeric version is the part an older reader can understand. Check
// it before validating fields whose meaning may have changed in a newer file.
import {readFileSync} from 'node:fs';

export class FutureStateVersionError extends Error {
  readonly code='NTS_FUTURE_STATE_VERSION';
  readonly file:string;readonly version:number;readonly supported:number;
  constructor(file:string,version:number,supported:number){
    super(`${file}: unsupported future state version ${version}; this reader supports through ${supported}; left untouched`);
    this.name='FutureStateVersionError';this.file=file;this.version=version;this.supported=supported;
  }
}
export function futureStateVersion(value:unknown,supported:number,file:string):FutureStateVersionError|undefined{
  if(value===null||typeof value!=='object'||Array.isArray(value))return;
  const version=(value as {version?:unknown}).version;
  if(typeof version==='number'&&Number.isSafeInteger(version)&&version>supported)return new FutureStateVersionError(file,version,supported);
  return;
}
export function assertStateVersion(value:unknown,supported:number,file:string):void{
  const newer=futureStateVersion(value,supported,file);if(newer)throw newer;
}
/** Missing/corrupt data keeps its owner's recovery path. A recognizable future
 * header is never treated as corruption and must survive an attempted write. */
export function assertWritableState(file:string,supported:number):void{
  let text:string;
  try{text=readFileSync(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  let value:unknown;try{value=JSON.parse(text);}catch(error){if(error instanceof SyntaxError)return;throw error;}
  assertStateVersion(value,supported,file);
}

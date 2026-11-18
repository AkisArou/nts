// Complete supplied cgroup file operations for the admission CLI's departure
// race. Native process identity and all unrelated paths keep their live safety
// observations; the synthetic group never touches the cgroup filesystem.
import {generatedJavaScript} from './generated-javascript.ts';
export function departingCgroupPreload(group:string,trigger:'wait'|'membership'='wait'):string{
  return generatedJavaScript(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const group=${JSON.stringify(group)},prefix='/sys/fs/cgroup'+group,child=prefix+'/worker',original={...fs};
let armed=false,departed=false;const trigger=${JSON.stringify(trigger)};
fs.writeSync=(fd,data,...args)=>{if(fd===2&&String(data).includes('waits for'))armed=true;return original.writeSync(fd,data,...args);};
fs.statSync=(path,...args)=>String(path)===prefix||String(path)===child?{ino:847n}:original.statSync(path,...args);
fs.readFileSync=(path,...args)=>{const name=String(path);if(name.startsWith(prefix+'/')){
 if(name.endsWith('/cgroup.procs')){if(trigger==='membership'&&name===child+'/cgroup.procs')armed=true;return '';}
 if(name.endsWith('/memory.current'))return '0';
 if(name.endsWith('/memory.stat'))return 'active_file 0\\ninactive_file 0\\nslab_reclaimable 0\\n';
 }return original.readFileSync(path,...args);};
fs.readdirSync=(path,...args)=>{const name=String(path);if(name===prefix)return departed?[]:[{name:'worker',isDirectory:()=>true}];
 if(name===child){if(armed){departed=true;const limit=Error.stackTraceLimit;Error.stackTraceLimit=40;const error=Object.assign(Error('supplied ENOENT scandir'),{code:'ENOENT'});Error.stackTraceLimit=limit;original.writeSync(2,'supplied holder departure\\n'+error.stack+'\\n');throw error;}return [];}
 return original.readdirSync(path,...args);};syncBuiltinESMExports();`);
}

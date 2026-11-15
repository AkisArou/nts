// Linux capture identities are already resolved component paths. Validate
// that representation once; containment never resolves a historical name.
export function canonicalCapturedPath(value:unknown):value is string{
  return typeof value==='string'&&value.startsWith('/')
    &&(value==='/'||!value.endsWith('/'))&&!/(?:\/\/|\/\.{1,2}(?:\/|$)|\0)/.test(value);
}
export type CapturedBoundaryFactory=(root:string)=>(path:string)=>boolean;
export type CapturedKernelFilesystem='procfs'|'sysfs';
export type ProcfsTaskAnchor={kind:'procfs-task';tid:number;tgid:number;taskPidNamespace:{dev:string;ino:string};
  observerPidNamespace:{dev:string;ino:string};procRoot:{dev:string;ino:string}};
export function validProcfsTaskAnchor(value:unknown,task?:{tid:number;tgid:number}):value is ProcfsTaskAnchor{
  if(!value||typeof value!=='object')return false;
  const row=value as Record<string,unknown>,identity=(value:unknown):value is {dev:string;ino:string}=>{
    if(!value||typeof value!=='object')return false;
    const row=value as Record<string,unknown>;return typeof row.dev==='string'&&/^\d+$/.test(row.dev)&&typeof row.ino==='string'&&/^\d+$/.test(row.ino);
  };
  return row.kind==='procfs-task'&&Number.isSafeInteger(row.tid)&&Number(row.tid)>0&&Number.isSafeInteger(row.tgid)&&Number(row.tgid)>0
    &&(!task||row.tid===task.tid&&row.tgid===task.tgid)&&identity(row.taskPidNamespace)&&identity(row.observerPidNamespace)&&identity(row.procRoot)
    &&row.taskPidNamespace.dev===row.observerPidNamespace.dev&&row.taskPidNamespace.ino===row.observerPidNamespace.ino;
}
/** The only derived links are procfs's task-relative directory anchors.
 * Their parent is the captured proc root, and their successor is the same
 * observed task's numeric directory; no readlink value is invented. */
export function validProcfsTaskComponent(part:Record<string,unknown>,before:Record<string,unknown>|undefined,after:Record<string,unknown>|undefined,task:{tid:number;tgid:number}):boolean{
  const anchor=part.taskAnchor;
  if(!validProcfsTaskAnchor(anchor,task)||!canonicalCapturedPath(part.path)||!before||!after)return false;
  const slash=part.path.lastIndexOf('/'),parent=part.path.slice(0,slash)||'/',name=part.path.slice(slash+1);
  return part.kind==='symlink'&&part.filesystem==='procfs'&&part.link===undefined&&(name==='self'||name==='thread-self')
    &&before.path===parent&&before.kind==='directory'&&before.filesystem==='procfs'
    &&before.dev===anchor.procRoot.dev&&before.ino===anchor.procRoot.ino
    &&after.kind==='directory'&&after.filesystem==='procfs'
    &&after.path===(parent==='/'?'':parent)+'/'+task.tgid+(name==='thread-self'?'/task/'+task.tid:'');
}
export const capturedPathBoundary:CapturedBoundaryFactory=root=>{
  if(!canonicalCapturedPath(root))throw Error('capture boundary is not canonical and absolute: '+root);
  const prefix=root==='/'?'/':root+'/';
  return path=>path===root||path.startsWith(prefix);
};

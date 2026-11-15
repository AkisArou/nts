// Linux capture identities are already resolved component paths. Validate
// that representation once; containment never resolves a historical name.
export function canonicalCapturedPath(value:unknown):value is string{
  return typeof value==='string'&&value.startsWith('/')
    &&(value==='/'||!value.endsWith('/'))&&!/(?:\/\/|\/\.{1,2}(?:\/|$)|\0)/.test(value);
}
export type CapturedBoundaryFactory=(root:string)=>(path:string)=>boolean;
export const capturedPathBoundary:CapturedBoundaryFactory=root=>{
  if(!canonicalCapturedPath(root))throw Error('capture boundary is not canonical and absolute: '+root);
  const prefix=root==='/'?'/':root+'/';
  return path=>path===root||path.startsWith(prefix);
};

/** Byte inspection and execution placement are independent. Declaration files
 * are compile-time data; host/program sources need an execution owner. */
export type ToolingInputRole='program'|'declaration'|'data'|'unknown';
export type ToolingFileFacts={executable:boolean;prefix:string}|undefined;
export function toolingInputRole(path:string,facts:()=>ToolingFileFacts):ToolingInputRole{
  if(/\.d\.(?:ts|mts|cts)$/.test(path))return 'declaration';
  if(/\.(?:[cm]?[jt]sx?|sh|py|java)$/.test(path))return 'program';
  const observed=facts();
  if(!observed)return 'unknown';
  return observed.executable||observed.prefix.startsWith('#!')&&!/^#!\s*\[/.test(observed.prefix)?'program':'data';
}

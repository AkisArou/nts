// Pure decoding shared by the waited-child owner and retained records.
export type ChildUsage={version:1;cpu_measure:'wait4-rusage-v1';pid:number;wall_s:number;user_s:number;sys_s:number;exit:number;signal:number;exec_errno:number};

export function readChildUsage(value:unknown):ChildUsage{
  if(typeof value!=='object'||value===null)throw Error('phase observation: missing waited-child rusage');
  const row=value as Record<string,unknown>;
  if(row.version!==1||row.cpu_measure!=='wait4-rusage-v1'
    ||!['pid','exit','signal','exec_errno'].every(key=>typeof row[key]==='number'&&Number.isSafeInteger(row[key]))
    ||!['wall_s','user_s','sys_s'].every(key=>typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0)
    ||Number(row.pid)<0||(Number(row.pid)===0&&!(Number(row.exec_errno)>0&&row.exit===-1&&row.signal===0))
    ||Number(row.exit)<-1||Number(row.signal)<0||Number(row.exec_errno)<0)
    throw Error('phase observation: invalid waited-child rusage');
  return row as ChildUsage;
}


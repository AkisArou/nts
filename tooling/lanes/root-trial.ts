// Ask Git about the real checkout using a private index. A stale stat cache
// must not block identical bytes, and the coordinator owns the real index.
import{spawnSync}from"node:child_process";
import{copyFileSync,mkdirSync,mkdtempSync,rmSync}from"node:fs";
import{join,resolve}from"node:path";
export function rootTrial(root:string,base:string,tip:string,directory:string):string|null {
 const run=(args:string[],env=process.env)=>spawnSync("git",args,{cwd:root,env,encoding:"utf8"});
 const index=run(["rev-parse","--path-format=absolute","--git-path","index"]);
 if(index.error||index.status!==0)throw new Error(`cannot locate the root index: ${index.error?.message??index.stderr}`);
 mkdirSync(directory,{recursive:true});const temporary=mkdtempSync(join(directory,"trial-"));
 try {
  const copy=join(temporary,"index");copyFileSync(resolve(root,index.stdout.trim()),copy);
  const env={...process.env,GIT_INDEX_FILE:copy,GIT_OPTIONAL_LOCKS:"0"};
  const refreshed=run(["update-index","--refresh","--ignore-submodules"],env);
  // Exit 1 describes dirty entries, including unrelated edits. The two-tree
  // trial below decides which entries this exact fast-forward would touch.
  if(refreshed.error||![0,1].includes(refreshed.status??-1))throw new Error(`cannot refresh the private root index: ${refreshed.error?.message??refreshed.stderr}`);
  const trial=run(["read-tree","--dry-run","-m","-u",base,tip],env);
  if(trial.error)throw trial.error;
  return trial.status===0?null:`root checkout conflict: ${trial.stderr.trim()}`;
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

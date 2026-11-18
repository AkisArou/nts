import {isAbsolute,resolve} from 'node:path';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe,type InfrastructureProbe} from './infrastructure-probe.ts';

/** Resolve matched-source identities from one Git tree, never live links. */
export function committedProjectPaths(source:{tree:string;revision:string},probe:InfrastructureProbe=infrastructureProbe){
  if(!isAbsolute(source.tree)||resolve(source.tree)!==source.tree||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(source.revision))
    throw Error('committed project identity needs an absolute source and resolved revision');
  const git=(args:string[],maxBuffer=64<<20)=>probe({purpose:'committed project identity '+args[0],command:'git',args:gitArguments(args),cwd:source.tree,maxBuffer}).stdout;
  let entries:Map<string,{mode:string;blob:string}>|undefined;
  const links=new Map<string,string>(),identities=new Map<string,string[]>();
  const index=()=>{
    if(entries)return entries;
    entries=new Map();
    for(const record of git(['ls-tree','--full-tree','-r','-t','-z',source.revision]).split('\0')){
      if(!record)continue;
      const tab=record.indexOf('\t'),header=/^([0-7]{6}) (?:blob|tree|commit) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(record.slice(0,tab)),path=record.slice(tab+1);
      if(tab<0||!header||!path||entries.has(path))throw Error('malformed committed project tree');
      entries.set(path,{mode:header[1]!,blob:header[2]!});
    }
    return entries;
  };
  const parts=(path:string)=>{
    if(!path||isAbsolute(path)||/[\\\x00-\x1f]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))
      throw Error('invalid committed project match: '+path);
    return path.split('/');
  };
  return {
    hasAlias(path:string):boolean{
      const names=parts(path),tree=index();
      return names.some((_,i)=>tree.get(names.slice(0,i+1).join('/'))?.mode==='120000');
    },
    identity(path:string):string[]{
      const cached=identities.get(path);if(cached)return [...cached];
      let pending=parts(path);const physical:string[]=[],names=new Set([path]),tree=index();let hops=0,regular=false;
      while(pending.length){
        const part=pending.shift()!;
        if(!part||part==='.')continue;
        if(part==='..'){
          if(!physical.length)throw Error('committed project match leaves source: '+path);
          physical.pop();continue;
        }
        const name=[...physical,part].join('/'),entry=tree.get(name);
        if(!entry)throw Error('committed project match is absent at '+source.revision+': '+name);
        if(entry.mode==='120000'){
          if(++hops>40)throw Error('committed project match has a symlink cycle: '+path);
          names.add(name);
          let target=links.get(entry.blob);
          if(target===undefined){target=git(['cat-file','blob',entry.blob],64<<10);links.set(entry.blob,target);}
          if(!target||isAbsolute(target)||/[\\\x00-\x1f]/.test(target))throw Error('committed project match leaves source or has an invalid alias: '+path+' via '+name);
          pending=[...target.split('/'),...pending];continue;
        }
        physical.push(part);
        if(pending.length&&entry.mode!=='040000')throw Error('committed project match crosses a non-directory: '+name);
        if(!pending.length&&entry.mode!=='100644'&&entry.mode!=='100755')throw Error('committed project match is not a source file: '+name);
        if(!pending.length)regular=true;
      }
      if(!regular)throw Error('committed project match is not a source file: '+path);
      names.add(physical.join('/'));const result=[...names];identities.set(path,result);return [...result];
    },
  };
}

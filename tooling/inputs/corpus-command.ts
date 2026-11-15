// Thin command dispatch; every operation stays in the corpus acquisition owner.
import {resolve} from 'node:path';
import {corpus,type Corpus} from './corpus.ts';
export function corpusCommand(definition:Corpus,args:readonly string[],env:NodeJS.ProcessEnv,root:string):void{
  const [mode='--prepare',...paths]=args,owner=corpus(definition);
  if(mode==='--pin'){
    if(paths.length)throw Error('usage: '+definition.slot+' --pin');
    process.stdout.write(owner.pin+'\n');return;
  }
  if(mode==='--link'){
    if(paths.length!==0&&paths.length!==2)throw Error('usage: '+definition.slot+' --link [shared tree]');
    owner.link(paths[0]?resolve(paths[0]):owner.sharedRoot(root,env),paths[1]?resolve(paths[1]):root,env);return;
  }
  if(paths.length>1)throw Error('unexpected '+definition.slot+' corpus arguments');
  const tree=resolve(paths[0]??root);
  if(mode==='--verify')owner.verify(tree,env);
  else if(mode==='--resolve')process.stdout.write(JSON.stringify({version:1,pin:owner.pin,path:owner.resolve(tree,env)})+'\n');
  else if(mode==='--acquire')process.stdout.write(owner.acquire(owner.sharedRoot(tree,env),env)+'\n');
  else if(mode==='--prepare')process.stdout.write(JSON.stringify(owner.prepare(owner.sharedRoot(tree,env),tree,env))+'\n');
  else throw Error('usage: '+definition.slot+' --pin | --link [shared tree] | --acquire [tree] | --prepare [tree] | --verify checkout | --resolve tree');
}

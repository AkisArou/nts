// Production publication has one owner. Rust's token tree keeps comments,
// literals and actual test-only items separate from executable references.
import {rustTokens,type RustToken} from './rust-test-paths.ts';
import {posix} from 'node:path';

type Bounds={low:boolean;high:boolean};
const unknown:Bounds={low:false,high:true};
function argumentsOf(tokens:readonly RustToken[]):RustToken[][]{
  const args:RustToken[][]=[[]];for(const token of tokens)if(token.text===',')args.push([]);else args.at(-1)!.push(token);
  return args.filter(arg=>arg.length);
}
function withoutTest(tokens:readonly RustToken[]):Bounds{
  if(tokens.length===1&&tokens[0]!.text==='test')return {low:false,high:false};
  const operation=tokens[0]?.text,group=tokens[1];
  if(tokens.length!==2||group?.text!=='('||!group.children)return unknown;
  const args=argumentsOf(group.children).map(withoutTest);
  if(operation==='all')return {low:args.every(arg=>arg.low),high:args.every(arg=>arg.high)};
  if(operation==='any')return {low:args.some(arg=>arg.low),high:args.some(arg=>arg.high)};
  if(operation==='not'&&args.length===1)return {low:!args[0]!.high,high:!args[0]!.low};
  return unknown;
}
function testOnly(attribute:readonly RustToken[]):boolean{
  return attribute.length===1&&attribute[0]!.text==='test'||attribute[0]?.text==='cfg'&&attribute[1]?.children!==undefined&&!withoutTest(attribute[1].children).high;
}

function useBindings(tokens:readonly RustToken[],prefix:string[],bind:(name:string,path:string[])=>void):void{
  for(const part of argumentsOf(tokens)){
    const group=part.findIndex(token=>token.text==='{');
    if(group>=0){useBindings(part[group]!.children??[],[...prefix,...part.slice(0,group).filter(token=>token.text!=='::').map(token=>token.text)],bind);continue;}
    const alias=part.findIndex(token=>token.text==='as'),path=part.slice(0,alias<0?part.length:alias).filter(token=>token.text!=='::').map(token=>token.text);
    const full=[...prefix,...(path.at(-1)==='self'?path.slice(0,-1):path)],name=alias<0?full.at(-1):part[alias+1]?.text;
    if(name)bind(name,full);
  }
}

/** Module declarations, including cfg(test) on an external module, determine
 * test-only files. A filename suffix alone never exempts production code. */
export function publicationTestFiles(sources:ReadonlyMap<string,string>,seeds:ReadonlySet<string>):Set<string>{
  const edges:{from:string;to:string;test:boolean}[]=[];
  for(const [file,source]of sources){
    const base=posix.basename(file),directory=posix.dirname(file);
    const modules=['lib.rs','main.rs','mod.rs','build.rs'].includes(base)?directory:posix.join(directory,base.slice(0,-3));
    function walk(tokens:readonly RustToken[],moduleDirectory:string,attributeDirectory:string,inTest:boolean):void{
      let pending=false,path:string|undefined;
      for(let i=0;i<tokens.length;i++){
        const token=tokens[i]!;
        if(token.text==='#'&&tokens[i+1]?.children){
          const attribute=tokens[++i]!.children!;pending||=testOnly(attribute);
          if(attribute[0]?.text==='path'&&attribute[1]?.text==='='&&attribute[2]?.literal){try{path=JSON.parse(attribute[2].text) as string;}catch{throw Error('publication audit cannot decode Rust module path: '+file);}}
          continue;
        }
        if(token.text==='mod'&&tokens[i+1]&&!tokens[i+1]!.children){
          const name=tokens[i+1]!.text,body=tokens[i+2];
          if(body?.text===';'){
            const candidates=path?[posix.normalize(posix.join(attributeDirectory,path))]:[posix.join(moduleDirectory,name+'.rs'),posix.join(moduleDirectory,name,'mod.rs')];
            for(const to of candidates)if(sources.has(to))edges.push({from:file,to,test:inTest||pending});
          }else if(body?.text==='{')walk(body.children??[],posix.join(moduleDirectory,name),posix.join(moduleDirectory,name),inTest||pending);
          pending=false;path=undefined;i+=2;continue;
        }
        if(token.text===';'||token.text==='{'){pending=false;path=undefined;}
      }
    }
    walk(rustTokens(source),modules,directory,false);
  }
  const tests=new Set(seeds);let changed=true;
  while(changed){changed=false;for(const [to,uses]of Map.groupBy(edges,edge=>edge.to))if(!tests.has(to)&&uses.every(edge=>edge.test||tests.has(edge.from))){tests.add(to);changed=true;}}
  return tests;
}

export function inspectRustPublication(file:string,source:string,testFile=false):string[]{
  // This is the single implementation owner, not a caller allowance list.
  if(file==='tooling/publication/src/lib.rs')return [];
  const problems=new Map<number,string>();
  const report=(at:number)=>problems.set(at,`${file}:${source.slice(0,at).split('\n').length}: filesystem renames belong to nts-publication; use its file/directory owner`);
  function walk(tokens:readonly RustToken[],inherited:ReadonlyMap<string,string[]>,inTest:boolean):void{
    const bindings=new Map(inherited);let pendingTest=false;
    const qualified=(path:string[])=>bindings.has(path[0]!)?[...bindings.get(path[0]!)!,...path.slice(1)]:path;
    // Rust imports are visible throughout their lexical scope, including
    // before their textual declaration. Nested use groups share this parser.
    for(let i=0;i<tokens.length;i++)if(tokens[i]!.text==='use'){
      let end=i+1;while(end<tokens.length&&tokens[end]!.text!==';')end++;
      useBindings(tokens.slice(i+1,end),[],(name,path)=>bindings.set(name,qualified(path)));
    }
    for(let i=0;i<tokens.length;i++){
      const token=tokens[i]!;
      if(token.text==='#'){
        const inner=tokens[i+1]?.text==='!',attribute=tokens[i+(inner?2:1)];
        if(attribute?.text==='['&&attribute.children){
          if(testOnly(attribute.children)){if(inner)inTest=true;else pendingTest=true;}
          i+=inner?2:1;continue;
        }
      }
      if(!inTest&&!pendingTest&&!token.literal){
        const path=[token.text];let end=i;
        while(tokens[end+1]?.text==='::'&&tokens[end+2]&&!tokens[end+2]!.children){path.push(tokens[end+2]!.text);end+=2;}
        const full=qualified(path);
        if(full[0]==='std'&&full[1]==='fs'&&['rename','*'].includes(full[2]??''))report(token.start);
      }
      if(token.children&&!token.literal)walk(token.children,bindings,inTest||pendingTest);
      if(token.text===';'||token.text==='{')pendingTest=false;
    }
  }
  walk(rustTokens(source),new Map(),testFile);
  return [...problems.values()];
}

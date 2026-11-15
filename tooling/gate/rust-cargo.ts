// Rust children share the step's Cargo guard. Their cwd must be one of the
// exact roots that guard observes; a scratch descendant is not the root.
import {resolve} from 'node:path';
import {rustTokens,type RustToken} from './rust-test-paths.ts';

const text=(tokens:readonly RustToken[]):string=>tokens.map(token=>token.children?token.text+text(token.children)+({'(':')','[':']','{':'}'}[token.text]??''):token.text).join('');
function rootValue(tokens:readonly RustToken[],bindings:ReadonlyMap<string,string>,pkg:string):string|undefined{
  if(tokens[0]?.text==='&')return rootValue(tokens.slice(1),bindings,pkg);
  if(tokens.length===1)return bindings.get(tokens[0]!.text);
  const source=text(tokens);
  if(/^(?:std::path::)?PathBuf::from\((?:std::)?env::var\("NTS_TEST_SCRATCH_ROOT"\)\.expect\("[^"\\]*"\)\)$/.test(source))return 'scratch';
  const prefix=/^(?:(?:std::path::)?Path)::new\(env!\("CARGO_MANIFEST_DIR"\)\)/.exec(source);
  if(!prefix)return;
  let value=resolve(pkg),tail=source.slice(prefix[0].length);
  while(tail){
    const join=/^\.join\(("[^"\\]*")\)/.exec(tail);
    if(join){value=resolve(value,JSON.parse(join[1]!));tail=tail.slice(join[0].length);continue;}
    const suffix=/^\.(?:canonicalize\(\)|expect\("[^"\\]*"\)|unwrap\(\)|to_path_buf\(\))/.exec(tail);
    if(!suffix)return;tail=tail.slice(suffix[0].length);
  }
  return value;
}
export function inspectRustCargoCalls(file:string,source:string,packageDirectory:string,tree:string):string[]{
  const problems:string[]=[],uses=new Set<number>(),owned=new Set<number>();
  function walk(tokens:readonly RustToken[],inherited:ReadonlyMap<string,string>):void{
    const bindings=new Map(inherited);
    for(let index=0;index<tokens.length;index++){
      const token=tokens[index]!;
      if(token.text==='env'&&tokens[index+1]?.text==='!'&&text(tokens[index+2]?.children??[])==='"CARGO"')uses.add(token.start);
      if(token.text==='let'&&tokens[index+1]?.text!=='mut'&&tokens[index+2]?.text==='='){
        let end=index+3;while(end<tokens.length&&tokens[end]!.text!==';')end++;
        const name=tokens[index+1]!.text,value=rootValue(tokens.slice(index+3,end),bindings,packageDirectory);
        bindings.delete(name);if(value)bindings.set(name,value);
      }
      if(token.text==='Command'&&tokens[index+1]?.text==='::'&&tokens[index+2]?.text==='new'&&tokens[index+3]?.children
        &&text(tokens[index+3]!.children!)==='env!("CARGO")'){
        owned.add(tokens[index+3]!.children![0]!.start);
        let end=index+4;while(end<tokens.length&&tokens[end]!.text!==';')end++;
        let cwd:RustToken|undefined;
        for(let at=index+4;at<end;at++)if(tokens[at]!.text==='current_dir')cwd=tokens[at+1];
        const value=cwd?.children&&rootValue(cwd.children,bindings,packageDirectory);
        if(value!==resolve(tree)&&value!=='scratch')problems.push(`${file}:${source.slice(0,token.start).split('\n').length}: Rust Cargo child must use the checked workspace root or exact supplied NTS_TEST_SCRATCH_ROOT`);
      }
      if(token.children&&!token.literal)walk(token.children,bindings);
    }
  }
  walk(rustTokens(source),new Map());
  for(const at of uses)if(!owned.has(at))problems.push(`${file}:${source.slice(0,at).split('\n').length}: Cargo executable must be consumed by a child with a checked working directory`);
  return problems;
}

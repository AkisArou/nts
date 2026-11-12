// Rust test resources belong to a fixture, never to the process shared by
// all cases in a harness. Tokenize literals/comments before inspecting code;
// product snippets inside raw strings are not the test's resource constructors.
export type RustToken={text:string;start:number;end:number;literal?:boolean;children?:RustToken[]};
export type RustPidSite={start:number;end:number;line:number;test:boolean;source:string};
export type RustPidInspection={paths:RustPidSite[];reads:RustPidSite[]};

export function rustTokens(source:string):RustToken[]{
  let at=0;
  function tokens(close?:string):RustToken[]{
    const out:RustToken[]=[];
    while(at<source.length){
      const start=at,c=source[at]!;
      if(/\s/.test(c)){at++;continue;}
      if(source.startsWith('//',at)){at=source.indexOf('\n',at);if(at<0)at=source.length;continue;}
      if(source.startsWith('/*',at)){
        at+=2;let depth=1;
        while(at<source.length&&depth){if(source.startsWith('/*',at)){depth++;at+=2;}else if(source.startsWith('*/',at)){depth--;at+=2;}else at++;}
        if(depth)throw Error('unterminated Rust comment');continue;
      }
      if(c===close){at++;return out;}
      const raw=/^(?:b|c)?r(#{0,255})"/.exec(source.slice(at));
      if(raw){const end=source.indexOf('"'+raw[1],at+raw[0].length);if(end<0)throw Error('unterminated Rust raw string');at=end+1+raw[1]!.length;out.push({text:source.slice(start,at),start,end:at,literal:true});continue;}
      const prefix=/^(?:b|c)?"/.exec(source.slice(at));
      if(prefix){at+=prefix[0].length;let closed=false;while(at<source.length){const next=source[at++];if(next==='\\'){at++;continue;}if(next==='"'){closed=true;break;}}if(!closed)throw Error('unterminated Rust string');out.push({text:source.slice(start,at),start,end:at,literal:true});continue;}
      const character=/^(?:b)?'(?:\\(?:u\{[\da-fA-F_]+\}|x[\da-fA-F]{2}|.)|[^'\\\r\n])'/u.exec(source.slice(at));
      if(character){at+=character[0].length;out.push({text:character[0],start,end:at,literal:true});continue;}
      const closing:Record<string,string>={'(':')','[':']','{':'}'};
      if(closing[c]){at++;const children=tokens(closing[c]);out.push({text:c,start,end:at,children});continue;}
      if(')]}'.includes(c))throw Error('unbalanced Rust delimiter');
      const identifier=/^(?:r#)?[A-Za-z_]\w*/.exec(source.slice(at));
      if(identifier){at+=identifier[0].length;out.push({text:identifier[0],start,end:at});continue;}
      const pair=source.slice(at,at+2);at+=pair==='::'?2:1;out.push({text:source.slice(start,at),start,end:at});
    }
    if(close)throw Error('unclosed Rust delimiter');return out;
  }
  return tokens();
}

const code=(tokens:readonly RustToken[]):string=>tokens.map(token=>token.literal?'':token.children?token.text+code(token.children)+({'(':')','[':']','{':'}'}[token.text]??''):token.text).join('');
const containsPid=(tokens:readonly RustToken[])=>/(?:\bprocess::id|\bgetpid)\(\)/.test(code(tokens));
function hasTest(tokens:readonly RustToken[],negated=false):boolean{
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index]!,next=tokens[index+1];
    if(token.text==='not'&&next?.children){if(hasTest(next.children,!negated))return true;index++;}
    else if(token.text==='test'&&!negated||token.children&&hasTest(token.children,negated))return true;
  }return false;
}
const literals=(tokens:readonly RustToken[]):RustToken[]=>tokens.flatMap(token=>token.literal?[token]:token.children?literals(token.children):[]);
const systemPath=(literal:string)=>/^(?:b|c)?(?:r#*)?"\/(?:proc(?:\/|\")|sys\/fs\/cgroup(?:\/|\"))/.test(literal);
const conventional=(file:string)=>/(?:^|\/)(?:tests|test-support)\/|_tests?(?:\/|\.rs$)|\/tests?\.rs$/.test(file);

export function inspectRustPidPaths(file:string,source:string):RustPidInspection{
  const roots=rustTokens(source),paths:RustPidSite[]=[],reads:RustPidSite[]=[];
  const site=(start:number,end:number,test:boolean):RustPidSite=>({start,end,test,line:source.slice(0,start).split('\n').length,source:source.slice(start,end)});
  function walk(tokens:readonly RustToken[],inTest:boolean,inherited:ReadonlySet<string>=new Set(),reporting=false):void{
    let test=inTest,pendingTest=false;
    const aliases=new Set(inherited);
    for(let i=0;i<tokens.length;i++)if(tokens[i]!.text==='let'){
      const name=tokens[i+1]?.text,equals=tokens.findIndex((token,index)=>index>i&&token.text==='=');
      if(!name||equals<0)continue;
      let end=equals+1;while(end<tokens.length&&tokens[end]!.text!==';')end++;
      const value=tokens.slice(equals+1,end);
      if(containsPid(value)&&!literals(value).length&&!code(value).includes('format!'))aliases.add(name);
    }
    const references=(nodes:readonly RustToken[]):boolean=>nodes.some(token=>!token.literal&&(aliases.has(token.text)||token.text==='pid'||token.children&&references(token.children)));
    for(let index=0;index<tokens.length;index++){
      const token=tokens[index]!;
      if(token.text==='#'){
        const inner=tokens[index+1]?.text==='!',attribute=tokens[index+(inner?2:1)];
        if(attribute?.text==='['&&attribute.children){
          const name=attribute.children[0]?.text;
          if(name==='test'||name==='cfg'&&hasTest(attribute.children)){
            if(inner)test=true;else pendingTest=true;
          }
          index+=inner?2:1;continue;
        }
      }
      const next=tokens[index+1],args=tokens[index+2];
      if(token.text==='process'&&next?.text==='::'&&args?.text==='id'&&tokens[index+3]?.text==='(')
        reads.push(site(token.start,tokens[index+3]!.end,test||pendingTest));
      if(token.text==='getpid'&&next?.text==='(')reads.push(site(token.start,next.end,test||pendingTest));
      if(token.text==='format'&&next?.text==='!'&&args?.children){
        const text=literals(args.children)[0]?.text??'';
        const captures=[...aliases,'pid','process_id'].some(name=>new RegExp('\\{'+name+'(?:[:}])').test(text));
        if(!reporting&&!systemPath(text)&&(containsPid(args.children)||references(args.children)||captures))paths.push(site(token.start,args.end,test||pendingTest));
      }
      if(['join','push','with_extension','bind','listen'].includes(token.text)&&next?.children&&(containsPid(next.children)||references(next.children))
        &&!paths.some(path=>path.start>=next.start&&path.end<=next.end))paths.push(site(token.start,next.end,test||pendingTest));
      if(token.children){const caller=tokens[index-1]?.text==='!'?tokens[index-2]?.text:tokens[index-1]?.text;
        walk(token.children,test||pendingTest,aliases,reporting||['Err','println','eprintln','panic'].includes(caller??''));}
      if(token.text===';'||token.text==='{')pendingTest=false;
    }
  }
  walk(roots,conventional(file));
  const unique=(sites:RustPidSite[])=>[...new Map(sites.map(item=>[item.start,item])).values()];
  return {paths:unique(paths).filter(path=>!unique(paths).some(other=>other.start>path.start&&other.end<path.end)),reads:unique(reads)};
}

// expect: assigning to this property
// An erased write through an unrelated alias is deliberately still refused.
// Its any assertion nevertheless prevents proving the literal stays without
// return. The control installs return through the real typed receiver.
// expect-ir: all: count call.extern(nts_access_key_description) in subjectWalk >= 1
interface SubjectSource {
 count:number;closed:number;
 [Symbol.iterator]():SubjectSource;
 next():{value:number;done:boolean};
 return?:()=>{value:number;done:boolean};
}
function subjectLiteral():SubjectSource {
 return {count:0,closed:0,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};}
 };
}
export function subjectWalk(source:SubjectSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
interface Unrelated { unrelated:number; }
function install(alias:Unrelated,source:SubjectSource):void {
 (alias as any).return = () => {source.closed=1;return {value:0,done:true};};
}
export function subject(n:number):number {
 const source=subjectLiteral();
 install(source as unknown as Unrelated,source);
 return subjectWalk(source);
}

interface ControlSource {
 count:number;closed:number;
 [Symbol.iterator]():ControlSource;
 next():{value:number;done:boolean};
 return?:()=>{value:number;done:boolean};
}
function controlLiteral():ControlSource {
 return {count:0,closed:0,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};}
 };
}
function controlWalk(source:ControlSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
export function control(n:number):number {
 const source=controlLiteral();
 source.return = () => {source.closed=1;return {value:0,done:true};};
 return controlWalk(source);
}

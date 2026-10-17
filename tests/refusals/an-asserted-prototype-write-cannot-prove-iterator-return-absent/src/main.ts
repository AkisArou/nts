// expect: prototype and descriptor reflection
// Prototype mutation is deliberately still refused. A write through an erased
// prototype alias must prevent absence even when its stripped type is unrelated.
// The control installs return directly; subject cleanup restores Object.prototype.
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
export function subject(n:number):number {
 const source=subjectLiteral();
 const proto:Unrelated = Object.prototype as unknown as Unrelated;
 (proto as any).return = function(){source.closed=1;return {value:0,done:true};};
 try { return subjectWalk(source); } finally { delete (proto as any).return; }
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

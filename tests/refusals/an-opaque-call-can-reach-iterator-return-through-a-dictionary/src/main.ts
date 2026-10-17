// expect: a type with no native ABI
// The unavailable native function is deliberately refused: its dictionary argument
// has no native ABI. That refusal cannot prove the reachable iterator stays
// untouched. The control installs return with an ordinary typed write.

// expect-ir: all: count call.extern(nts_access_key_description) in wrappedWalk >= 1
interface WrappedSource {
 count:number;closed:number;
 [Symbol.iterator]():WrappedSource;
 next():{value:number;done:boolean};
 return?:()=>{value:number;done:boolean};
}
function wrappedLiteral():WrappedSource {
 return {count:0,closed:0,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};}
 };
}
export function wrappedWalk(source:WrappedSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
declare function mutateWrapped(value:Record<string,WrappedSource>):void;
export function wrapped(n:number):number {
 const source=wrappedLiteral();
 // An opaque call can reach an iterator through a fresh record argument.
 // Its body is unavailable, so it cannot prove this record stays untouched.
 mutateWrapped({source});
 return wrappedWalk(source);
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

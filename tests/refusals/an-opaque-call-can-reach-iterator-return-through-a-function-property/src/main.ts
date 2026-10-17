// expect: assigning to this property
// The dynamic property installation deliberately remains refused. An opaque
// call receiving the holder can reach the iterator through that function's
// property even though calling the function returns only a number. Refusing
// the installation does not prove return absent in the exported walker.
// The scalar control installs return by an ordinary typed property write.
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
declare function mutateWrapped(value:()=>number):void;
export function wrapped(n:number):number {
 const source=wrappedLiteral();
 const holder=()=>0;
 (holder as any).source=source;
 mutateWrapped(holder);
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

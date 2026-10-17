// expect: onto something other than a dictionary
// Object.assign to a fixed record remains refused. Its opaque write still
// prevents proving return absent in the exported walker. The control changes
// the installation to an ordinary write at a separate contextual owner.
// expect-ir: all: count call.extern(nts_access_key_description) in assignWalk >= 1
interface AssignSource {
 count:number;closed:number;
 [Symbol.iterator]():AssignSource;
 next():{value:number;done:boolean};
 return?:()=>{value:number;done:boolean};
}
function assignLiteral():AssignSource {
 return {count:0,closed:0,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};}
 };
}
export function assignWalk(source:AssignSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
export function subject(n:number):number {
 const source=assignLiteral();
 Object.assign(source,{return:() => {source.closed=1;return {value:0,done:true};}});
 return assignWalk(source);
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

// run: check
// The subject changes only = to ??= relative to the control. The two
// contextual owner names keep the control's ordinary write from disproving
// absence for the subject while analysing this whole program.
// An initially missing return is installed before the break. Node closes
// both sources, answering 11. Candidate 7978 skips the subject's close.
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
function subjectWalk(source:SubjectSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
export function subject(n:number):number {
 const source=subjectLiteral();
 source.return ??= () => {source.closed=1;return {value:0,done:true};};
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

interface destructuringSource {
 count:number;closed:number;
 [Symbol.iterator]():destructuringSource;
 next():{value:number;done:boolean};
 return?:()=>{value:number;done:boolean};
}
function destructuringLiteral():destructuringSource {
 return {count:0,closed:0,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};}
 };
}
function destructuringWalk(source:destructuringSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
export function destructuring(n:number):number {
 const source=destructuringLiteral();
 ({return:source.return}= {return:() => {source.closed=1;return {value:0,done:true};}});
 return destructuringWalk(source);
}

interface destructuringControlSource {
 count:number;closed:number;
 [Symbol.iterator]():destructuringControlSource;
 next():{value:number;done:boolean};
 return?:()=>{value:number;done:boolean};
}
function destructuringControlLiteral():destructuringControlSource {
 return {count:0,closed:0,
  [Symbol.iterator](){return this;},
  next(){const value=++this.count;return {value,done:value>2};}
 };
}
function destructuringControlWalk(source:destructuringControlSource):number {
 for(const value of source){break;}
 return source.closed*10+source.count;
}
export function destructuringControl(n:number):number {
 const source=destructuringControlLiteral();
 source.return = () => {source.closed=1;return {value:0,done:true};};
 return destructuringControlWalk(source);
}

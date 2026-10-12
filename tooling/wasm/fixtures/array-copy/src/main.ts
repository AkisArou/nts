export function sliceLength(from: number, to: number): number { return [1,2,3,4].slice(from,to).length; }
export function sliceAt(x: number, y: number, from: number, to: number, at: number): number { return [x,y,x,y].slice(from,to)[at]; }
export function sliceString(x: string, y: string, from: number, to: number, at: number): string { return [x,y,x,y].slice(from,to)[at]; }
export function concatAt(x: number, y: number, at: number): number { return [x,y].concat([y,x])[at]; }
export function concatString(x: string, y: string, at: number): string { return [x,y].concat([y,x])[at]; }
export function reverseAt(x: number, y: number, at: number): number { const a=[x,y,x,y,y]; const alias=a; a.reverse(); return alias[at]; }
export function reverseString(x: string, y: string, at: number): string { const a=[x,y,x,y,y]; const alias=a; a.reverse(); return alias[at]; }
export function reverseIdentity(): boolean { const a:number[]=[]; return a.reverse()===a; }
export function copyDistinct(): boolean { const a:number[]=[]; return a.slice()!==a && a.concat(a)!==a; }
export function spreadAt(x: number, y: number, at: number): number { const a=[x,y]; return [y,...a,x,...a][at]; }
export function spreadString(x: string, y: string, at: number): string { const a=[x,y]; return [y,...a,x,...a][at]; }

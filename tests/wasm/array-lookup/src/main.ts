export function includesNumber(x: number,y: number,z: number): boolean { return [x,y,x].includes(z); }
export function indexNumber(x: number,y: number,z: number): number { return [x,y,x].indexOf(z); }
export function lastNumber(x: number,y: number,z: number): number { return [x,y,x].lastIndexOf(z); }
export function includesString(x: string,y: string,z: string): boolean { return [x,y,x].includes(z); }
export function indexString(x: string,y: string,z: string): number { return [x,y,x].indexOf(z); }
export function optionalNumber(x: number,y: number,at: number): boolean { return [x,y,x].at(at)===undefined; }
export function atNumber(x: number,y: number,at: number): number { const r=[x,y,x].at(at); return r===undefined?123:r; }
export function atString(x: string,y: string,at: number): number { const r=[x,y,x].at(at); return r===undefined?0:r.length; }
export function identityHit(): number { const a:number[]=[]; const b:number[]=[]; return [a,b,a].indexOf(a); }
export function identityMiss(): boolean { const a:number[]=[]; const b:number[]=[]; const c:number[]=[]; return [a,b,a].includes(c); }
export function unknownNumber(x: string,y: string,needle: number): boolean {
  const value: unknown=needle;
  // @ts-expect-error Search compares the actual value even when types differ.
  return [x,y,x].includes(value);
}
export function unknownString(x: string,y: string,needle: string): number {
  const value: unknown=needle;
  // @ts-expect-error Search compares the actual value even when types differ.
  return [x,y,x].indexOf(value);
}
export function unknownBoolean(x: string,y: string,needle: boolean): boolean {
  const value: unknown=needle;
  // @ts-expect-error Search compares the actual value even when types differ.
  return [x,y,x].includes(value);
}

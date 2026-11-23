//! Throw payloads shared by the addon probe and native preparation control.
pub(crate) const SOURCE: &str = r"
export function fresh(n:number):number { throw 'thrown '+n; }
export function borrowed(value:string):number { throw value; }
export function throwError(n:number):number { throw new RangeError('error '+n); }
export function control(value:string):string { return value; }
";

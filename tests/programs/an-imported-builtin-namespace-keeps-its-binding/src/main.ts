import { Math, Math as OwnMath, Number, Number as OwnNumber, JSON, JSON as OwnJSON } from "./library.ts";
export function importedMath(n:number):number { return Math.max(n,3); }
export function renamedMath(n:number):number { return OwnMath.max(n,3); }
export function importedNumber(n:number):boolean { return Number.isNaN(n); }
export function renamedNumber(n:number):boolean { return OwnNumber.isNaN(n); }
export function importedParse(n:number):number { return Number.parseInt("3"); }
export function renamedParse(n:number):number { return OwnNumber.parseInt("3"); }
export function importedJSON(n:number):string { return JSON.stringify(n); }
export function renamedJSON(n:number):string { return OwnJSON.stringify(n); }

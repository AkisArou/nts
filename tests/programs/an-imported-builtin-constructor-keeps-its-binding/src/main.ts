// Import aliases preserve the same body and expose name-based dispatch.

import { Array, Array as OwnArray } from "./library.ts";
export function importedArray(n:number):number { return new Array(n).read(); }
export function renamedArray(n:number):number { return new OwnArray(n).read(); }

import { Int8Array, Int8Array as OwnInt8Array } from "./library.ts";
export function importedInt8Array(n:number):number { return new Int8Array(n).read(); }
export function renamedInt8Array(n:number):number { return new OwnInt8Array(n).read(); }

import { Uint8Array, Uint8Array as OwnUint8Array } from "./library.ts";
export function importedUint8Array(n:number):number { return new Uint8Array(n).read(); }
export function renamedUint8Array(n:number):number { return new OwnUint8Array(n).read(); }

import { Int16Array, Int16Array as OwnInt16Array } from "./library.ts";
export function importedInt16Array(n:number):number { return new Int16Array(n).read(); }
export function renamedInt16Array(n:number):number { return new OwnInt16Array(n).read(); }

import { Uint16Array, Uint16Array as OwnUint16Array } from "./library.ts";
export function importedUint16Array(n:number):number { return new Uint16Array(n).read(); }
export function renamedUint16Array(n:number):number { return new OwnUint16Array(n).read(); }

import { Int32Array, Int32Array as OwnInt32Array } from "./library.ts";
export function importedInt32Array(n:number):number { return new Int32Array(n).read(); }
export function renamedInt32Array(n:number):number { return new OwnInt32Array(n).read(); }

import { Uint32Array, Uint32Array as OwnUint32Array } from "./library.ts";
export function importedUint32Array(n:number):number { return new Uint32Array(n).read(); }
export function renamedUint32Array(n:number):number { return new OwnUint32Array(n).read(); }

import { Float32Array, Float32Array as OwnFloat32Array } from "./library.ts";
export function importedFloat32Array(n:number):number { return new Float32Array(n).read(); }
export function renamedFloat32Array(n:number):number { return new OwnFloat32Array(n).read(); }

import { Float64Array, Float64Array as OwnFloat64Array } from "./library.ts";
export function importedFloat64Array(n:number):number { return new Float64Array(n).read(); }
export function renamedFloat64Array(n:number):number { return new OwnFloat64Array(n).read(); }

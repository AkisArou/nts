// Scope ancestry is independent of module block depth.
{
var value1: number = 7;
}

export function read1(seed: number): number { return value1 + ((seed | 0) * 0); }

{
var value63: number = 7;
}

export function read63(seed: number): number { return value63 + ((seed | 0) * 0); }

{
var value64: number = 7;
}

export function read64(seed: number): number { return value64 + ((seed | 0) * 0); }

{
var value65: number = 7;
}

export function read65(seed: number): number { return value65 + ((seed | 0) * 0); }

{
var value70: number = 7;
}

export function read70(seed: number): number { return value70 + ((seed | 0) * 0); }

interface Face { x: number; }
class Prefix { x: number; a = 1000; b = 2000; constructor(n: number) { this.x = n; } }
class ShiftOne { a = 1000; x: number; b = 2000; constructor(n: number) { this.x = n; } }
class ShiftTwo { a = 1000; b = 2000; x: number; constructor(n: number) { this.x = n; } }
function read(value: unknown): number { return (value as Face).x; }
export function prefix(n: number): number { return read(new Prefix(n)); }
export function one(n: number): number { return read(new ShiftOne(n)); }
export function two(n: number): number { return read(new ShiftTwo(n)); }
export function prefixControl(n: number): number { return new Prefix(n).x; }
export function oneControl(n: number): number { return new ShiftOne(n).x; }
export function twoControl(n: number): number { return new ShiftTwo(n).x; }

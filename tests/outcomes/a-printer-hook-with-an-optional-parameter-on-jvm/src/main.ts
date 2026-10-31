// run: check
// backend: jvm
// The optional parameter is callable with no arguments in JavaScript.
// Main declines String(value) at runtime; calling the same hook directly agrees.
// Compiler owner: compiler2, optional/default/rest printer admission (#146).
class Parent { toString(_n?: number): string { return "parent"; } }
class Child extends Parent { override toString(_n?: number): string { return "child"; } }
export function control(): string { return new Child().toString(); }
export function subject(): string { return String(new Child()); }

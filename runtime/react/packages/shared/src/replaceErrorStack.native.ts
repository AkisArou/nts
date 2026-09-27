// A native program keeps no record of its frames, so an error has no stack
// to replace: the server's is dropped, as its absence would be.

export function replaceErrorStack(_error: Error, _stack: string): void {}

// expect: NTS1100
// The archived probe calls both codecs. Each reduced pair changes only its
// callee, so neither unsupported codec can hide an unsupported control.
function sourceBtoa(value: string): string { return value === "hi" ? "aGk=" : ""; }
function sourceAtob(value: string): string { return value === "aGk=" ? "hi" : ""; }
export function subjectBtoa(): void { console.log("encoded", btoa("hi")); }
export function controlBtoa(): void { console.log("encoded", sourceBtoa("hi")); }
export function subjectAtob(): void { console.log("decoded", atob("aGk=")); }
export function controlAtob(): void { console.log("decoded", sourceAtob("aGk=")); }

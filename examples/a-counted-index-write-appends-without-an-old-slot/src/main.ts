// An append keeps the backing identity and transfers the new element's count.
export function strings(n: number): boolean {
 const items: string[] = []; items[0] = "first"; items[1] = "second";
 return items.length === 2 && items[0] === "first" && items[1] === "second";
}
export function nonempty(n: number): boolean {
 const items = ["first"]; items[items.length] = "second";
 return items.length === 2 && items[0] === "first" && items[1] === "second";
}
export function objects(n: number): boolean {
 const first = { value: n }; const second = { value: n + 1 };
 const items: { value: number }[] = []; items[0] = first; items[1] = second;
 return items[0] === first && items[1] === second && items.length === 2;
}
export function arrays(n: number): boolean {
 const first: number[] = [n]; const items: number[][] = [];
 items[0] = first; first[0] = n + 1;
 return items[0] === first && items.length === 1;
}
export function tagged(n: number): boolean {
 const items: unknown[] = []; items[0] = "first"; items[1] = 1n << 100n;
 items[2] = n > 0; items[3] = null; items[4] = undefined;
 return items.length === 5 && items[0] === "first" && items[1] === 1n << 100n
  && items[2] === (n > 0) && items[3] === null && items[4] === undefined;
}
export function missing(n: number): boolean {
 const items: (string | undefined)[] = []; items[0] = undefined; items[1] = "present";
 return items.length === 2 && items[0] === undefined && items[1] === "present";
}
export function aliased(n: number): boolean {
 const items: string[] = []; const alias = items; items[0] = "first";
 alias[1] = "second";
 return alias === items && items.length === 2 && items[1] === "second";
}
export function assignmentValue(n: number): boolean {
 const items: string[] = []; const result = items[0] = "installed";
 return result === "installed" && items[0] === result && items.length === 1;
}
export function overwrite(n: number): boolean {
 const items: string[] = []; items[0] = "old"; items[0] = "new";
 return items.length === 1 && items[0] === "new";
}
export function sameValue(n: number): boolean {
 const first = { value: n }; const items: { value: number }[] = [];
 items[0] = first; items[0] = first;
 return items.length === 1 && items[0] === first;
}
export function checked(n: number): boolean {
 const raw: unknown[] = []; const view = (raw as unknown) as string[];
 view[0] = "first"; view[1] = "second";
 return view === raw && view.length === 2 && view[0] === "first" && view[1] === "second";
}
let effects = 0;
function nextIndex(items: string[]): number { effects++; return items.length; }
function nextValue(): string { effects++; return "value"; }
export function evaluatedOnce(n: number): boolean {
 const items: string[] = []; const before = effects; items[nextIndex(items)] = nextValue();
 return effects - before === 2 && items.length === 1 && items[0] === "value";
}

function growsBeforeStore(items: string[]): string { items.push("middle"); return "replacement"; }
export function rightSideGrows(n: number): boolean {
 const items = ["first"]; items[items.length] = growsBeforeStore(items);
 return items.length === 2 && items[0] === "first" && items[1] === "replacement";
}
function receiver(items: string[]): string[] { effects++; return items; }
export function receiverOnce(n: number): boolean {
 const items: string[] = []; const before = effects;
 receiver(items)[nextIndex(items)] = nextValue();
 return effects - before === 3 && items.length === 1 && items[0] === "value";
}
export function reallocated(n: number): boolean {
 const items: string[] = []; const alias = items; const value = "value" + n;
 for (let i = 0; i < 40; i++) items[i] = value;
 for (let i = 0; i < items.length; i++) if (items[i] !== value) return false;
 alias.length = 0; items[0] = value;
 return alias === items && items.length === 1 && items[0] === value;
}
export function taggedObjects(n: number): boolean {
 const value = { count: n }; const items: unknown[] = [];
 items[0] = value; items[1] = value; items[0] = "replacement";
 return items.length === 2 && items[0] === "replacement" && items[1] === value;
}
export function denseAllocation(n: number): boolean {
 const items = new Array<string>(4); const value = "value" + n;
 for (let i = 0; i < 4; i++) items[i] = value;
 return items.length === 4 && items[0] === value && items[3] === value;
}

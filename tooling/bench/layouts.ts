// Link-order sampling for native comparisons. Orders vary placement, never
// optimization flags or program inputs. Validate actual addresses and bodies:
// an accepted but ineffective linker option is not a layout experiment.
export type Symbol = {name: string; address: number; bytes: number};

/** LTO can internalize an ordered name, and archive/shared functions may not
 * be orderable. Preserve those diagnostics; every other warning is fatal.
 * Address/body validation, rather than acceptance of an option, proves that
 * the functions being measured really received distinct layouts. */
export function orderingWarnings(stderr:string): string[] | null {
  const lines=stderr.split("\n").filter(line=>line.trim());
  return lines.every(line=>/^ld\.lld: warning: .+: unable to order (?:undefined|shared) symbol: \S+$/.test(line)) ? lines : null;
}

/** The text functions actually present after LTO, from nm -S --defined-only. */
export function textSymbols(nm: string): Symbol[] {
  const result: Symbol[] = [];
  const names = new Set<string>();
  for (const line of nm.split("\n")) {
    const match = /^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+[tTwW]\s+(\S+)$/.exec(line.trim());
    if (!match) continue;
    const [,pc,size,name] = match;
    const address = Number.parseInt(pc,16), bytes = Number.parseInt(size,16);
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(bytes)) throw Error("invalid text symbol");
    if (!bytes) continue;
    if (names.has(name)) throw Error("duplicate text symbol: "+name);
    names.add(name);result.push({name,address,bytes});
  }
  if (!result.length) throw Error("no sized text functions");
  return result.sort((a,b)=>a.name.localeCompare(b.name,"en"));
}

/** A reproducible permutation. Seed zero is disallowed, rather than selecting
 * a linker's clock-based randomness. The same symbol union/seed pairs arms. */
export function symbolOrder(names: readonly string[], seed: number): string[] {
  if (!Number.isSafeInteger(seed) || seed<=0 || seed>0xffff_ffff || new Set(names).size!==names.length) throw Error("invalid order input");
  let state=seed>>>0;
  const draw=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  const result=[...names].sort();
  for(let i=result.length-1;i>0;i--){const j=draw()%(i+1);[result[i],result[j]]=[result[j],result[i]];}
  return result;
}

/** Keep instruction offsets, opcodes, registers and literal constants. Only
 * resolved PC-relative references are normalized; replacing every hex number
 * would silently bless an arithmetic change as 'the same body'. */
export function body(disassembly: string, symbol: Symbol, constant?: (address:number,description:string,width:number)=>string|undefined): string {
  const result: string[]=[];
  for(const line of disassembly.split("\n")){
    const match=/^\s*([0-9a-fA-F]+):\s+(.+)$/.exec(line);if(!match)continue;
    const address=Number.parseInt(match[1],16);
    if(address<symbol.address || address>=symbol.address+symbol.bytes)continue;
    let instruction=match[2].trim();
    const comment=/\s+#\s*((?:0x)?[0-9a-f]+)\s+<([^>]+)>/.exec(instruction);
    if(comment && /\[rip[+-]/.test(instruction)){
      const widths:Record<string,number>={BYTE:1,WORD:2,DWORD:4,QWORD:8,XMMWORD:16,YMMWORD:32,ZMMWORD:64};
      const width=/\b(XMMWORD|YMMWORD|ZMMWORD|QWORD|DWORD|WORD|BYTE) PTR\b/.exec(instruction);
      const resolved=width&&constant?.(Number.parseInt(comment[1],16),comment[2],widths[width[1]]);
      instruction=instruction.replace(/\[rip[+-]0x[0-9a-f]+\]/g,"[rip+<"+(resolved||comment[2])+">]");
    }
    instruction=instruction.replace(/\s+#.*$/,"");
    if(/^(?:j\w+|call\w*|loop\w*)\s/.test(instruction))instruction=instruction.replace(/\b(?:0x)?[0-9a-f]+\s+<([^>]+)>/,"<$1>");
    result.push((address-symbol.address).toString(16)+": "+instruction.replace(/\s+/g," "));
  }
  if(!result.length || !result[0].startsWith("0:"))throw Error("missing function body: "+symbol.name);
  return result.join("\n");
}

export type Spread = {mean: number; min: number; max: number; sd: number; relativeRange: number};
/** The risk of choosing just one paired layout is the whole range of its
 * B/A effects, not either arm's timing range in isolation. */
export function layoutDeltas(layouts: readonly {timeA: number; timeB: number}[]) {
  if (layouts.length < 5 || layouts.some(l => !Number.isFinite(l.timeA) || !Number.isFinite(l.timeB) || l.timeA <= 0 || l.timeB <= 0)) throw Error('five finite paired layouts required');
  const values = layouts.map(l => l.timeB / l.timeA - 1);
  const min = Math.min(...values), max = Math.max(...values);
  return {values, min, max, span: max - min};
}
export function spread(values: readonly number[]): Spread {
  if(!values.length || values.some(v=>!Number.isFinite(v)||v<=0))throw Error("invalid measurements");
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const min=Math.min(...values),max=Math.max(...values);
  const sd=Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length);
  return{mean,min,max,sd,relativeRange:(max-min)/mean};
}

/** Equal weight for each layout, irrespective of process count. A conservative
 * decision floor includes both arms' full layout ranges and repeat drift. */
export function compareLayouts(base: readonly number[], changed: readonly number[], repeatFloor: number) {
  if(base.length<5 || base.length!==changed.length || !Number.isFinite(repeatFloor)||repeatFloor<0)throw Error("five paired layouts required");
  const a=spread(base),b=spread(changed),ratio=b.mean/a.mean;
  const floor=Math.max(a.relativeRange,b.relativeRange,repeatFloor);
  const verdict=Math.abs(ratio-1)<=floor ? "inside layout floor" : ratio<1 ? "improves" : "REGRESSES";
  return{base:a,changed:b,ratio,floor,verdict};
}

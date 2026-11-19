/** The ELF64 geometry shared by constant checks and executable-size linkage. */
function elfImage(image: Buffer) {
  if(image.length<64||image.subarray(0,4).toString('hex')!=='7f454c46'||image[4]!==2||image[5]!==1||image.readUInt16LE(18)!==62)throw Error('ELF64 x86-64 little-endian image required');
  const integer=(at:number)=>{
    if(at<0||at+8>image.length)throw Error('truncated ELF');
    const n=Number(image.readBigUInt64LE(at));if(!Number.isSafeInteger(n))throw Error('oversized ELF offset');return n;
  };
  const start=integer(32),stride=image.readUInt16LE(54),count=image.readUInt16LE(56);
  if(stride<56||start+stride*count>image.length)throw Error('invalid ELF program headers');
  const segments=[];
  for(let i=0;i<count;i++){
    const at=start+i*stride;
    if(image.readUInt32LE(at)!==1)continue;
    segments.push({offset:integer(at+8),address:integer(at+16),bytes:integer(at+32),flags:image.readUInt32LE(at+4)});
  }
  return { integer, start, stride, count, segments };
}

/** Loader and DT_NEEDED from the product itself; no section-table assumptions. */
export function elfLinkage(image: Buffer): { interpreter: string | null; needed: string[] } {
  const { integer, start, stride, count, segments } = elfImage(image);
  if (![2, 3].includes(image.readUInt16LE(16)) || count === 0) throw Error("ELF executable with program headers required");
  const stringAt = (at: number, limit: number): string => {
    const end = image.indexOf(0, at);
    if (at < 0 || limit > image.length || end < at || end >= limit) throw Error("truncated ELF string");
    return image.subarray(at, end).toString("utf8");
  };
  let interpreter: string | null = null, strings: number | undefined, stringBytes: number | undefined;
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = start + i * stride, type = image.readUInt32LE(at), offset = integer(at + 8), bytes = integer(at + 32);
    if (offset + bytes > image.length) throw Error("truncated ELF segment");
    if (type === 3) interpreter = stringAt(offset, offset + bytes);
    if (type !== 2) continue;
    if (bytes % 16 !== 0) throw Error("invalid ELF dynamic segment");
    let terminated = false;
    for (let entry = offset; entry < offset + bytes; entry += 16) {
      const tag = integer(entry), value = integer(entry + 8);
      if (tag === 0) { terminated = true; break; }
      if (tag === 1) offsets.push(value);
      if (tag === 5) strings = value;
      if (tag === 10) stringBytes = value;
    }
    if (!terminated) throw Error("unterminated ELF dynamic segment");
  }
  const needed = offsets.map(offset => {
    if (strings === undefined || stringBytes === undefined || offset >= stringBytes) throw Error("missing ELF string table");
    const segment = segments.find(s => strings! >= s.address && strings! + stringBytes! <= s.address + s.bytes);
    if (!segment) throw Error("ELF string table outside file segments");
    const base = segment.offset + strings - segment.address;
    return stringAt(base + offset, base + stringBytes);
  });
  return { interpreter, needed: [...new Set(needed)].sort() };
}

// Anonymous floating constants have no symbol. objdump then labels them as
// 'nearest_string + offset', which changes when data sections move. Compare
// their actual bytes; named objects retain their symbol identity instead.
export function readOnlyConstants(image:Buffer,nm:string) {
  const { segments: allSegments } = elfImage(image);
  const segments = allSegments.filter(segment => (segment.flags & 2) === 0);
  const named=new Map<string,{address:number;bytes:number}>();
  for(const line of nm.split('\n')){
    const match=/^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+[rRdDbBvV]\s+(\S+)$/.exec(line.trim());
    if(match)named.set(match[3],{address:Number.parseInt(match[1],16),bytes:Number.parseInt(match[2],16)});
  }
  return (address:number,description:string,width:number):string|undefined=>{
    const name=description.replace(/\+0x[0-9a-f]+$/,'');
    const symbol=named.get(name);
    if(symbol&&address>=symbol.address&&address<symbol.address+symbol.bytes)return undefined;
    if(!Number.isSafeInteger(address)||![1,2,4,8,16,32,64].includes(width))throw Error('invalid constant reference');
    const segment=segments.find(s=>address>=s.address&&address+width<=s.address+s.bytes);
    if(!segment)return undefined;
    const at=segment.offset+address-segment.address;
    if(at+width>image.length)throw Error('constant outside ELF');
    return 'constant:'+width+':'+image.subarray(at,at+width).toString('hex');
  };
}

// Anonymous floating constants have no symbol. objdump then labels them as
// 'nearest_string + offset', which changes when data sections move. Compare
// their actual bytes; named objects retain their symbol identity instead.
export function readOnlyConstants(image:Buffer,nm:string) {
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
    if(image.readUInt32LE(at)!==1||(image.readUInt32LE(at+4)&2)!==0)continue;
    segments.push({offset:integer(at+8),address:integer(at+16),bytes:integer(at+32)});
  }
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

// One finite framing contract for the private observer/helper channel. FIFO
// reads and writes need not preserve message boundaries or complete at once.
export const IMAGE_READER_FRAME_BYTES=1<<20;
export function imageReaderFrame(value:unknown):Buffer{
  const text=JSON.stringify(value);if(text===undefined)throw Error('image reader protocol: frame is not JSON');
  const body=Buffer.from(text);
  if(!body.length||body.length>IMAGE_READER_FRAME_BYTES)throw Error('image reader protocol: frame exceeds its bound');
  const result=Buffer.allocUnsafe(body.length+4);result.writeUInt32BE(body.length);body.copy(result,4);return result;
}
export async function* readImageReaderFrames(input:AsyncIterable<Uint8Array>):AsyncGenerator<unknown>{
  const header=Buffer.alloc(4);let headerBytes=0,body:Buffer|undefined,bodyBytes=0;
  for await(const chunk of input){
    let at=0;
    while(at<chunk.length){
      if(!body){
        const count=Math.min(4-headerBytes,chunk.length-at);header.set(chunk.subarray(at,at+count),headerBytes);headerBytes+=count;at+=count;
        if(headerBytes<4)continue;
        const size=header.readUInt32BE();
        if(!size||size>IMAGE_READER_FRAME_BYTES)throw Error('image reader protocol: invalid frame length '+size);
        body=Buffer.allocUnsafe(size);bodyBytes=0;
      }
      const count=Math.min(body.length-bodyBytes,chunk.length-at);body.set(chunk.subarray(at,at+count),bodyBytes);bodyBytes+=count;at+=count;
      if(bodyBytes===body.length){
        let value:unknown;try{value=JSON.parse(body.toString('utf8'));}catch(error){throw Error('image reader protocol: malformed JSON frame',{cause:error});}
        body=undefined;headerBytes=0;bodyBytes=0;yield value;
      }
    }
  }
  if(body||headerBytes)throw Error('image reader protocol: short frame ('+(body?bodyBytes+'/'+body.length+' body bytes':headerBytes+'/4 header bytes')+')');
}

// One finite framing contract for the private observer/helper channel. FIFO
// reads and writes need not preserve message boundaries or complete at once.
// Linux execve limits argv + envp together to at most 3/4 of _STK_LIM
// (8 MiB), regardless of RLIMIT_STACK; MAX_ARG_STRLEN is 32 native pages
// (128 KiB on a 4 KiB-page kernel). Pointer overhead only lowers that budget.
// Hex doubles the combined strings. Keep the loader reply's original bound;
// metadata covers pathname/resolution facts, task context and JSON framing.
export const EXEC_VECTOR_BYTES=3*(8*1024*1024)/4;
export const EXEC_STRING_PAGES=32;
export const IMAGE_READER_REPLY_BYTES=1<<20;
export const IMAGE_READER_METADATA_BYTES=1<<20;
export const IMAGE_READER_FRAME_BYTES=2*EXEC_VECTOR_BYTES+IMAGE_READER_REPLY_BYTES+IMAGE_READER_METADATA_BYTES;
export const OBSERVATION_VERSION=7;
// One compiler argument supplies every native limit, with no C-side defaults.
export const IMAGE_READER_COMPILER_DEFINITION='-DIMAGE_READER_LIMITS=enum {'+
  Object.entries({EXEC_VECTOR_BYTES,EXEC_STRING_PAGES,IMAGE_READER_REPLY_BYTES,IMAGE_READER_METADATA_BYTES,IMAGE_READER_FRAME_BYTES,OBSERVATION_VERSION}).map(([key,value])=>key+'='+value).join(',')+'};';
function frame(value:unknown,limit:number):Buffer{
  const text=JSON.stringify(value);if(text===undefined)throw Error('image reader protocol: frame is not JSON');
  const body=Buffer.from(text);
  if(!body.length||body.length>limit)throw Error('image reader protocol: frame exceeds its bound');
  const result=Buffer.allocUnsafe(body.length+4);result.writeUInt32BE(body.length);body.copy(result,4);return result;
}
export function imageReaderFrame(value:unknown):Buffer{return frame(value,IMAGE_READER_FRAME_BYTES);}
export function imageReaderReply(value:unknown):Buffer{return frame(value,IMAGE_READER_REPLY_BYTES);}
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

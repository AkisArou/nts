// Source control for builtin-study-web-textdecoder. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceDecoder { decode(value: Uint8Array): string { return String.fromCharCode(value[0], value[1]); } }

export function webTextdecoderControl(): string {
  return new SourceDecoder().decode(new Uint8Array([104, 105]));
}

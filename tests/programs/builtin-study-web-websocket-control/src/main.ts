// Source control for builtin-study-web-websocket. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceSocket { readyState = 0; constructor(public url: string) {} }

export function webWebsocketControl(): string {
  const w = new SourceSocket("ws://127.0.0.1:9/"); return w.url + ":" + w.readyState;
}

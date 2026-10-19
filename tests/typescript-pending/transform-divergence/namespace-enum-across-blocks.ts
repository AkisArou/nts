/*---
description: In a merged namespace, an enum exported by an earlier block is read unqualified in a later block.
features: [ts-namespace, ts-declaration-merging, ts-enum]
---*/
namespace Net {
  export enum Port { Http = 80 }
}
namespace Net {
  export const defaultPort = Port.Http;
}
assert.sameValue(Net.defaultPort, 80);

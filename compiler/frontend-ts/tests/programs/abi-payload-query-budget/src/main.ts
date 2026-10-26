// A finite chain: exhaustion must not depend on checker recursion or fresh-ID caching.
type LongMap<K, V> = Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, Map<K, V>>>>>>>>>>>>>>>>>>>>>>>>;
declare function demanded<K, V>(): Promise<LongMap<K, V>>;
// The same return must remain shallow when the generic callable is unused.
declare function unused<K, V>(): Promise<LongMap<K, V>>;
type Payload = { entries: (number | undefined)[] };
declare function ownedPayload(): Payload;
declare function latePayload(): Promise<Payload>;

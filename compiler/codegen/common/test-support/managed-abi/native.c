#include "native.h"
NtsString *bridge_text(NtsString *v) { nts_retain(v); return v; }
NtsArray *bridge_array(NtsArray *v) {
    NTS_ITEMS(v, double)[1] += 0.125;
    nts_array_push(v, 9.5);
    nts_retain((NtsHeader *)v); return v;
}
double bridge_callback(NtsHeader *cb, double n) {
    return ((double (*)(NtsHeader *, double))cb->descriptor->methods[nts_closure_call_slot])(cb, n);
}
double bridge_nested(NtsValue v, double n) {
    struct Callbacks { NtsHeader header; NtsHeader *callback; };
    return bridge_callback(((struct Callbacks *)v.as.reference)->callback, n);
}
NtsValue bridge_value(NtsValue v) { return v; }
__int128 bridge_bigint(__int128 v) { return v + 7; }
void bridge_object(NtsHeader *v) {
    struct Box { NtsHeader header; double count; };
    ((struct Box *)v)->count = 5.75;
}
void bridge_hidden(NtsValue v) {
    if (v.tag != NTS_TAG_OBJECT) return;
    struct Hidden { NtsHeader header; double hidden; };
    ((struct Hidden *)v.as.reference)->hidden = 8.5;
}

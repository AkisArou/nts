// SIGSEGV. Object.entries reads each own key's value in order, and a key
// deleted by an earlier getter is skipped: two entries, not three. nts
// crashes. Reading the getter alone agrees, so the crash is Object.entries
// meeting a key deleted part way. Found by test262's Object/entries/getter-
// removing-future-key.js (and Object/values' twin). An abort erases every
// observation, so the control is its own fixture: object-entries-of-an-
// object-with-a-getter, whose getter deletes nothing.
const deletes = {
  a: "A",
  get b() {
    // @ts-expect-error -- JavaScript: delete any property
    delete this.c;
    return "B";
  },
  c: "C",
};
observe("entries", Object.entries(deletes).map((e) => e[0] + "=" + e[1]).join(","));
done();

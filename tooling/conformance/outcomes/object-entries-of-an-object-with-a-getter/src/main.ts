// The control for object-entries-after-a-getter-deletes-a-later-key: the
// getter deletes nothing, and differs in that statement only.
const keeps = {
  a: "A",
  get b() {
    return "B";
  },
  c: "C",
};
observe("entries", Object.entries(keeps).map((e) => e[0] + "=" + e[1]).join(","));
done();

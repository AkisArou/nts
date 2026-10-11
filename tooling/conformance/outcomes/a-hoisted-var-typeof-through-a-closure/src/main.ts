// A var binding exists as undefined at function entry. The checker infers
// number from the later initializer, but that does not justify folding an
// earlier closure read's typeof to "number".
function earlyTypeof() {
  function reader() { return typeof value; }
  const seen = reader();
  var value = 1;
  return seen;
}
observe("typeof", earlyTypeof());
done();

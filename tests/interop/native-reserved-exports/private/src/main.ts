class Foo_ { constructor(public __nts_value_propget: number) {} }
let __nts_value_propget = 42;
function __nts_desc_Foo(value: Foo_): number { return value.__nts_value_propget + 1; }
console.log(String(__nts_desc_Foo(new Foo_(__nts_value_propget))));

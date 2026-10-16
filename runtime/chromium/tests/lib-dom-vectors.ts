// Differential vectors for lib.dom by delegation: a program typed by the
// stock lib.dom.d.ts alone, with no nts:dom import, as page script is. The
// compiled side reaches Blink through the bindings lib.dom is bound to
// (dom/types/lib-dom-bindings.d.ts); the oracle runs this same source with
// only its types stripped. Each step appends a line to a transcript, and the
// two transcripts must be equal.
//
// First, what the delegation adds beyond a renamed call: iterating lib.dom's
// generic collections (NodeListOf, HTMLCollectionOf) while the loop body
// changes the list. A live list is read afresh at every step -- an
// iterator and forEach both hold an index, not a copy -- so removing the
// visited node skips its successor, and a static list (querySelectorAll)
// visits every node it was made with.

async function settle(label: string, run: () => Promise<void>): Promise<void> {
  let outcome = "fulfilled";
  try {
    await run();
  } catch (error) {
    // V8's binding prefixes an exception it turns into a rejection with its
    // context ("Failed to execute 'x' on 'Y': ", and for a dictionary's
    // member "Failed to read the 'm' property from 'D': "); the program's
    // has none.
    let message = (error as Error).message;
    if (message.startsWith("Failed to ")) message = message.slice(message.lastIndexOf("': ") + 3);
    outcome = "rejected " + (error as Error).name + ": " + message;
  }
  document.querySelector("#native-lib-dom")?.setAttribute("data-" + label, outcome);
}

// The same for a promise fulfilled with text: the text is the outcome.
async function settleText(label: string, run: () => Promise<string>): Promise<void> {
  let outcome = "";
  try {
    outcome = "fulfilled " + (await run());
  } catch (error) {
    outcome = "rejected " + (error as Error).name;
  }
  document.querySelector("#native-lib-dom")?.setAttribute("data-" + label, outcome);
}

// fetch, from a data: URL: the Response it fulfils with, and its body read
// as text (Response.text(), a second promise).
async function settleFetch(label: string): Promise<void> {
  let outcome = "";
  try {
    const response = await fetch("data:text/plain;charset=utf-8,hello%20nts");
    const body = await response.text();
    outcome = "fulfilled " + response.status + " " + (response.ok ? "ok" : "not ok") + " " +
      (response.headers.get("content-type") ?? "none") + " " + body;
  } catch (error) {
    outcome = "rejected " + (error as Error).name;
  }
  document.querySelector("#native-lib-dom")?.setAttribute("data-" + label, outcome);
}

// Promises fulfilled with bytes, each the program's own copy: a response's
// body as a Uint8Array and as an ArrayBuffer, a blob's (the response's, as
// a Blob) as a Uint8Array, and an empty blob's as an ArrayBuffer.
async function settleBytes(label: string): Promise<void> {
  let outcome = "";
  try {
    const bytes = await (await fetch("data:text/plain,hi%21")).bytes();
    const buffer = await (await fetch("data:text/plain,hey")).arrayBuffer();
    const blob = await (await fetch("data:text/plain,ab")).blob();
    const fromBlob = await blob.bytes();
    const empty = await new Blob().arrayBuffer();
    const first = new Uint8Array(buffer);
    outcome = "fulfilled " + bytes.length + ":" + bytes[0] + "," + bytes[2] + "|" + buffer.byteLength + ":" + first[0] +
      "," + first[2] + "|" + fromBlob.length + ":" + fromBlob[1] + "|" + empty.byteLength;
  } catch (error) {
    outcome = "rejected " + (error as Error).name;
  }
  document.querySelector("#native-lib-dom")?.setAttribute("data-" + label, outcome);
}

// The same for a promise fulfilled with a DOM object: the stylesheet
// replace() settles with is the one it was called on, holding the new rule.
async function settleSheet(label: string): Promise<void> {
  let outcome = "";
  try {
    const sheet = new CSSStyleSheet();
    const replaced = await sheet.replace("p { color: red } .x { margin: 0 }");
    outcome = "fulfilled " + (replaced === sheet ? "same" : "other") + " " + replaced.cssRules.length;
  } catch (error) {
    outcome = "rejected " + (error as Error).name;
  }
  document.querySelector("#native-lib-dom")?.setAttribute("data-" + label, outcome);
}

export function libDomTranscript(): string {
  const lines: string[] = [];
  const log = (label: string, value: string): void => {
    lines.push(label + "=" + value);
  };
  const root = document.createElement("section");
  document.body.appendChild(root);

  const list = (count: number): HTMLUListElement => {
    const ul = document.createElement("ul");
    for (let i = 0; i < count; i++) {
      const li = document.createElement("li");
      li.textContent = "i" + i;
      ul.appendChild(li);
    }
    root.appendChild(ul);
    return ul;
  };
  // Each case is a block of its own. A forEach case's callback appends to a
  // `let` it captures, read after the forEach: with `root`, an owned handle,
  // above it, this is the shape whose read once followed its release under RC
  // (blockers/a-captured-let-read-after-a-bound-for-each).
  const rest = (ul: HTMLUListElement): string => {
    let text = "";
    for (const child of ul.childNodes) text += "," + child.textContent;
    return ul.childNodes.length + text;
  };

  // A live NodeList (childNodes), each visited node removed.
  {
    const ul = list(5);
    let visited = "";
    for (const child of ul.childNodes) {
      visited += "," + child.textContent;
      ul.removeChild(child);
    }
    log("live-forOf-remove", visited + " left " + rest(ul));
  }
  {
    const ul = list(5);
    let visited = "";
    ul.childNodes.forEach((child: ChildNode): void => {
      visited += "," + child.textContent;
      ul.removeChild(child);
    });
    log("live-forEach-remove", visited + " left " + rest(ul));
  }

  // A static NodeList (querySelectorAll): every node it was made with.
  {
    const ul = list(5);
    let visited = "";
    for (const item of ul.querySelectorAll("li")) {
      visited += "," + item.textContent;
      ul.removeChild(item);
    }
    log("static-forOf-remove", visited + " left " + rest(ul));
  }
  {
    const ul = list(5);
    let visited = "";
    ul.querySelectorAll("li").forEach((item: HTMLLIElement): void => {
      visited += "," + item.textContent;
      ul.removeChild(item);
    });
    log("static-forEach-remove", visited + " left " + rest(ul));
  }

  // A live HTMLCollection (children), each visited element removed.
  {
    const ul = list(5);
    let visited = "";
    for (const item of ul.children) {
      visited += "," + item.textContent;
      ul.removeChild(item);
    }
    log("collection-forOf-remove", visited + " left " + rest(ul));
  }

  // Appending while iterating a live list: the loop sees what it appended.
  {
    const ul = list(2);
    let visited = "";
    for (const child of ul.childNodes) {
      visited += "," + child.textContent;
      if (ul.childNodes.length < 5) {
        const li = document.createElement("li");
        li.textContent = "n" + ul.childNodes.length;
        ul.appendChild(li);
      }
    }
    log("live-forOf-append", visited);
  }
  {
    const ul = list(2);
    let visited = "";
    ul.childNodes.forEach((child: ChildNode): void => {
      visited += "," + child.textContent;
      if (ul.childNodes.length < 5) {
        const li = document.createElement("li");
        li.textContent = "n" + ul.childNodes.length;
        ul.appendChild(li);
      }
    });
    log("live-forEach-append", visited);
  }

  // Moving the visited node to the end of its own list: a live list sees it
  // again, so the loop is bounded by a count of its own.
  {
    const ul = list(3);
    let steps = 0;
    let visited = "";
    for (const child of ul.childNodes) {
      if (steps === 5) break;
      visited += "," + child.textContent;
      ul.appendChild(child);
      steps += 1;
    }
    log("live-forOf-move", visited + " left " + rest(ul));
  }

  // A typed element list: getElementsByTagName("li") is
  // HTMLCollectionOf<HTMLLIElement>, so `value` is the li's own attribute.
  {
    const ul = list(3);
    let values = "";
    for (const li of ul.getElementsByTagName("li")) {
      li.value = li.textContent!.length * 10;
      values += "," + li.value;
    }
    log("typed-collection", values + " attr " + ul.lastElementChild!.getAttribute("value"));
  }

  // A MutationObserver typed by lib.dom: takeRecords() is a MutationRecord[],
  // read as an array.
  {
    const ul = list(2);
    const observer = new MutationObserver((records: MutationRecord[]): void => {});
    observer.observe(ul, { childList: true, attributes: true, attributeOldValue: true });
    ul.setAttribute("data-state", "one");
    ul.appendChild(document.createElement("li"));
    ul.removeChild(ul.firstChild!);
    const records = observer.takeRecords();
    let seen = "" + records.length;
    for (const record of records) seen += "," + record.type + "/" + record.addedNodes.length + "/" + record.removedNodes.length;
    observer.disconnect();
    log("mutation-records", seen + " " + records[0].attributeName + " " + records[0].oldValue);
  }

  // Its callback is called with the records as an array, after this returns
  // (a microtask): it writes what it was given on the transcript's element,
  // which the caller has made by then (#native-lib-dom, data-observed).
  {
    const ul = list(1);
    const delivered = new MutationObserver((records: MutationRecord[], observer: MutationObserver): void => {
      let text = "" + records.length;
      for (const record of records) text += "," + record.type;
      document.querySelector("#native-lib-dom")?.setAttribute("data-observed", text + " last " + records[records.length - 1].type);
      observer.disconnect();
    });
    delivered.observe(ul, { childList: true, characterData: true, subtree: true });
    ul.appendChild(document.createElement("li"));
    ul.firstChild!.textContent = "changed";
    ul.lastChild!.remove();
  }

  // Static operations, as page script calls them: lib.dom's `URL.canParse`
  // is the binding's URL_canParse.
  {
    const rect = DOMRect.fromRect({ x: 1, y: 2, width: 3, height: 4 });
    const parsed = Document.parseHTMLUnsafe("<p id=q>static</p>");
    log("statics", (URL.canParse("https://x.test/") ? "can" : "cannot") + "|" + (URL.canParse("no scheme") ? "can" : "cannot") + "|" +
      rect.right + "," + rect.bottom + "|" + (AbortSignal.abort().aborted ? "aborted" : "live") + "|" + parsed.querySelector("#q")!.textContent);
  }

  // fetch's own types. A ByteString (a header, a method) is a string whose
  // every unit is at most 0xFF -- "café" is one -- and one above throws
  // TypeError before Blink is called. V8's message carries its context
  // first ("Failed to execute 'set' on 'Headers': "); the program's does not.
  {
    const failure = (run: () => void): string => {
      try {
        run();
        return "ok";
      } catch (error) {
        const message = (error as Error).message;
        const at = message.lastIndexOf("': ");
        const text = at < 0 ? message : message.slice(at + 3);
        // The program's is an Error whose message is "Name: message"; page
        // script's is the named error itself (ledger row 27).
        return (error as Error).name === "Error" ? text : (error as Error).name + ": " + text;
      }
    };
    const headers = new Headers();
    headers.set("X-Name", "café");
    headers.append("x-list", "a");
    headers.append("X-List", "b");
    log("headers", (headers.get("x-name") ?? "null") + "|" + (headers.get("x-list") ?? "null") + "|" +
      (headers.has("X-LIST") ? "has" : "lacks") + "|" + (headers.get("absent") ?? "null"));
    headers.delete("x-list");
    log("headersDeleted", headers.has("x-list") ? "has" : "lacks");
    log("headersWide", failure((): void => headers.set("x-name", "✓")));
    log("headersBadName", failure((): void => headers.set("bad name", "v")));
    const request = new Request("https://x.test/a", { method: "post" });
    log("request", request.method + "|" + request.url);
    log("requestWide", failure((): void => {
      new Request("https://x.test/", { method: "✓" });
    }));
  }
  // An event handler attribute read back, under lib.dom's types: the
  // function written, null before and after.
  {
    const target = document.createElement("div");
    const before = target.onclick === null;
    const clicked = (event: MouseEvent): void => {};
    target.onclick = clicked;
    const same = target.onclick === clicked;
    target.onclick = null;
    log("onclickRead", (before ? "null" : "set") + "|" + (same ? "same" : "other") + "|" + (target.onclick === null ? "null" : "set"));
  }

  // crypto (Blink's modules component): a version-4 UUID's shape, and two
  // that differ; the values themselves are random.
  {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    let v4 = first.length === 36 && first.charAt(14) === "4" && "89ab".includes(first.charAt(19));
    for (let i = 0; i < first.length; i++) {
      const dash = i === 8 || i === 13 || i === 18 || i === 23;
      if (dash !== (first.charAt(i) === "-") || (!dash && !"0123456789abcdef".includes(first.charAt(i)))) v4 = false;
    }
    log("uuid", (v4 ? "v4" : "not v4: " + first) + "|" + (first === second ? "repeated" : "distinct"));
  }

  // Sequences of strings a method answers, read as lib.dom's arrays: a new
  // array at each call, as WebIDL makes page script's. Attribute names in
  // order, and a query's repeated parameter -- decoded past Latin-1, to
  // 16-bit units and a surrogate pair -- and one it lacks.
  {
    const element = document.createElement("div");
    element.setAttribute("id", "a");
    element.setAttribute("data-b", "2");
    element.setAttribute("aria-label", "\u00fc\u20ac");
    const names = element.getAttributeNames();
    log("attributeNames", names.join(",") + "|" + (names === element.getAttributeNames() ? "same" : "fresh"));
    const params = new URL("https://example.com/?q=1&q=%E2%82%AC&q=%F0%9F%98%80&r=").searchParams;
    const found = params.getAll("q");
    log("getAll", found.length + ":" + found.join(",") + ":" + found[2].length + "|" + params.getAll("none").length);
  }

  // A URLSearchParams made from a string (its init's string arm): the
  // leading "?" dropped, percent-decoding, a repeated name, and a lone
  // surrogate, which the USVString conversion makes U+FFFD before parsing.
  {
    const params = new URLSearchParams("?a=1&b=%E2%82%AC&a=3&" + String.fromCharCode(0xd800) + "=z");
    params.append("c", "x y");
    log("urlSearchParams", params.toString() + "|" + params.getAll("a").join(",") + "|" + params.get("b") + "|" +
      params.has("\ufffd"));
  }

  // A MediaQueryListEvent, made and read: what a `change` listener on
  // matchMedia's list is given.
  {
    const event = new MediaQueryListEvent("change", { media: "(min-width: 1px)", matches: true });
    log("mediaQueryListEvent", event.type + "|" + event.media + "|" + event.matches + "|" +
      new MediaQueryListEvent("change").media.length);
  }

  // An IntersectionObserver's options refused: a rootMargin Blink does not
  // parse is page script's SyntaxError. Compared by the message's last
  // clause: page script's carries V8's context ("Failed to construct ...: "),
  // the program's the name (workarounds.md, 27).
  {
    let refused = "none";
    try {
      new IntersectionObserver((): void => {}, { rootMargin: "1em" });
    } catch (error) {
      const message = (error as Error).message;
      refused = message.slice(message.lastIndexOf(": ") + 2);
    }
    log("intersectionRootMargin", refused);
  }

  // The rest of HTML's elements, each by its own interface: what a setter
  // reflects, read back as Blink normalizes it -- an attribute's renamed
  // content name (httpEquiv), an invalid enumerated value's default (kind),
  // a clamp (span), a URL split by its parts, a collection of the map's
  // areas -- and the defaults of members of their own.
  {
    const heading = document.createElement("h2");
    heading.align = "left";
    const hr = document.createElement("hr");
    hr.noShade = true;
    hr.size = "3";
    const pre = document.createElement("pre");
    pre.width = -5;
    const br = document.createElement("br");
    br.clear = "all";
    const title = document.createElement("title");
    title.text = "a & b";
    log("htmlText", heading.outerHTML + "|" + hr.outerHTML + "|" + pre.width + "|" + br.clear + "|" + title.innerHTML);

    const meta = document.createElement("meta");
    meta.httpEquiv = "refresh";
    meta.content = "5";
    meta.name = "viewport";
    const time = document.createElement("time");
    time.dateTime = "2024-01-02";
    const data = document.createElement("data");
    data.value = "42";
    const quote = document.createElement("q");
    quote.cite = "https://example.com/q";
    const del = document.createElement("del");
    del.dateTime = "2020";
    del.cite = "https://example.com/d";
    const group = document.createElement("optgroup");
    group.label = "g";
    group.disabled = true;
    log("htmlMeta", meta.getAttribute("http-equiv") + ":" + meta.content + ":" + meta.name + "|" + time.dateTime + "|" +
      data.value + "|" + quote.cite + "|" + del.dateTime + "@" + del.cite + "|" + group.outerHTML);

    const area = document.createElement("area");
    area.href = "https://user@example.com:8080/p/q?x=1#h";
    area.shape = "circle";
    area.coords = "1,2,3";
    area.rel = "next help";
    const map = document.createElement("map");
    map.name = "m";
    map.appendChild(area);
    map.appendChild(document.createElement("area"));
    const base = document.createElement("base");
    base.href = "https://example.com/b/";
    base.target = "_top";
    log("htmlLinks", area.protocol + "|" + area.username + "|" + area.host + "|" + area.pathname + "|" + area.search + "|" +
      area.hash + "|" + area.shape + ":" + area.coords + "|" + area.relList.length + "|" + map.areas.length + "|" +
      base.href + ":" + base.target);

    const track = document.createElement("track");
    track.kind = "bogus";
    track.srclang = "en";
    track.label = "English";
    const col = document.createElement("col");
    col.span = 2000;
    const source = document.createElement("source");
    source.srcset = "a.png 1x, b.png 2x";
    source.media = "(min-width: 1px)";
    source.type = "image/png";
    const picture = document.createElement("picture");
    picture.appendChild(source);
    const marquee = document.createElement("marquee");
    log("htmlMedia", track.kind + "|" + track.srclang + ":" + track.label + "|" + track.readyState + "|" + track.default + "|" +
      col.span + "|" + source.srcset + "|" + source.media + "|" + source.type + "|" + picture.childElementCount + "|" +
      marquee.scrollAmount + ":" + marquee.direction + ":" + marquee.loop);

    const object = document.createElement("object");
    object.data = "https://example.com/x.bin";
    object.type = "application/x-nts";
    object.width = "10";
    const embed = document.createElement("embed");
    embed.src = "https://example.com/e.bin";
    embed.height = "4";
    const param = document.createElement("param");
    param.name = "p";
    param.value = "v";
    log("htmlEmbedded", object.data + "|" + object.type + "|" + object.width + "|" + object.willValidate + "|" +
      object.checkValidity() + "|" + (object.form === null) + "|" + (object.contentDocument === null) + "|" + embed.src + ":" +
      embed.height + "|" + param.name + "=" + param.value);

    const body = document.createElement("body");
    body.link = "red";
    body.bgColor = "#fff";
    const html = document.createElement("html");
    html.version = "5";
    const font = document.createElement("font");
    font.color = "blue";
    font.face = "serif";
    font.size = "+1";
    const list = document.createElement("dl");
    list.compact = true;
    const menu = document.createElement("menu");
    const frameset = document.createElement("frameset");
    frameset.cols = "50%,*";
    const frame = document.createElement("frame");
    frame.noResize = true;
    frame.scrolling = "no";
    log("htmlLegacy", body.outerHTML + "|" + html.version + "|" + font.outerHTML + "|" + list.compact + ":" + menu.compact + "|" +
      frameset.cols + "|" + frame.noResize + ":" + frame.scrolling);
  }

  // A range's containers, which this Blink declares on NodeRange (behind
  // OpaqueRange) or on AbstractRange (behind its inverse): page script's
  // either way, read through lib.dom's AbstractRange.
  {
    const paragraph = document.createElement("p");
    paragraph.append("ab", document.createElement("b"));
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const whole = range.startContainer.nodeName + ":" + range.startOffset + "-" + range.endContainer.nodeName + ":" + range.endOffset;
    const text = paragraph.firstChild;
    if (text !== null) range.setStart(text, 1);
    log("rangeContainers", whole + "|" + range.startContainer.nodeName + ":" + range.startOffset + "-" +
      (range.endContainer === paragraph) + ":" + range.endOffset + "|" + range.collapsed);
  }

  // SVG by its own interfaces: a length set as a number and read in its
  // unit, one set in ems and converted, an animated value's base and the
  // attribute it writes, a path's length and a text's advance (measured by
  // layout), an SVG element's style and dataset (HTMLOrSVGElement), and a
  // gradient's units, an enumeration.
  {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "200");
    svg.setAttribute("height", "100");
    svg.setAttribute("style", "font-size: 10px");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", "10");
    circle.cx.baseVal.value = 20;
    const rect = document.createElementNS(ns, "rect");
    rect.width.baseVal.valueAsString = "2em";
    const width = rect.width.baseVal;
    const em = width.valueInSpecifiedUnits + ":" + width.unitType;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M0 0 L30 40 L30 0");
    const text = document.createElementNS(ns, "text");
    text.textContent = "nts";
    const gradient = document.createElementNS(ns, "linearGradient");
    gradient.gradientUnits.baseVal = 1;
    svg.append(circle, rect, path);
    svg.appendChild(text);
    svg.appendChild(gradient);
    root.appendChild(svg);
    // Converted once in the document, where an em has a font size to
    // resolve against (Blink's NotSupportedError before). SVGLength.
    // SVG_LENGTHTYPE_PX and SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE by value:
    // a constant read through its interface is the compiler's
    // (workarounds.md, 31).
    width.convertToSpecifiedUnits(5);
    circle.style.fill = "red";
    circle.dataset.kind = "dot";
    log("svgLengths", circle.r.baseVal.value + "|" + circle.cx.baseVal.valueAsString + "|" + circle.getAttribute("cx") + "|" +
      em + ">" + width.value + ":" + width.unitType + "|" + rect.getAttribute("width") + "|" + path.getTotalLength() + "|" +
      (text.getComputedTextLength() > 0) + ":" + text.getNumberOfChars() + "|" + circle.getAttribute("style") + "|" +
      circle.getAttribute("data-kind") + "|" + gradient.getAttribute("gradientUnits") + "|" + (circle.ownerSVGElement === svg));
  }

  // DOMMatrix: parsed from a transform list, read, inverted, scaled, a
  // point carried through, and written back as text.
  {
    const matrix = new DOMMatrix("translate(10px, 20px) scale(2)");
    const inverse = matrix.inverse();
    const doubled = matrix.scale(2);
    const point = matrix.transformPoint({ x: 1, y: 1 });
    matrix.translateSelf(5, 5);
    log("domMatrix", matrix.a + "," + matrix.e + "," + matrix.f + "|" + inverse.e + "," + inverse.a + "|" + doubled.a + "," +
      doubled.e + "|" + point.x + "," + point.y + "," + point.w + "|" + matrix.is2D + "," + matrix.isIdentity + "|" +
      matrix.toString() + "|" + new DOMMatrix().isIdentity);

    // Objects where a dictionary is read: WebIDL reads each member through
    // the object's getter, so a matrix multiplies a matrix, a point is
    // carried through one, a canvas takes back the transform it answered,
    // and a rect is copied from a rect.
    const rotate = new DOMMatrix("rotate(90deg)");
    const product = matrix.multiply(rotate);
    const copied = DOMMatrix.fromMatrix(rotate);
    const moved = new DOMPoint(1, 0).matrixTransform(rotate);
    const context = document.createElement("canvas").getContext("2d");
    let taken = "none";
    if (context !== null) {
      context.translate(3, 4);
      context.setTransform(context.getTransform().scale(2));
      const back = context.getTransform();
      taken = back.a + "," + back.e + "," + back.f;
    }
    const rect = DOMRect.fromRect(new DOMRect(1, 2, 3, 4));
    log("domObjects", product.a + "," + product.b + "," + product.e + "|" + copied.b + "," + copied.is2D + "|" +
      Math.round(moved.x) + "," + Math.round(moved.y) + "|" + taken + "|" + rect.right + "," + rect.bottom);
  }

  // A form's controls and a select's options, as collections of their own:
  // counted and read by index, options added and removed through the
  // collection with the selected index following, and the user activation
  // the page has (none: nothing was clicked).
  {
    const form = document.createElement("form");
    const who = document.createElement("input");
    who.name = "who";
    const pick = document.createElement("select");
    form.append(who, pick);
    for (const label of ["a", "b", "c"]) {
      const option = document.createElement("option");
      option.text = label;
      pick.options.add(option);
    }
    pick.options.selectedIndex = 2;
    pick.options.remove(0);
    const first = pick.options.item(0);
    const control = form.elements.item(1);
    log("formCollections", form.elements.length + "|" + (control === null ? "none" : control.tagName) + "|" +
      pick.options.length + "|" + (first === null ? "none" : first.text) + "|" + pick.options.selectedIndex + ":" + pick.value +
      "|" + navigator.userActivation.hasBeenActive);
  }

  // A table built row by row, as an app renders a list into one: a body
  // made, rows inserted at the end and at the front, a cell's and a row's
  // positions, a caption, a row deleted.
  {
    const table = document.createElement("table");
    const body = table.createTBody();
    for (const label of ["a", "b"]) {
      const row = body.insertRow();
      row.insertCell().textContent = label;
      row.insertCell().textContent = label.toUpperCase();
    }
    body.insertRow(0).insertCell().textContent = "head";
    const third = body.rows.item(2);
    const cell = third === null ? null : third.cells.item(1);
    table.createCaption().textContent = "list";
    const positions = (cell === null ? "none" : cell.textContent + ":" + cell.cellIndex) + "|" +
      (third === null ? "none" : third.rowIndex + ":" + third.sectionRowIndex);
    body.deleteRow(1);
    const caption = table.caption;
    log("tableRows", table.rows.length + "|" + table.tBodies.length + "|" + positions + "|" +
      (caption === null ? "none" : caption.textContent) + "|" + body.rows.length);
  }

  // A number input's constraints: a value past its maximum, the value as a
  // number, stepped, a custom message and what checkValidity answers with
  // it and without it.
  {
    const amount = document.createElement("input");
    amount.type = "number";
    amount.min = "0";
    amount.max = "10";
    amount.step = "0.5";
    amount.value = "12";
    const over = amount.validity.rangeOverflow + ":" + amount.checkValidity();
    amount.valueAsNumber = 2.5;
    amount.stepUp(2);
    const stepped = amount.value + ":" + amount.valueAsNumber;
    amount.setCustomValidity("nope");
    const custom = amount.validity.customError + ":" + amount.validationMessage + ":" + amount.checkValidity();
    amount.setCustomValidity("");
    log("numberValidity", over + "|" + stepped + "|" + custom + "|" + amount.checkValidity() + ":" + amount.validity.valid);
  }

  // Dictionaries whose members' presence matters to Blink (it asks
  // hasTop()): given as zero or false is not left out. `scrollTo({top: 0})`
  // scrolls to the top and keeps the other axis.
  // `attributes: false` with `attributeOldValue` is page script's TypeError,
  // where `attributes` left out is taken as true. A popover forced shut stays
  // shut. Each member is a parameter of its name, given or not.
  {
    const scroller = document.createElement("div");
    scroller.setAttribute("style", "width: 50px; height: 50px; overflow: auto");
    const big = document.createElement("div");
    big.setAttribute("style", "width: 400px; height: 400px");
    scroller.appendChild(big);
    root.appendChild(scroller);
    const at = (): string => scroller.scrollLeft + "," + scroller.scrollTop;
    scroller.scrollTo(30, 40);
    const steps = [at()];
    scroller.scrollTo({ top: 0 });
    steps.push(at());
    scroller.scrollTo({ left: 0, behavior: "instant" });
    steps.push(at());
    scroller.scrollTo({ left: 20, top: 25 });
    steps.push(at());
    scroller.scrollBy({ top: 5 });
    steps.push(at());
    log("scrollOptions", steps.join("|"));

    const watched = document.createElement("p");
    const observer = new MutationObserver((): void => {});
    observer.observe(watched, { attributeOldValue: true });
    watched.setAttribute("title", "a");
    watched.setAttribute("title", "b");
    const records = observer.takeRecords();
    let refused = "none";
    try {
      observer.observe(watched, { attributes: false, attributeOldValue: true });
    } catch (error) {
      const message = (error as Error).message;
      refused = message.slice(message.lastIndexOf(": ") + 2);
    }
    observer.disconnect();
    log("observeOptions", records.length + ":" + (records.length > 1 ? records[1].oldValue : "none") + "|" + refused);

    const popover = document.createElement("div");
    popover.popover = "manual";
    root.appendChild(popover);
    const states = popover.togglePopover({ force: true }) + "," + popover.togglePopover({ force: true }) + "," +
      popover.togglePopover({ force: false }) + "," + popover.togglePopover({ force: false }) + "," + popover.togglePopover();
    popover.hidePopover();
    const button = document.createElement("button");
    root.appendChild(button);
    // Without scrolling to it: the page's scroll is the smoke's to keep.
    button.focus({ focusVisible: true, preventScroll: true });
    const visible = button.matches(":focus-visible");
    button.blur();
    button.focus({ focusVisible: false, preventScroll: true });
    log("presenceOptions", states + "|" + visible + "," + button.matches(":focus-visible") + "," +
      (document.activeElement === button));
    button.blur();
  }

  // Events of the types lib.dom's event maps name, made and read: their own
  // members, a nullable string a dictionary leaves out (null) against one it
  // gives as empty, and a handle member compared by identity.
  {
    const toggle = new ToggleEvent("toggle", { oldState: "closed", newState: "open" });
    const pop = new PopStateEvent("popstate", { hasUAVisualTransition: true });
    const message = new MessageEvent("message", { origin: "https://example.com", lastEventId: "7" });
    const storage = new StorageEvent("storage", { key: "k", newValue: "v", oldValue: "", url: "https://example.com/", storageArea: localStorage });
    const bare = new StorageEvent("storage");
    log("eventTypes", toggle.oldState + ">" + toggle.newState + "|" + pop.hasUAVisualTransition + "|" + message.origin + "#" +
      message.lastEventId + "|" + storage.key + "=" + storage.newValue + "<" +
      storage.oldValue + ">@" + storage.url + "|" + (storage.storageArea === localStorage) + "|" + bare.key + "," +
      bare.oldValue + "," + bare.url.length + "," + (bare.storageArea === null));
  }

  // A form's `formdata` event, dispatched while `new FormData(form)` runs:
  // the listener sees the form's entries and adds one the result holds. Once:
  // a listener left on the form would outlive the program with what it
  // captures.
  {
    const form = document.createElement("form");
    const field = document.createElement("input");
    field.name = "a";
    field.value = "1";
    form.appendChild(field);
    const seen = { text: "none" };
    form.addEventListener("formdata", (event: FormDataEvent): void => {
      seen.text = event.type + ":" + event.formData.has("a") + ":" + event.bubbles;
      event.formData.append("b", "2");
    }, { once: true });
    const entries = new FormData(form);
    log("formdata", seen.text + "|" + entries.has("b"));
  }

  // A list of objects, and a union's object arm: a signal that follows two
  // (`AbortSignal.any` takes the program's array, lent for the call), a
  // request made from a request, with and without a change, and a path
  // made from a path.
  {
    const first = new AbortController();
    const second = new AbortController();
    const either = AbortSignal.any([first.signal, second.signal]);
    const none = AbortSignal.any([]);
    const before = either.aborted;
    second.abort();
    const base = new Request("https://example.com/a", { method: "POST" });
    const copy = new Request(base);
    const changed = new Request(base, { method: "PUT" });
    const square = new Path2D();
    square.rect(0, 0, 10, 10);
    const path = new Path2D(square);
    const context = document.createElement("canvas").getContext("2d");
    const inside = context === null ? "none" : context.isPointInPath(path, 5, 5) + "," + context.isPointInPath(path, 15, 5);
    log("listArguments", before + "," + either.aborted + "," + none.aborted + "|" + copy.method + ":" + copy.url + "|" +
      changed.method + ":" + changed.url + "|" + inside);
  }

  // Attributes answering a list of strings, each read a fresh array lib.dom
  // types as one: the page's languages, the first its own language, and a
  // drag store's types once it holds two.
  {
    const languages = navigator.languages;
    const store = new DataTransfer();
    store.setData("text/plain", "a");
    store.setData("text/uri-list", "https://example.com/");
    log("stringLists", (languages.length > 0) + "," + (languages[0] === navigator.language) + "|" +
      store.types.join(",") + "|" + store.types.length);
  }

  // Members C is told were given or not (c:types `Given`): a request's
  // keepalive turned off, kept from the request it is made from by `{}`, and
  // kept by `{ keepalive: undefined }` (WebIDL: not present); a matrix
  // multiplied by a literal; one made from m41 and m42 alone, which e and f
  // follow; one whose e and m41 disagree, page script's TypeError; a mark at
  // a given time of 0. V8's message carries its context first, the
  // program's does not, and the program's error is an Error whose message is
  // "Name: message" (ledger row 27).
  {
    const base = new Request("https://example.com/k", { keepalive: true });
    const kept = new Request(base, { keepalive: false }).keepalive + "," + new Request(base, {}).keepalive + "," +
      new Request(base, { keepalive: undefined }).keepalive;
    const product = new DOMMatrix().multiply({ a: 2, d: 2, e: 5 });
    const moved = DOMMatrix.fromMatrix({ m41: 3, m42: 4 });
    let clash = "ok";
    try {
      DOMMatrix.fromMatrix({ e: 1, m41: 2 });
    } catch (error) {
      const message = (error as Error).message;
      const at = message.lastIndexOf("': ");
      const text = at < 0 ? message : message.slice(at + 3);
      clash = (error as Error).name === "Error" ? text : (error as Error).name + ": " + text;
    }
    const mark = performance.mark("given", { startTime: 0 });
    log("givenMembers", kept + "|" + product.a + "," + product.d + "," + product.e + "|" + moved.e + "," + moved.f + "," +
      moved.is2D + "|" + clash + "|" + mark.startTime);
    performance.clearMarks("given");
  }

  // Lists of numbers answered: an observer's thresholds, one given as 0.1,
  // which Blink keeps as a float (V8 reads it widened), and the default; and
  // a canvas's line dash read back, empty until setLineDash binds (it waits
  // on a lent number[]), so a non-empty dash readback is unexercised here.
  {
    const given = new IntersectionObserver((): void => {}, { threshold: 0.1 });
    const plain = new IntersectionObserver((): void => {});
    const thresholds = given.thresholds.join(",") + ":" + plain.thresholds.length + "," + plain.thresholds[0];
    given.disconnect();
    plain.disconnect();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const dash = context === null ? "none" : context.getLineDash().length + ":" + context.getLineDash().join(",");
    log("numberLists", thresholds + "|" + dash);
  }

  // Typed arrays lent by their elements: matrices made from the program's
  // own Float64Array and Float32Array, copied at the call (the source
  // changed afterwards does not reach the matrix), the 32-bit elements
  // widened exactly; a length that is neither 6 nor 16 refuses.
  {
    const elements = new Float64Array([2, 0, 0, 2, 10, 20]);
    const scaled = DOMMatrix.fromFloat64Array(elements);
    elements[4] = 99;
    const narrow = DOMMatrixReadOnly.fromFloat32Array(new Float32Array([0.1, 0, 0, 1, 3, 4]));
    const full = DOMMatrix.fromFloat32Array(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 2]));
    let refused = "ok";
    try {
      DOMMatrix.fromFloat64Array(new Float64Array([1, 2, 3]));
    } catch (error) {
      const message = (error as Error).message;
      const at = message.lastIndexOf("': ");
      const text = at < 0 ? message : message.slice(at + 3);
      refused = (error as Error).name === "Error" ? text : (error as Error).name + ": " + text;
    }
    log("typedArrays", scaled.a + "," + scaled.e + "," + scaled.is2D + "|" + narrow.a + "," + narrow.e + "|" +
      full.m41 + "," + full.m44 + "," + full.is2D + "|" + refused);
  }

  root.remove();
  return lines.join("\n");
}

// Promises Blink answers, started from a timer once the transcript is done
// (so the probe's count of what outlives its synchronous run sees one timer,
// not five pending chains). Each outcome is written on the transcript's
// element as its own attribute, whatever order they settle in -- fulfilled,
// or the rejection's name and message; the smoke waits for all of them.
// Microtasks in the one queue page script's share: promise reactions and
// queueMicrotask callbacks run in the order they were queued, and what one
// queues runs after everything queued before it. Page script's order is
// p1,m1,p2,m2,m3,m4.
function orderMicrotasks(label: string): void {
  const order = { text: "" };
  const note = (step: string): void => {
    order.text += (order.text === "" ? "" : ",") + step;
  };
  Promise.resolve().then((): void => {
    note("p1");
    queueMicrotask((): void => note("m3"));
  });
  queueMicrotask((): void => note("m1"));
  Promise.resolve().then((): void => note("p2"));
  queueMicrotask((): void => {
    note("m2");
    queueMicrotask((): void => {
      note("m4");
      document.querySelector("#native-lib-dom")?.setAttribute("data-" + label, order.text);
    });
  });
}

// An IntersectionObserver made with options (`{ threshold, rootMargin }`):
// a fixed box in the viewport is reported intersecting past the threshold,
// and the observer reads its margin back as Blink normalizes it.
function observeWithOptions(label: string): void {
  const box = document.createElement("div");
  box.setAttribute("style", "position: fixed; top: 0; left: 0; width: 10px; height: 10px");
  document.body.appendChild(box);
  const observer = new IntersectionObserver((entries: IntersectionObserverEntry[], self: IntersectionObserver): void => {
    const entry = entries[0];
    document.querySelector("#native-lib-dom")?.setAttribute("data-" + label,
      entries.length + "|" + entry.isIntersecting + "|" + (entry.intersectionRatio >= 0.5) + "|" + self.rootMargin);
    self.disconnect();
    box.remove();
  }, { threshold: 0.5, rootMargin: "10px" });
  observer.observe(box);
}

export function startLibDomPromises(): void {
  setTimeout((): void => {
    // Each attribute set now, in this order, so the element's attributes are
    // in one order however the promises settle.
    const out = document.querySelector("#native-lib-dom");
    for (const label of ["decoded", "undecodable", "unplayable", "unfullscreen", "fullscreen", "text", "sheet", "clipboard", "fetched", "fetchWide", "microtasks", "intersectionOptions", "bytes"]) out?.setAttribute("data-" + label, "pending");
    settle("decoded", (): Promise<void> => {
      const image = document.createElement("img");
      image.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      return image.decode();
    });
    settle("undecodable", (): Promise<void> => document.createElement("img").decode());
    settle("unplayable", (): Promise<void> => document.createElement("video").play());
    settle("unfullscreen", (): Promise<void> => document.exitFullscreen());
    settle("fullscreen", (): Promise<void> => document.createElement("div").requestFullscreen());
    // An empty Blob: `new Blob(parts)` drops its parts today
    // (blockers/lib-dom-new-that-fits-no-constructor).
    settleText("text", (): Promise<string> => new Blob().text());
    settleSheet("sheet");
    settleBytes("bytes");
    // Rejected here, before any permission is asked: the harness's page is
    // not focused, which the Clipboard API requires. The rejection is
    // Blink's, carried through the promise bridge. (An app's round trip is
    // app.ts check's.)
    settle("clipboard", (): Promise<void> => navigator.clipboard.writeText("copied"));
    settleFetch("fetched");
    orderMicrotasks("microtasks");
    observeWithOptions("intersectionOptions");
    // RequestInit's method, a ByteString read from the dictionary before
    // the fetch starts: refused, the promise rejected.
    settle("fetchWide", async (): Promise<void> => {
      await fetch("data:text/plain,x", { method: "✓" });
    });
  }, 0);
}

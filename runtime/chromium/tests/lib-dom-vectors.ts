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
    // window.fetch: the global is refused (blockers/lib-dom-global-fetch-is-
    // taken-as-a-builtin; ledger row 26).
    const response = await window.fetch("data:text/plain;charset=utf-8,hello%20nts");
    const body = await response.text();
    outcome = "fulfilled " + response.status + " " + (response.ok ? "ok" : "not ok") + " " +
      (response.headers.get("content-type") ?? "none") + " " + body;
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

  // fetch's own types. A ByteString (a header here; RequestInit's method in
  // idl-vectors.ts, until blockers/lib-dom-dictionary-with-a-string-member)
  // is a string whose
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
  }

  root.remove();
  return lines.join("\n");
}

// Promises Blink answers, started from a timer once the transcript is done
// (so the probe's count of what outlives its synchronous run sees one timer,
// not five pending chains). Each outcome is written on the transcript's
// element as its own attribute, whatever order they settle in -- fulfilled,
// or the rejection's name and message; the smoke waits for all of them.
export function startLibDomPromises(): void {
  setTimeout((): void => {
    // Each attribute set now, in this order, so the element's attributes are
    // in one order however the promises settle.
    const out = document.querySelector("#native-lib-dom");
    for (const label of ["decoded", "undecodable", "unplayable", "unfullscreen", "fullscreen", "text", "sheet", "clipboard", "fetched"]) out?.setAttribute("data-" + label, "pending");
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
    // Rejected here, before any permission is asked: the harness's page is
    // not focused, which the Clipboard API requires. The rejection is
    // Blink's, carried through the promise bridge. (An app's round trip is
    // app.ts check's.)
    settle("clipboard", (): Promise<void> => navigator.clipboard.writeText("copied"));
    settleFetch("fetched");
  }, 0);
}

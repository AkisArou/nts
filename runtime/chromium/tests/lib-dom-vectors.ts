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

  root.remove();
  return lines.join("\n");
}

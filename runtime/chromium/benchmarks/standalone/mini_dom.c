/* A minimal DOM behind the DOM ABI (dom/abi/dom_abi.h
 * and the generated dom_idl.h), for running compiled applications without
 * Chromium. It keeps the adapter's contract exactly -- a call runs inside an
 * entry and finds its context there, a node is its own address, identity is
 * the address, and a node the program keeps is rooted with nts_dom_retain and
 * unrooted with nts_dom_release, which the compiler calls -- and is stricter:
 * a release with no root to give back, or a call outside an entry, ends the
 * process. It is not a DOM implementation: only the members the rows
 * workload uses, none of which it makes throw, no events, no CSS. Nodes are never freed, so a detached subtree costs memory
 * and not time, and a node nothing roots is still valid -- which is what
 * Oilpan's stack scan makes true in the browser. Text is kept as UTF-8,
 * converted from each view the program lends. */
#include "mini_dom.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct MiniNode MiniNode;
struct MiniNode {
  uint32_t tag; /* atom; 0 for a text node */
  char* text;   /* a text node's data, owned */
  uint32_t attribute_names[4];
  uint32_t attribute_values[4];
  uint32_t attributes;
  MiniNode* parent;
  MiniNode* first;
  MiniNode* last;
  MiniNode* previous;
  MiniNode* next;
  uint32_t roots; /* counts the program holds off the stack */
};

struct NtsDomContext {
  MiniNode* document;
  char** atoms;
  uint32_t atom_count;
  uint32_t entries;
};

/* Nodes with at least one root, across contexts: the root set is the
 * thread's, as the adapter's is. */
static uint32_t rooted_nodes;

static void fail(const char* what, uint32_t value) {
  fprintf(stderr, "mini_dom: %s (%u)\n", what, value);
  abort();
}
static MiniNode* node_new(uint32_t tag, const char* text) {
  MiniNode* node = calloc(1, sizeof(*node));
  if (!node)
    fail("out of memory", 0);
  node->tag = tag;
  node->text = text ? strdup(text) : NULL;
  return node;
}

/* The context of the entry running, as nts_dom::Current is in Blink. */
static NtsDomContext* entered;
static NtsDomContext* current(void) {
  if (!entered || !entered->entries)
    fail("DOM call outside an entry", 0);
  return entered;
}
static MiniNode* node_of(const void* handle) {
  if (!handle)
    fail("a null node", 0);
  return (MiniNode*)handle;
}

static void detach(MiniNode* node) {
  MiniNode* parent = node->parent;
  if (!parent)
    return;
  if (node->previous)
    node->previous->next = node->next;
  else
    parent->first = node->next;
  if (node->next)
    node->next->previous = node->previous;
  else
    parent->last = node->previous;
  node->parent = node->previous = node->next = NULL;
}
static void insert(MiniNode* parent, MiniNode* child, MiniNode* reference) {
  if (reference && reference->parent != parent)
    fail("reference is not a child", 0);
  detach(child);
  child->parent = parent;
  child->next = reference;
  child->previous = reference ? reference->previous : parent->last;
  if (child->previous)
    child->previous->next = child;
  else
    parent->first = child;
  if (reference)
    reference->previous = child;
  else
    parent->last = child;
}
static MiniNode* clone(MiniNode* source, int deep) {
  MiniNode* copy = node_new(source->tag, source->text);
  copy->attributes = source->attributes;
  memcpy(copy->attribute_names, source->attribute_names,
         sizeof(copy->attribute_names));
  memcpy(copy->attribute_values, source->attribute_values,
         sizeof(copy->attribute_values));
  if (deep)
    for (MiniNode* child = source->first; child; child = child->next)
      insert(copy, clone(child, 1), NULL);
  return copy;
}
static int has_id(NtsDomContext* c, MiniNode* node, const char* id) {
  for (uint32_t i = 0; i < node->attributes; ++i)
    if (!strcmp(c->atoms[node->attribute_names[i] - 1], "id") &&
        !strcmp(c->atoms[node->attribute_values[i] - 1], id))
      return 1;
  return 0;
}
static MiniNode* find_id(NtsDomContext* c, MiniNode* node, const char* id) {
  for (MiniNode* child = node->first; child; child = child->next) {
    if (child->tag && has_id(c, child, id))
      return child;
    MiniNode* found = find_id(c, child, id);
    if (found)
      return found;
  }
  return NULL;
}

NtsDomContext* mini_dom_create(void) {
  NtsDomContext* c = calloc(1, sizeof(*c));
  if (!c)
    fail("out of memory", 0);
  c->document = node_new(0, NULL);
  c->document->tag = mini_dom_intern(c, "#document");
  MiniNode* tbody = node_new(mini_dom_intern(c, "tbody"), NULL);
  tbody->attribute_names[0] = mini_dom_intern(c, "id");
  tbody->attribute_values[0] = mini_dom_intern(c, "tbody");
  tbody->attributes = 1;
  insert(c->document, tbody, NULL);
  return c;
}
void mini_dom_enter(NtsDomContext* c) {
  ++c->entries;
  entered = c;
}
void mini_dom_leave(NtsDomContext* c) {
  if (--c->entries == 0)
    entered = NULL;
}
uint32_t mini_dom_roots(void) {
  return rooted_nodes;
}
NtsDomNode* mini_dom_find(NtsDomContext* c, const char* id) {
  return (NtsDomNode*)find_id(c, c->document, id);
}
static void text_content(MiniNode* node, char** out, size_t* length,
                         size_t* capacity) {
  if (!node->tag && node->text) {
    const size_t add = strlen(node->text);
    while (*length + add + 1 > *capacity) {
      *capacity = *capacity ? *capacity * 2 : 256;
      *out = realloc(*out, *capacity);
      if (!*out)
        fail("out of memory", 0);
    }
    memcpy(*out + *length, node->text, add + 1);
    *length += add;
  }
  for (MiniNode* child = node->first; child; child = child->next)
    text_content(child, out, length, capacity);
}
/* The runner's serialization: className|textContent per row, by newline. */
char* mini_dom_serialize_rows(NtsDomContext* c) {
  MiniNode* tbody = find_id(c, c->document, "tbody");
  char* out = calloc(1, 1);
  size_t length = 0, capacity = 1;
  const uint32_t class_atom = mini_dom_intern(c, "class");
  for (MiniNode* row = tbody->first; row; row = row->next) {
    if (row != tbody->first) {
      while (length + 2 > capacity) {
        capacity *= 2;
        out = realloc(out, capacity);
      }
      out[length++] = '\n';
      out[length] = 0;
    }
    const char* class_name = "";
    for (uint32_t i = 0; i < row->attributes; ++i)
      if (row->attribute_names[i] == class_atom)
        class_name = c->atoms[row->attribute_values[i] - 1];
    const size_t add = strlen(class_name) + 1;
    while (length + add + 1 > capacity) {
      capacity *= 2;
      out = realloc(out, capacity);
    }
    memcpy(out + length, class_name, add - 1);
    out[length + add - 1] = '|';
    length += add;
    out[length] = 0;
    text_content(row, &out, &length, &capacity);
  }
  return out;
}

/* A lent view as an owned UTF-8 string. Units past U+FFFF arrive as
 * surrogate pairs and are joined; a lone surrogate becomes U+FFFD, which the
 * rows workload never produces. */
static char* utf8_of(const NtsBorrowedString* string) {
  const NtsStringView view = nts_string_view(string);
  if (!view.units)
    fail("a null string", 0);
  char* out = malloc((size_t)view.length * 3 + 1);
  if (!out)
    fail("out of memory", 0);
  size_t n = 0;
  for (uint32_t i = 0; i < view.length; ++i) {
    uint32_t u = (view.flags & NTS_STRING_VIEW_WIDE)
                     ? ((const uint16_t*)view.units)[i]
                     : ((const uint8_t*)view.units)[i];
    if (u >= 0xd800 && u < 0xdc00 && i + 1 < view.length &&
        (view.flags & NTS_STRING_VIEW_WIDE)) {
      const uint32_t low = ((const uint16_t*)view.units)[i + 1];
      if (low >= 0xdc00 && low < 0xe000) {
        u = 0x10000 + ((u - 0xd800) << 10) + (low - 0xdc00);
        ++i;
      }
    }
    if (u >= 0xd800 && u < 0xe000)
      u = 0xfffd;
    if (u < 0x80) {
      out[n++] = (char)u;
    } else if (u < 0x800) {
      out[n++] = (char)(0xc0 | (u >> 6));
      out[n++] = (char)(0x80 | (u & 0x3f));
    } else if (u < 0x10000) {
      out[n++] = (char)(0xe0 | (u >> 12));
      out[n++] = (char)(0x80 | ((u >> 6) & 0x3f));
      out[n++] = (char)(0x80 | (u & 0x3f));
    } else {
      out[n++] = (char)(0xf0 | (u >> 18));
      out[n++] = (char)(0x80 | ((u >> 12) & 0x3f));
      out[n++] = (char)(0x80 | ((u >> 6) & 0x3f));
      out[n++] = (char)(0x80 | (u & 0x3f));
    }
  }
  out[n] = 0;
  return out;
}

uint32_t mini_dom_intern(NtsDomContext* c, const char* text) {
  for (uint32_t i = 0; i < c->atom_count; ++i)
    if (!strcmp(c->atoms[i], text))
      return i + 1;
  if ((c->atom_count & (c->atom_count - 1)) == 0) {
    c->atoms = realloc(c->atoms, (c->atom_count ? c->atom_count * 2 : 1) *
                                     sizeof(*c->atoms));
    if (!c->atoms)
      fail("out of memory", 0);
  }
  c->atoms[c->atom_count++] = strdup(text);
  return c->atom_count;
}
void* nts_dom_retain(void* node) {
  if (node_of(node)->roots++ == 0)
    ++rooted_nodes;
  return node;
}
void nts_dom_release(void* node) {
  MiniNode* target = node_of(node);
  if (!target->roots)
    fail("a release with no root to give back", 0);
  if (--target->roots == 0)
    --rooted_nodes;
}
/* A name as an atom: the program's view as UTF-8, interned. */
static uint32_t name_of(NtsDomContext* c, const NtsBorrowedString* name) {
  char* utf8 = utf8_of(name);
  const uint32_t atom = mini_dom_intern(c, utf8);
  free(utf8);
  return atom;
}
NtsDomDocument* nts_dom_document(void) {
  return (NtsDomDocument*)current()->document;
}
/* Nothing here reports an exception; the program's slot stays empty. */
char* nts_dom_exception_take_message(NtsDomException* exception) {
  (void)exception;
  fail("an exception mini_dom never reports", 0);
  return NULL;
}
NtsDomElement* nts_dom_Document_createElement_1(NtsDomDocument* self,
                                                const NtsBorrowedString* tag,
                                                NtsDomException** error) {
  (void)self;
  (void)error;
  return (NtsDomElement*)node_new(name_of(current(), tag), NULL);
}
NtsDomText* nts_dom_Document_createTextNode(NtsDomDocument* self,
                                            const NtsBorrowedString* text) {
  (void)self;
  current();
  char* utf8 = utf8_of(text);
  MiniNode* node = node_new(0, utf8);
  free(utf8);
  return (NtsDomText*)node;
}
NtsDomNode* nts_dom_Node_cloneNode_1(NtsDomNode* self,
                                     bool deep,
                                     NtsDomException** error) {
  (void)error;
  current();
  return (NtsDomNode*)clone(node_of(self), deep);
}
NtsDomElement* nts_dom_as_Element(NtsDomNode* node) {
  current();
  return node_of(node)->tag ? (NtsDomElement*)node : NULL;
}
NtsDomNode* nts_dom_Node_get_firstChild(NtsDomNode* self) {
  current();
  return (NtsDomNode*)node_of(self)->first;
}
NtsDomNode* nts_dom_Node_get_nextSibling(NtsDomNode* self) {
  current();
  return (NtsDomNode*)node_of(self)->next;
}
NtsDomNode* nts_dom_Node_appendChild(NtsDomNode* self,
                                     NtsDomNode* node,
                                     NtsDomException** error) {
  (void)error;
  current();
  insert(node_of(self), node_of(node), NULL);
  return node;
}
NtsDomNode* nts_dom_Node_insertBefore(NtsDomNode* self,
                                      NtsDomNode* node,
                                      NtsDomNode* child,
                                      NtsDomException** error) {
  (void)error;
  current();
  insert(node_of(self), node_of(node), child ? node_of(child) : NULL);
  return node;
}
void nts_dom_Element_remove(NtsDomElement* self, NtsDomException** error) {
  (void)error;
  current();
  detach(node_of(self));
}
/* A view as UTF-8, written as text: a text node's data, or an element's
 * only child (none for ""). */
static void set_text(MiniNode* target, const NtsBorrowedString* text) {
  char* utf8 = utf8_of(text);
  if (!target->tag) {
    free(target->text);
    target->text = utf8; /* Blink's one copy */
    return;
  }
  while (target->first)
    detach(target->first);
  if (*utf8)
    insert(target, node_new(0, utf8), NULL);
  free(utf8);
}
void nts_dom_Node_set_textContent(NtsDomNode* self,
                                  const NtsBorrowedString* value,
                                  NtsDomException** error) {
  (void)error;
  current();
  set_text(node_of(self), value);
}
/* `nodeValue` is a text node's data; on an element it does nothing. */
void nts_dom_Node_set_nodeValue(NtsDomNode* self,
                                const NtsBorrowedString* value,
                                NtsDomException** error) {
  (void)error;
  current();
  if (!node_of(self)->tag)
    set_text(node_of(self), value);
}
static void set_attribute(MiniNode* target, uint32_t key, uint32_t data) {
  for (uint32_t i = 0; i < target->attributes; ++i) {
    if (target->attribute_names[i] == key) {
      target->attribute_values[i] = data;
      return;
    }
  }
  if (target->attributes == 4)
    fail("too many attributes", key);
  target->attribute_names[target->attributes] = key;
  target->attribute_values[target->attributes++] = data;
}
void nts_dom_Element_setAttribute(NtsDomElement* self,
                                  const NtsBorrowedString* name,
                                  const NtsBorrowedString* value,
                                  NtsDomException** error) {
  (void)error;
  NtsDomContext* c = current();
  set_attribute(node_of(self), name_of(c, name), name_of(c, value));
}

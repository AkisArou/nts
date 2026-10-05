/* A minimal DOM behind the entered DOM ABI (native-bootstrap/native/ffi/
 * dom_abi.h), for running compiled applications without Chromium. It keeps
 * the adapter's contract exactly -- a node is its own address, identity is
 * the address, and a node the program keeps is rooted with nts_dom_retain and
 * unrooted with nts_dom_release, which the compiler calls -- and is stricter:
 * a release with no root to give back, or a call outside an entry, ends the
 * process. It is not a DOM implementation: only what the rows workload uses,
 * no events, no CSS. Nodes are never freed, so a detached subtree costs memory
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
  int32_t last_error;
  char* lent; /* the text a read last lent, until the next read */
  NtsStringView lent_view;
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

static void require_entry(NtsDomContext* c) {
  if (!c->entries)
    fail("DOM call outside an entry", 0);
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
}
void mini_dom_leave(NtsDomContext* c) {
  --c->entries;
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
int32_t nts_dom_last_error(NtsDomContext* c) {
  return c->last_error;
}
/* A name as an atom: the program's view as UTF-8, interned. */
static uint32_t name_of(NtsDomContext* c, const NtsBorrowedString* name) {
  char* utf8 = utf8_of(name);
  const uint32_t atom = mini_dom_intern(c, utf8);
  free(utf8);
  return atom;
}
/* Text lent back as a view, valid until the next read. The workload reads
 * back only ASCII, which is the same bytes as Latin-1. */
static const NtsStringView* lend(NtsDomContext* c, const char* text) {
  for (const char* p = text; *p; ++p)
    if ((unsigned char)*p > 0x7f)
      fail("non-ASCII text read back", 0);
  free(c->lent);
  c->lent = strdup(text);
  c->lent_view = (NtsStringView){c->lent, (uint32_t)strlen(c->lent), 0};
  return &c->lent_view;
}
NtsDomDocument* nts_dom_document(NtsDomContext* c) {
  require_entry(c);
  return (NtsDomDocument*)c->document;
}
NtsDomElement* nts_dom_query(NtsDomContext* c,
                             NtsDomNode* root,
                             const NtsBorrowedString* selectors) {
  require_entry(c);
  char* text = utf8_of(selectors);
  if (text[0] != '#')
    fail("only #id selectors", 0);
  MiniNode* found = find_id(c, node_of(root), text + 1);
  free(text);
  return (NtsDomElement*)found;
}
NtsDomElement* nts_dom_create_element(NtsDomContext* c,
                                      const NtsBorrowedString* tag) {
  require_entry(c);
  return (NtsDomElement*)node_new(name_of(c, tag), NULL);
}
NtsDomText* nts_dom_create_text(NtsDomContext* c,
                                const NtsBorrowedString* text) {
  require_entry(c);
  char* utf8 = utf8_of(text);
  MiniNode* node = node_new(0, utf8);
  free(utf8);
  return (NtsDomText*)node;
}
NtsDomNode* nts_dom_clone(NtsDomContext* c, NtsDomNode* node, int32_t deep) {
  require_entry(c);
  return (NtsDomNode*)clone(node_of(node), deep);
}
NtsDomElement* nts_dom_clone_element(NtsDomContext* c,
                                     NtsDomElement* element,
                                     int32_t deep) {
  return (NtsDomElement*)nts_dom_clone(c, (NtsDomNode*)element, deep);
}
NtsDomNode* nts_dom_first_child(NtsDomContext* c, NtsDomNode* node) {
  require_entry(c);
  return (NtsDomNode*)node_of(node)->first;
}
NtsDomNode* nts_dom_next_sibling(NtsDomContext* c, NtsDomNode* node) {
  require_entry(c);
  return (NtsDomNode*)node_of(node)->next;
}
NtsDomElement* nts_dom_as_element(NtsDomContext* c, NtsDomNode* node) {
  require_entry(c);
  MiniNode* target = node_of(node);
  return target->tag && target != c->document ? (NtsDomElement*)target : NULL;
}
NtsDomText* nts_dom_as_text(NtsDomContext* c, NtsDomNode* node) {
  require_entry(c);
  return node_of(node)->tag ? NULL : (NtsDomText*)node;
}
int32_t nts_dom_append_child(NtsDomContext* c,
                             NtsDomNode* parent,
                             NtsDomNode* child) {
  require_entry(c);
  insert(node_of(parent), node_of(child), NULL);
  return 0;
}
int32_t nts_dom_insert_before(NtsDomContext* c,
                              NtsDomNode* parent,
                              NtsDomNode* child,
                              NtsDomNode* reference) {
  require_entry(c);
  insert(node_of(parent), node_of(child),
         reference ? node_of(reference) : NULL);
  return 0;
}
int32_t nts_dom_remove_child(NtsDomContext* c,
                             NtsDomNode* parent,
                             NtsDomNode* child) {
  require_entry(c);
  if (node_of(child)->parent != node_of(parent))
    return 8; /* NotFoundError */
  detach(node_of(child));
  return 0;
}
int32_t nts_dom_remove(NtsDomContext* c, NtsDomNode* node) {
  require_entry(c);
  detach(node_of(node));
  return 0;
}
static int32_t set_text(NtsDomContext* c, NtsDomNode* node, const char* text) {
  require_entry(c);
  MiniNode* target = node_of(node);
  if (!target->tag) {
    free(target->text);
    target->text = strdup(text); /* Blink's one copy */
    return 0;
  }
  while (target->first)
    detach(target->first);
  if (*text)
    insert(target, node_new(0, text), NULL);
  return 0;
}
int32_t nts_dom_set_text_content(NtsDomContext* c,
                                 NtsDomNode* node,
                                 const NtsBorrowedString* text) {
  char* utf8 = utf8_of(text);
  const int32_t status = set_text(c, node, utf8);
  free(utf8);
  return status;
}
int32_t nts_dom_set_attribute(NtsDomContext* c,
                              NtsDomElement* element,
                              const NtsBorrowedString* name,
                              const NtsBorrowedString* value) {
  require_entry(c);
  MiniNode* target = node_of(element);
  const uint32_t key = name_of(c, name);
  const uint32_t data = name_of(c, value);
  for (uint32_t i = 0; i < target->attributes; ++i) {
    if (target->attribute_names[i] == key) {
      target->attribute_values[i] = data;
      return 0;
    }
  }
  if (target->attributes == 4)
    fail("too many attributes", key);
  target->attribute_names[target->attributes] = key;
  target->attribute_values[target->attributes++] = data;
  return 0;
}
const NtsStringView* nts_dom_text_content(NtsDomContext* c, NtsDomNode* node) {
  require_entry(c);
  char* out = calloc(1, 1);
  size_t length = 0, capacity = 1;
  text_content(node_of(node), &out, &length, &capacity);
  const NtsStringView* view = lend(c, out);
  free(out);
  return view;
}
const NtsStringView* nts_dom_get_attribute(NtsDomContext* c,
                                           NtsDomElement* element,
                                           const NtsBorrowedString* name) {
  require_entry(c);
  MiniNode* target = node_of(element);
  const uint32_t key = name_of(c, name);
  for (uint32_t i = 0; i < target->attributes; ++i)
    if (target->attribute_names[i] == key)
      return lend(c, c->atoms[target->attribute_values[i] - 1]);
  return NULL;
}
uint32_t nts_dom_intern(NtsDomContext* c, const NtsBorrowedString* text) {
  return name_of(c, text);
}
int32_t nts_dom_set_text_interned(NtsDomContext* c,
                                  NtsDomNode* node,
                                  uint32_t atom) {
  return set_text(c, node, c->atoms[atom - 1]);
}

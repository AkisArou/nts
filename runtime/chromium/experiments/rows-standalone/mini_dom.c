/* A minimal DOM behind the entered DOM ABI (native-bootstrap/native/ffi/
 * dom_abi.h), for running compiled applications without Chromium. It keeps
 * the adapter's lease semantics exactly -- generational handles, one lease
 * per returned handle, identity while leased -- and is stricter: a stale or
 * unknown handle, or a call outside an entry, ends the process. It is not a
 * DOM implementation: only what the rows workload uses, no events, no CSS.
 * Nodes are never freed, so a detached subtree costs memory and not time. */
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
  uint32_t handle; /* the live handle, or 0: identity in O(1) */
};

struct NtsDomContext {
  MiniNode* document;
  MiniNode** slots;
  uint32_t* leases;
  uint8_t* generations;
  uint32_t slot_count;
  uint32_t slot_capacity;
  uint32_t* free_slots;
  uint32_t free_count;
  char** atoms;
  uint32_t atom_count;
  uint32_t entries;
  uint32_t live_leases;
  int32_t last_error;
};

static void fail(const char* what, uint32_t value) {
  fprintf(stderr, "mini_dom: %s (%u)\n", what, value);
  abort();
}
static void* resize(void* items, uint32_t count, size_t size) {
  void* result = realloc(items, count * size);
  if (!result)
    fail("out of memory", count);
  return result;
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
static MiniNode* lookup(NtsDomContext* c, uint32_t handle) {
  const uint32_t slot = (handle & 0xffffffu) - 1;
  if (!(handle & 0xffffffu) || slot >= c->slot_count || !c->slots[slot] ||
      c->generations[slot] != handle >> 24)
    fail("stale or unknown handle", handle);
  return c->slots[slot];
}
static uint32_t bind(NtsDomContext* c, MiniNode* node) {
  if (!node)
    return 0;
  ++c->live_leases;
  if (node->handle) {
    ++c->leases[(node->handle & 0xffffffu) - 1];
    return node->handle;
  }
  uint32_t slot;
  if (c->free_count) {
    slot = c->free_slots[--c->free_count];
  } else {
    if (c->slot_count == c->slot_capacity) {
      const uint32_t n = c->slot_capacity ? c->slot_capacity * 2 : 64;
      c->slots = resize(c->slots, n, sizeof(*c->slots));
      c->leases = resize(c->leases, n, sizeof(*c->leases));
      c->generations = resize(c->generations, n, sizeof(*c->generations));
      c->free_slots = resize(c->free_slots, n, sizeof(*c->free_slots));
      c->slot_capacity = n;
    }
    slot = c->slot_count++;
    c->generations[slot] = 0;
  }
  c->slots[slot] = node;
  c->leases[slot] = 1;
  node->handle = ((uint32_t)c->generations[slot] << 24) | (slot + 1);
  return node->handle;
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
  c->document->tag = nts_dom_intern(c, "#document");
  MiniNode* tbody = node_new(nts_dom_intern(c, "tbody"), NULL);
  tbody->attribute_names[0] = nts_dom_intern(c, "id");
  tbody->attribute_values[0] = nts_dom_intern(c, "tbody");
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
uint32_t mini_dom_live_leases(NtsDomContext* c) {
  return c->live_leases;
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
  const uint32_t class_atom = nts_dom_intern(c, "class");
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

uint32_t nts_dom_intern(NtsDomContext* c, const char* text) {
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
void nts_dom_release(NtsDomContext* c, uint32_t handle) {
  MiniNode* node = lookup(c, handle);
  const uint32_t slot = (handle & 0xffffffu) - 1;
  --c->live_leases;
  if (--c->leases[slot])
    return;
  node->handle = 0;
  c->slots[slot] = NULL;
  ++c->generations[slot];
  c->free_slots[c->free_count++] = slot;
}
int32_t nts_dom_last_error(NtsDomContext* c) {
  return c->last_error;
}
uint32_t nts_dom_document(NtsDomContext* c) {
  require_entry(c);
  return bind(c, c->document);
}
uint32_t nts_dom_query_atom(NtsDomContext* c, uint32_t root,
                            uint32_t selector) {
  require_entry(c);
  const char* text = c->atoms[selector - 1];
  if (text[0] != '#')
    fail("only #id selectors", selector);
  return bind(c, find_id(c, lookup(c, root), text + 1));
}
uint32_t nts_dom_create_element(NtsDomContext* c, uint32_t tag) {
  require_entry(c);
  return bind(c, node_new(tag, NULL));
}
uint32_t nts_dom_create_text(NtsDomContext* c, const char* text) {
  require_entry(c);
  return bind(c, node_new(0, text));
}
uint32_t nts_dom_clone(NtsDomContext* c, uint32_t node, int32_t deep) {
  require_entry(c);
  return bind(c, clone(lookup(c, node), deep));
}
uint32_t nts_dom_first_child(NtsDomContext* c, uint32_t node) {
  require_entry(c);
  return bind(c, lookup(c, node)->first);
}
uint32_t nts_dom_next_sibling(NtsDomContext* c, uint32_t node) {
  require_entry(c);
  return bind(c, lookup(c, node)->next);
}
int32_t nts_dom_append_child(NtsDomContext* c, uint32_t parent,
                             uint32_t child) {
  require_entry(c);
  insert(lookup(c, parent), lookup(c, child), NULL);
  return 0;
}
int32_t nts_dom_insert_before(NtsDomContext* c, uint32_t parent,
                              uint32_t child, uint32_t reference) {
  require_entry(c);
  insert(lookup(c, parent), lookup(c, child),
         reference ? lookup(c, reference) : NULL);
  return 0;
}
int32_t nts_dom_remove_node(NtsDomContext* c, uint32_t node) {
  require_entry(c);
  detach(lookup(c, node));
  return 0;
}
int32_t nts_dom_set_text_value(NtsDomContext* c, uint32_t node,
                               const char* text) {
  require_entry(c);
  MiniNode* target = lookup(c, node);
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
int32_t nts_dom_set_text_interned(NtsDomContext* c, uint32_t node,
                                  uint32_t atom) {
  return nts_dom_set_text_value(c, node, c->atoms[atom - 1]);
}
int32_t nts_dom_set_attribute_interned(NtsDomContext* c, uint32_t element,
                                       uint32_t name, uint32_t value) {
  require_entry(c);
  MiniNode* target = lookup(c, element);
  for (uint32_t i = 0; i < target->attributes; ++i) {
    if (target->attribute_names[i] == name) {
      target->attribute_values[i] = value;
      return 0;
    }
  }
  if (target->attributes == 4)
    fail("too many attributes", element);
  target->attribute_names[target->attributes] = name;
  target->attribute_values[target->attributes++] = value;
  return 0;
}

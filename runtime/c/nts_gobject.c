#include "nts_gobject.h"

#include "nts_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* One connection: the closure the program lent, and the notify the program
 * gave with it, which runs when the connection ends -- unless the collector
 * ended it (`severed`), in which case the closure is already garbage and the
 * collector frees it. */
typedef struct NtsGObjectHeld NtsGObjectHeld;

/* An instance while it holds at least one lent closure: the collector's node
 * for it (see `NtsHolders`), and its connections. Freed with its last. */
typedef struct {
  NtsHeader header;
  GObject *object;
  /* `ref_count` when a collection last read it, which `fallen` compares; and
   * which collection that was (`nts_collection_epoch`). */
  guint last;
  uint64_t epoch;
  /* Where it is in `nts_gobject_order`. */
  guint index;
  GPtrArray *held;
} NtsGObjectNode;

struct NtsGObjectHeld {
  NtsGObjectNode *node;
  GClosure *closure;
  NtsHeader *context;
  GClosureNotify notify;
  gboolean severed;
};

/* Instance to node, and every node in an order `fallen` walks a share of at
 * a time. Owner thread only, as signal connection is in GTK. */
static GHashTable *nts_gobject_nodes;
static GPtrArray *nts_gobject_order;
static guint nts_gobject_cursor;

static guint nts_gobject_references(NtsGObjectNode *node);

/* The count, for the collection `nts_collection_epoch` names, read once. */
static void nts_gobject_read(NtsGObjectNode *node) {
  uint64_t epoch = nts_collection_epoch();
  if (node->epoch != epoch) {
    node->epoch = epoch;
    node->last = nts_gobject_references(node);
    node->header.reserved = node->last;
  }
}

static NtsHeader *nts_gobject_node(void *object) {
  NtsGObjectNode *node = g_hash_table_lookup(nts_gobject_nodes, object);
  if (node == NULL) {
    return NULL;
  }
  nts_gobject_read(node);
  return &node->header;
}

static void nts_gobject_each_held(NtsHeader *header,
                                  void (*visit)(NtsHeader *)) {
  NtsGObjectNode *node = (NtsGObjectNode *)header;
  for (guint at = 0; at < node->held->len; at++) {
    visit(((NtsGObjectHeld *)g_ptr_array_index(node->held, at))->context);
  }
}

/* Every reference to the instance, ours among them. A reference GTK takes for
 * a moment -- an emission in progress, a layout pass -- is a real one and can
 * only keep the node alive for the length of it. A floating reference cannot
 * be here: the program's first retain of an instance is `g_object_ref_sink`,
 * so an instance the program holds is never floating, and one it does not
 * hold has no slot of ours pointing at it and so is reached by no trace. */
static guint nts_gobject_references(NtsGObjectNode *node) {
  return (guint)g_atomic_int_get((gint *)&node->object->ref_count);
}

/* How many nodes a checkpoint looks at: a GObject let go of on GTK's side is
 * found within (nodes / this) checkpoints, and a checkpoint costs this many
 * reads rather than one per node -- 146 us at ten thousand. */
#define NTS_GOBJECT_FALLEN_SHARE 64u

static void nts_gobject_fallen(void (*root)(NtsHeader *)) {
  guint count = nts_gobject_order->len;
  guint share =
      count < NTS_GOBJECT_FALLEN_SHARE ? count : NTS_GOBJECT_FALLEN_SHARE;
  for (guint at = 0; at < share; at++) {
    if (nts_gobject_cursor >= nts_gobject_order->len) {
      nts_gobject_cursor = 0;
    }
    NtsGObjectNode *node =
        g_ptr_array_index(nts_gobject_order, nts_gobject_cursor++);
    if (nts_gobject_references(node) < node->last) {
      /* Read for the collection this root starts, which is the next. */
      node->epoch = nts_collection_epoch() - 1u;
      nts_gobject_read(node);
      root(&node->header);
    }
  }
}

/* A connection ends, however it ends: its record goes, and with the last the
 * node. The program's notify runs unless the collector ended it. */
static void nts_gobject_unheld(gpointer data, GClosure *closure) {
  NtsGObjectHeld *held = data;
  NtsGObjectNode *node = held->node;
  if (!held->severed && held->notify != NULL) {
    held->notify(held->context, closure);
  }
  g_ptr_array_remove_fast(node->held, held);
  g_free(held);
  if (node->held->len == 0) {
    g_hash_table_remove(nts_gobject_nodes, node->object);
    /* Out of the order by moving the last node into its place. */
    g_ptr_array_remove_index_fast(nts_gobject_order, node->index);
    if (node->index < nts_gobject_order->len) {
      NtsGObjectNode *moved = g_ptr_array_index(nts_gobject_order, node->index);
      moved->index = node->index;
    }
    g_ptr_array_free(node->held, TRUE);
    g_free(node);
  }
}

/* A node the collector found garbage: every closure it holds is garbage too,
 * so each connection is marked severed and then disconnected. Its instance is
 * alive throughout -- the garbage objects' references to it are given up only
 * after this -- and ending the connections may free the node. */
static void nts_gobject_sever(NtsHeader *header) {
  NtsGObjectNode *node = (NtsGObjectNode *)header;
  GObject *object = node->object;
  /* Read out before any disconnect, since each may remove a record and the
   * last frees the node. */
  guint count = node->held->len;
  GClosure **closures = g_new(GClosure *, count);
  for (guint at = 0; at < count; at++) {
    NtsGObjectHeld *held = g_ptr_array_index(node->held, at);
    held->severed = TRUE;
    closures[at] = held->closure;
  }
  for (guint at = 0; at < count; at++) {
    g_signal_handlers_disconnect_matched(object, G_SIGNAL_MATCH_CLOSURE, 0, 0,
                                         closures[at], NULL, NULL);
  }
  g_free(closures);
}

static const NtsHolders nts_gobject_holders = {
    nts_gobject_node, nts_gobject_each_held, nts_gobject_fallen,
    nts_gobject_sever};

gulong nts_gobject_connect(gpointer instance, const gchar *detailed_signal,
                           GCallback handler, gpointer data,
                           GClosureNotify notify, GConnectFlags flags) {
  guint signal;
  GQuark detail;
  /* Anything GLib would refuse, GLib refuses, in its own words. */
  if (!G_IS_OBJECT(instance) ||
      !g_signal_parse_name(detailed_signal, G_TYPE_FROM_INSTANCE(instance),
                           &signal, &detail, TRUE)) {
    return g_signal_connect_data(instance, detailed_signal, handler, data,
                                 notify, flags);
  }
  if (nts_gobject_nodes == NULL) {
    nts_gobject_nodes = g_hash_table_new(g_direct_hash, g_direct_equal);
    nts_gobject_order = g_ptr_array_new();
    nts_register_holders(NTS_FAMILY_GOBJECT, &nts_gobject_holders);
  }
  /* No destroy notify of GLib's: the program's runs from the connection's
   * record, which is what lets the collector suppress it. */
  GClosure *closure = (flags & G_CONNECT_SWAPPED)
                          ? g_cclosure_new_swap(handler, data, NULL)
                          : g_cclosure_new(handler, data, NULL);
  NtsGObjectNode *node = g_hash_table_lookup(nts_gobject_nodes, instance);
  if (node == NULL) {
    node = g_new0(NtsGObjectNode, 1);
    node->header.descriptor = &nts_holder_descriptor;
    node->header.length = NTS_FAMILY_GOBJECT;
    node->object = instance;
    node->held = g_ptr_array_new();
    g_hash_table_insert(nts_gobject_nodes, instance, node);
    node->index = nts_gobject_order->len;
    g_ptr_array_add(nts_gobject_order, node);
    node->last = nts_gobject_references(node);
    /* A collection other than the next, so the next one reads it. */
    node->epoch = nts_collection_epoch() - 1u;
  }
  NtsGObjectHeld *held = g_new0(NtsGObjectHeld, 1);
  held->node = node;
  held->closure = closure;
  held->context = data;
  held->notify = notify;
  g_ptr_array_add(node->held, held);
  g_closure_add_finalize_notifier(closure, held, nts_gobject_unheld);
  return g_signal_connect_closure_by_id(instance, signal, detail, closure,
                                        (flags & G_CONNECT_AFTER) != 0);
}

/* One slot of a class the program writes: its offset in the class struct,
 * and the entry point written there. `program.c` lays the table out the same
 * way. */
typedef struct NtsGObjectSlot {
  size_t offset;
  void (*entry)(void);
} NtsGObjectSlot;

/* A class the program registered: its slots for `class_init`, and for one
 * with fields, who makes them and which class's slot the instance holds them
 * in.
 *
 * One slot per instance, whatever the chain: `class Derived extends Base`,
 * both the program's, holds Derived's fields -- Base's first, so Base's
 * methods read them where they expect -- in the slot of the first class of
 * the chain that has fields (`owner`), which alone installs `instance_init`
 * and `finalize`. GObject calls every class's `instance_init` with the
 * *instance's* class, and inherits `finalize`, so a slot per class would make
 * the state twice and give it back by a lookup that finds the child again. */
/* A property a class the program writes declares (`Property<T>` in
 * `c:types`): its name, its kind -- `d` a `double`, `b` a `gboolean`, `s` a
 * UTF-8 string, `o` a `GObject` -- and the compiled functions reading and
 * writing its field, typed by the kind. */
typedef struct NtsGObjectProperty {
  const char *name;
  char kind;
  void (*get)(void);
  void (*set)(void);
} NtsGObjectProperty;

typedef struct NtsGObjectClassData {
  GType type;
  const NtsGObjectSlot *slots;
  size_t count;
  const NtsGObjectProperty *properties;
  size_t property_count;
  GParamSpec **pspecs;
  void *(*make_state)(void);
  const struct NtsGObjectClassData *owner;
  size_t state_offset;
  void (*parent_finalize)(GObject *object);
} NtsGObjectClassData;

/* Every class the program registered, few enough to search in order: one per
 * `class X extends ...` it constructs. */
static NtsGObjectClassData **nts_gobject_classes;
static size_t nts_gobject_class_count;

/* The registered class `type` is, or descends from. */
static NtsGObjectClassData *nts_gobject_class_of(GType type) {
  for (; type != 0; type = g_type_parent(type)) {
    for (size_t at = 0; at < nts_gobject_class_count; at++) {
      if (nts_gobject_classes[at]->type == type) {
        return nts_gobject_classes[at];
      }
    }
  }
  return NULL;
}

static void **nts_gobject_state_slot(void *instance,
                                     const NtsGObjectClassData *class) {
  return (void **)((char *)instance + class->state_offset);
}

/* `finalize` for the class that owns the slot: the fields given back, then
 * the finalize of that class's parent -- the owner's, since a descendant's is
 * this one inherited. */
static void nts_gobject_finalize(GObject *object) {
  const NtsGObjectClassData *owner =
      nts_gobject_class_of(G_OBJECT_TYPE(object))->owner;
  void **slot = nts_gobject_state_slot(object, owner);
  void *state = *slot;
  *slot = NULL;
  if (state) {
    nts_release(state);
  }
  owner->parent_finalize(object);
}

/* The registered class that installed `pspec`: a property's id is its
 * owner's, whichever class the instance is. */
static const NtsGObjectProperty *nts_gobject_property_of(GParamSpec *pspec,
                                                         guint id) {
  for (size_t at = 0; at < nts_gobject_class_count; at++) {
    const NtsGObjectClassData *class = nts_gobject_classes[at];
    if (class->type == pspec->owner_type && id >= 1 &&
        id <= class->property_count) {
      return &class->properties[id - 1];
    }
  }
  return NULL;
}

static void nts_gobject_get_property(GObject *object, guint id, GValue *value,
                                     GParamSpec *pspec) {
  const NtsGObjectProperty *property = nts_gobject_property_of(pspec, id);
  if (!property) {
    G_OBJECT_WARN_INVALID_PROPERTY_ID(object, id, pspec);
    return;
  }
  switch (property->kind) {
  case 'd':
    g_value_set_double(value, ((double (*)(void *))property->get)(object));
    break;
  case 'b':
    g_value_set_boolean(value, ((bool (*)(void *))property->get)(object));
    break;
  case 's': {
    /* The getter answers a string the caller owns, copied into the value
     * and given back. */
    NtsString *text = ((NtsString * (*)(void *)) property->get)(object);
    const char *c = nts_string_to_cstring(text);
    g_value_set_string(value, c);
    nts_cstring_release(text, c);
    nts_release((NtsHeader *)text);
    break;
  }
  default: {
    void *held = ((void *(*)(void *))property->get)(object);
#ifdef NTS_PROVIDER_RC
    /* Under counting the getter's answer is a reference the caller owns,
     * which the value takes over; without, it is borrowed. */
    g_value_take_object(value, held);
#else
    g_value_set_object(value, held);
#endif
    break;
  }
  }
}

static void nts_gobject_set_property(GObject *object, guint id,
                                     const GValue *value, GParamSpec *pspec) {
  const NtsGObjectProperty *property = nts_gobject_property_of(pspec, id);
  if (!property) {
    G_OBJECT_WARN_INVALID_PROPERTY_ID(object, id, pspec);
    return;
  }
  switch (property->kind) {
  case 'd':
    ((void (*)(void *, double))property->set)(object,
                                              g_value_get_double(value));
    break;
  case 'b':
    ((void (*)(void *, bool))property->set)(object,
                                            g_value_get_boolean(value) != 0);
    break;
  case 's': {
    /* GObject's absent string is NULL, which a `string` field cannot hold:
     * it is written as the empty string, the property's default. */
    const char *c = g_value_get_string(value);
    NtsString *text = nts_string_from_utf8(c ? c : "", c ? strlen(c) : 0);
    ((void (*)(void *, NtsString *))property->set)(object, text);
    nts_release((NtsHeader *)text);
    break;
  }
  default:
    ((void (*)(void *, void *))property->set)(object,
                                              g_value_get_object(value));
    break;
  }
}

/* Each property's `GParamSpec`, installed in `class_init` with the ids
 * 1..count. Written with `EXPLICIT_NOTIFY`: the field's own writes notify,
 * `g_object_set`'s among them, so GObject does not notify a second time. */
static void nts_gobject_install_properties(GObjectClass *object_class,
                                           NtsGObjectClassData *table) {
  GParamFlags flags =
      G_PARAM_READWRITE | G_PARAM_EXPLICIT_NOTIFY | G_PARAM_STATIC_STRINGS;
  table->pspecs = g_new0(GParamSpec *, table->property_count);
  object_class->get_property = nts_gobject_get_property;
  object_class->set_property = nts_gobject_set_property;
  for (size_t at = 0; at < table->property_count; at++) {
    const NtsGObjectProperty *property = &table->properties[at];
    GParamSpec *spec;
    switch (property->kind) {
    case 'd':
      spec = g_param_spec_double(property->name, NULL, NULL, -G_MAXDOUBLE,
                                 G_MAXDOUBLE, 0.0, flags);
      break;
    case 'b':
      spec = g_param_spec_boolean(property->name, NULL, NULL, FALSE, flags);
      break;
    case 's':
      spec = g_param_spec_string(property->name, NULL, NULL, "", flags);
      break;
    default:
      spec =
          g_param_spec_object(property->name, NULL, NULL, G_TYPE_OBJECT, flags);
      break;
    }
    table->pspecs[at] = spec;
    g_object_class_install_property(object_class, (guint)(at + 1), spec);
  }
}

static void nts_gobject_class_init(gpointer klass, gpointer data) {
  NtsGObjectClassData *table = data;
  for (size_t at = 0; at < table->count; at++) {
    memcpy((char *)klass + table->slots[at].offset, &table->slots[at].entry,
           sizeof table->slots[at].entry);
  }
  if (table->property_count > 0) {
    nts_gobject_install_properties(G_OBJECT_CLASS(klass), table);
  }
  if (table->owner == table) {
    GObjectClass *object_class = G_OBJECT_CLASS(klass);
    table->parent_finalize =
        G_OBJECT_CLASS(g_type_class_peek_parent(klass))->finalize;
    object_class->finalize = nts_gobject_finalize;
  }
}

/* `instance_init` for the class that owns the slot: the fields of the class
 * being made -- `g_class` is the instance's, not this one's -- hold their
 * initial values by the time `new` returns, as JavaScript's do. */
static void nts_gobject_instance_init(GTypeInstance *instance,
                                      gpointer g_class) {
  NtsGObjectClassData *class = nts_gobject_class_of(G_TYPE_FROM_CLASS(g_class));
  *nts_gobject_state_slot(instance, class->owner) = class->make_state();
}

size_t nts_gobject_register(size_t parent, const char *name, const void *slots,
                            size_t count, void *(*make_state)(void)) {
  GTypeQuery query;
  g_type_query((GType)parent, &query);
  if (query.type == 0) {
    fprintf(stderr, "nts: `%s` extends a class GObject does not know\n", name);
    abort();
  }
  /* Lives as long as the type, which is as long as the program. */
  NtsGObjectClassData *data = g_new0(NtsGObjectClassData, 1);
  data->slots = slots;
  data->count = count;
  data->make_state = make_state;
  GTypeInfo info = {0};
  info.class_size = (guint16)query.class_size;
  info.class_init = nts_gobject_class_init;
  info.class_data = data;
  info.instance_size = (guint16)query.instance_size;
  /* A parent the program wrote whose chain already has a slot: the fields
   * go there, and this class's own maker makes them. */
  const NtsGObjectClassData *above = nts_gobject_class_of((GType)parent);
  if (above && above->owner) {
    if (!make_state) {
      fprintf(stderr, "nts: `%s` extends a class with fields but makes none\n",
              name);
      abort();
    }
    data->owner = above->owner;
    data->state_offset = above->owner->state_offset;
  } else if (make_state) {
    size_t align = sizeof(void *);
    data->owner = data;
    data->state_offset = (query.instance_size + align - 1) / align * align;
    info.instance_size = (guint16)(data->state_offset + sizeof(void *));
    info.instance_init = nts_gobject_instance_init;
  }
  data->type = g_type_register_static((GType)parent, name, &info, 0);
  nts_gobject_classes = g_renew(NtsGObjectClassData *, nts_gobject_classes,
                                nts_gobject_class_count + 1);
  nts_gobject_classes[nts_gobject_class_count++] = data;
  return (size_t)data->type;
}

void nts_gobject_made(void *object) {
#ifndef NTS_PROVIDER_RC
  if (object != NULL && g_object_is_floating(object)) {
    g_object_ref_sink(object);
  }
#else
  (void)object;
#endif
}

void nts_gobject_set_properties(size_t type, const void *properties,
                                size_t count) {
  for (size_t at = 0; at < nts_gobject_class_count; at++) {
    if (nts_gobject_classes[at]->type == (GType)type) {
      nts_gobject_classes[at]->properties = properties;
      nts_gobject_classes[at]->property_count = count;
      return;
    }
  }
}

void *nts_gobject_property_spec(size_t type, unsigned index) {
  /* The class's own, which `class_init` made: a reference to it makes it. */
  gpointer klass = g_type_class_ref((GType)type);
  g_type_class_unref(klass);
  for (size_t at = 0; at < nts_gobject_class_count; at++) {
    const NtsGObjectClassData *class = nts_gobject_classes[at];
    if (class->type == (GType)type && class->pspecs &&
        index < class->property_count) {
      return class->pspecs[index];
    }
  }
  return NULL;
}

void *nts_gobject_state(void *instance) {
  NtsGObjectClassData *class =
      nts_gobject_class_of(G_TYPE_FROM_INSTANCE(instance));
  if (!class || !class->owner) {
    fprintf(stderr, "nts: %s has no fields of a program's class to read\n",
            G_OBJECT_TYPE_NAME(instance));
    abort();
  }
  return *nts_gobject_state_slot(instance, class->owner);
}

/* A boxed record given back as GLib gives any back: by its `GType`, which the
 * box keeps as its opaque word. */
static void nts_gobject_boxed_free(void *boxed, size_t type) {
  g_boxed_free((GType)type, boxed);
}

void *nts_gobject_boxed(void *boxed, size_t type) {
  return nts_boxed_new(boxed, nts_gobject_boxed_free, type);
}

void *nts_gobject_boxed_copy(const void *boxed, size_t type) {
  if (boxed == NULL) {
    return NULL;
  }
  return nts_boxed_new(g_boxed_copy((GType)type, boxed), nts_gobject_boxed_free,
                       type);
}

/* `g_malloc0`, which is what `g_boxed_free` gives back for the records C
 * lets a caller allocate: since GLib 2.76 `g_slice` is `g_malloc`. */
void *nts_gobject_boxed_new(size_t type, size_t size) {
  return nts_boxed_new(g_malloc0(size), nts_gobject_boxed_free, type);
}

void *nts_gobject_parent_slot(size_t parent, size_t offset) {
  gpointer klass = g_type_class_peek((GType)parent);
  if (klass == NULL) {
    return NULL;
  }
  void *slot;
  memcpy(&slot, (char *)klass + offset, sizeof slot);
  return slot;
}

unsigned nts_gobject_add_signal(size_t type, const char *name,
                                const char *kinds) {
  GType params[16];
  guint count = (guint)strlen(kinds);
  g_return_val_if_fail(count <= G_N_ELEMENTS(params), 0);
  for (guint at = 0; at < count; at++) {
    switch (kinds[at]) {
    case 'd':
      params[at] = G_TYPE_DOUBLE;
      break;
    case 'b':
      params[at] = G_TYPE_BOOLEAN;
      break;
    case 's':
      params[at] = G_TYPE_STRING;
      break;
    default:
      params[at] = G_TYPE_OBJECT;
      break;
    }
  }
  /* No class closure and no accumulator, and GLib's generic marshaller: a
   * handler's C signature is what its bridge was compiled to. */
  return g_signal_newv(name, (GType)type, G_SIGNAL_RUN_LAST, NULL, NULL, NULL,
                       NULL, G_TYPE_NONE, count, params);
}

unsigned nts_gobject_signal_id(void *instance, const char *name,
                               size_t cache[2]) {
  GType type = G_TYPE_FROM_INSTANCE(instance);
  if (cache[0] != (size_t)type) {
    cache[1] = g_signal_lookup(name, type);
    cache[0] = (size_t)type;
  }
  return (unsigned)cache[1];
}

/* How a `GObject` held by an erased value is counted: a value that holds one
 * owns one reference, as it does a managed object. Registered before any
 * program code runs, since a constructor runs at load. */
static void nts_gobject_value_retain(void *object) { g_object_ref(object); }
static void nts_gobject_value_release(void *object) { g_object_unref(object); }

__attribute__((constructor)) static void nts_gobject_register_family(void) {
  nts_handle_family_register(NTS_TAG_HANDLE_GOBJECT, nts_gobject_value_retain,
                             nts_gobject_value_release, "GObject");
}

void *nts_gobject_new(size_t type) {
  GObject *made = g_object_new((GType)type, NULL);
  if (g_object_is_floating(made)) {
    g_object_ref_sink(made);
  }
  return made;
}

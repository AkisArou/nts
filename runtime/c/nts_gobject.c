#include "nts_gobject.h"

#include "nts_runtime.h"

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

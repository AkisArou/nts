// What a C++ programmer writes: a `std::vector` of rows held by value, erased
// and appended in place, with `std::string` labels.
//
// No collector and no checkpoint, which is the point of the row: the event's
// own work is a vector erase, an append, a string assignment and two draws,
// and nothing here is proportional to the thousand rows the table holds
// except the erase's move of the rows after the removed one -- which the
// compiled program pays too, as `splice`'s `memmove`.
#include <cstdint>
#include <string>
#include <vector>
#include "harness.h"

namespace {

const char *const adjectives[] = {
    "pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
    "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable",
    "important", "inexpensive", "cheap", "expensive", "fancy",
};
const char *const nouns[] = {
    "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza",
    "mouse", "keyboard",
};

struct Row {
    int id;
    std::string label;
};

struct Table {
    std::vector<Row> rows;
    int next_id = 1;
    std::int64_t random = 1;
};

Table table;

int draw(Table &t, int max) {
    t.random = t.random * 16807 % 2147483647;
    return static_cast<int>(t.random % max);
}

std::string label(Table &t) {
    std::string text = adjectives[draw(t, 25)];
    text += ' ';
    text += nouns[draw(t, 13)];
    return text;
}

void add(Table &t) {
    const int id = t.next_id++;
    t.rows.push_back(Row{id, label(t)});
}

double event(int seed) {
    Table &t = table;
    if (t.rows.empty()) {
        for (int i = 0; i < 1000; i++) {
            add(t);
        }
    }
    const int size = static_cast<int>(t.rows.size());
    t.rows.erase(t.rows.begin() + draw(t, size));
    add(t);
    const int count = static_cast<int>(t.rows.size());
    t.rows[(draw(t, count) + seed) % count].label = label(t);
    return count + t.rows.front().id + static_cast<int>(t.rows.back().label.size());
}

}  // namespace

double bench_run(void) {
    volatile double seed = 3;
    return event(static_cast<int>(seed));
}

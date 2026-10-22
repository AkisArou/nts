// What a C++ programmer writes: `std::unordered_map<std::string, int>`, `find`
// for a lookup and `operator[]` for an update. Every operation hashes its key
// (libstdc++ caches the hash in the node, not in the string) and compares the
// contents of a hit.
//
// The same generator, keys and copies as `case.ts`; ASCII, so one `char` is
// one UTF-16 code unit.
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>
#include "harness.h"

static std::uint32_t next(std::uint32_t x) { return x * 1664525u + 1013904223u; }

static std::vector<std::string> words(int count, std::uint32_t shortest,
                                      std::uint32_t longest, std::uint32_t x) {
    std::vector<std::string> out;
    for (int i = 0; i < count; i++) {
        x = next(x);
        const std::uint32_t length = shortest + (x >> 24) % (longest - shortest + 1);
        std::string word;
        for (std::uint32_t k = 0; k < length; k++) {
            x = next(x);
            word += static_cast<char>('a' + (x >> 24) % 26);
        }
        out.push_back(std::move(word));
    }
    return out;
}

static const std::vector<std::string> keys = words(64, 4, 32, 41);
static const std::vector<std::string> present = words(64, 4, 32, 41);
static const std::vector<std::string> absent = words(64, 4, 32, 43);

static std::int32_t get(const std::unordered_map<std::string, std::int32_t> &map,
                        const std::string &key, std::int32_t missing) {
    const auto found = map.find(key);
    return found == map.end() ? missing : found->second;
}

static std::int32_t work(std::int32_t seed) {
    const std::uint32_t s = static_cast<std::uint32_t>(seed) & 127;
    std::unordered_map<std::string, std::int32_t> map;
    for (std::uint32_t i = 0; i < 64; i++) {
        map.emplace(keys[i], static_cast<std::int32_t>(i + s));
    }
    std::uint32_t total = 0;
    for (std::uint32_t i = 0; i < 512; i++) {
        const std::uint32_t j = (i * 5 + s) & 127;
        const std::string &key = j < 64 ? present[j] : absent[j - 64];
        total = total + static_cast<std::uint32_t>(get(map, key, -1));
    }
    for (std::uint32_t i = 0; i < 128; i++) {
        map[present[(i * 3 + s) & 63]] += 1;
    }
    for (std::uint32_t i = 0; i < 64; i++) {
        total = total * 31 + static_cast<std::uint32_t>(get(map, present[i], 0));
    }
    return static_cast<std::int32_t>(total);
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(work(seed));
}

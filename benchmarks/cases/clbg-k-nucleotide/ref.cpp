/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * contributed by Malte Skarupke.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/knucleotide-gpp-1.html
 *
 * The original explicitly offers a single-threaded mode by disabling
 * MULTI_THREADED. Here its deferred futures are direct calls, in the same
 * execution order. GNU's cc_hash_table becomes std::unordered_map for portable
 * C++20; RunningHash, masking, counting and arithmetic remain the author's.
 * The suite's C++ representation differs from the JavaScript string-key Map:
 * preserving that authored choice makes this a reference, not a new algorithm
 * written for this compiler. Both count every reading frame in a hash map.
 * FASTA input and output are held in memory; the generator is credited below.
 */
#include <iomanip>
#include <locale>
#include <sstream>
#include <unordered_map>

/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * Converted to C++ from D by Rafal Rusin; modified by Vaclav Haisman,
 * The Anh (to compile with g++ 4.3.2), and Branimir Maksimovic.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fasta-gpp-1.html
 *
 * This is the suite's single-threaded C++ program, retaining its float
 * arithmetic, cumulative probabilities, std::vector and count_if lookup.
 * It is the fair ceiling because these are the original C++ author's choices.
 * Only I/O becomes a string, RNG/table state is reset for repeated calls,
 * and bench_run hashes the output after reading the size through volatile.
 */
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <numeric>
#include <string>
#include <vector>

#include "harness.h"

namespace ClbgFasta {
static int const IM = 139968, IA = 3877, IC = 29573;
static int last = 42;

static inline float genRandom(float max) {
    return max * (last = (last * IA + IC) % IM) / IM;
}

struct IUB {
    char c;
    float p;
};

static inline void makeCumulative(std::vector<IUB>& i) {
    std::partial_sum(i.begin(), i.end(), i.begin(),
                    [](IUB l, IUB r) -> IUB { r.p += l.p; return r; });
}

static const char alu[] =
    "GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCACTTTGG"
    "GAGGCCGAGGCGGGCGGATCACCTGAGGTCAGGAGTTCGAGA"
    "CCAGCCTGGCCAACATGGTGAAACCCCGTCTCTACTAAAAAT"
    "ACAAAAATTAGCCGGGCGTGGTGGCGCGCGCCTGTAATCCCA"
    "GCTACTCGGGAGGCTGAGGCAGGAGAATCGCTTGAACCCGGG"
    "AGGCGGAGGTTGCAGTGAGCCGAGATCGCGCCACTGCACTCC"
    "AGCCTGGGCGACAGAGCGAGACTCCGTCTCAAAAA";
static const unsigned length = 60;

template <class F>
static inline void make(std::string& output, char const* id,
                        char const* desc, unsigned n, F f) {
    output += ">";
    output += id;
    output += " ";
    output += desc;
    output += '\n';
    char line[length + 1] = {0};
    unsigned i = 0;
    while (n-- > 0) {
        line[i++] = f();
        if (i >= length) {
            output += line;
            output += '\n';
            i = 0;
        }
    }
    line[i] = 0;
    if (std::strlen(line)) {
        output += line;
        output += '\n';
    }
}

struct Repeat {
    explicit Repeat(const char* alu) : i(0), size(std::strlen(alu)), alu(alu) {}
    char operator()() {
        if (i >= size) i = 0;
        return alu[i++];
    }
    unsigned i, size;
    const char* alu;
};

struct Random {
    explicit Random(std::vector<IUB>& i) : i(i) {}
    char operator()() {
        float p = genRandom(1.0);
        return i[std::count_if(i.begin(), i.end(),
                              [p](IUB i) { return p >= i.p; })].c;
    }
    std::vector<IUB>& i;
};

static std::string render(unsigned n) {
    last = 42;
    std::vector<IUB> iub = {
        {'a', 0.27}, {'c', 0.12}, {'g', 0.12}, {'t', 0.27},
        {'B', 0.02}, {'D', 0.02}, {'H', 0.02}, {'K', 0.02},
        {'M', 0.02}, {'N', 0.02}, {'R', 0.02}, {'S', 0.02},
        {'V', 0.02}, {'W', 0.02}, {'Y', 0.02}
    };
    std::vector<IUB> homosapiens = {
        {'a', 0.3029549426680}, {'c', 0.1979883004921},
        {'g', 0.1975473066391}, {'t', 0.3015094502008}
    };
    makeCumulative(iub);
    makeCumulative(homosapiens);
    std::string output;
    make(output, "ONE", "Homo sapiens alu", n * 2, Repeat(alu));
    make(output, "TWO", "IUB ambiguity codes", n * 3, Random(iub));
    make(output, "THREE", "Homo sapiens frequency", n * 5, Random(homosapiens));
    return output;
}
}  // namespace ClbgFasta

constexpr const unsigned char tochar[8] =
{
   'A', 'A',
   'C', 'C',
   'T', 'T',
   'G', 'G'
};

// the mask used in the running hash. for a string of size 1
// this is 0b111, for a string of size 2 this is 0b11111,
// for a string of size 4 it's 0b111111111 etc.
// so it sets the lower 2n+1 bits to 1.
//
// this makes it so that the running hash can just keep on shifting
// to the left, and this mask will remove higher bits
uint64_t mask_for_size(unsigned size)
{
   return (1llu << ((size << 1llu) + 1llu)) - 1llu;
}

// incremental hash function that can hash strings of the
// characters 'a', 'A', 'c', 'C', 't', 'T', 'g', 'G'
// it works by realizing that the second and third last bit
// of these are all different. 'a' ends with 0b001,
// 'c' ends with 0b011, 't' ends with 0b100 and 'g'
// ends with 0b111. so we use the mask 0b110 to tell
// them all apart
struct RunningHash
{
   RunningHash()
      : data(0)
   {
   }
   RunningHash(const std::string& s)
      : data(0)
   {
      uint64_t mask = mask_for_size(s.size());
      for (char c : s)
      {
         push(c, mask);
      }
   }
   void push(char c, uint64_t mask)
   {
      // shift old characters over
      data <<= 2;
      // mask out oldest character
      data &= mask;
      // add two bits from the new character
      data |= c & 0b110;
   }
   bool operator<(const RunningHash & in)const
   {
      return data < in.data;
   }
   bool operator==(const RunningHash & in)const
   {
      return data == in.data;
   }
   std::string to_string(unsigned size)const
   {
      std::string tmp;
      tmp.reserve(size);
      uint64_t tmp1 = data;
      for(unsigned i = 0; i != size; ++i)
      {
         tmp += tochar[tmp1 & 0b110];
         tmp1 >>= 2;
      }
      std::reverse(tmp.begin(), tmp.end());
      return tmp;
   }
   struct hash
   {
      uint64_t operator()(const RunningHash & t) const
      {
         return t.data;
      }
   };
   uint64_t data;
};

typedef std::unordered_map
<
   RunningHash,
   unsigned,
   RunningHash::hash
> HashMap;

HashMap calculate(const char * begin, const char * end, unsigned size)
{
   HashMap frequencies;
   RunningHash tmp;
   uint64_t mask = mask_for_size(size);
   // push the first n-1 characters without adding them to the hash
   // table. need to do this to initialize the incremental hash
   for (const char * init_end = begin + size - 1; begin != init_end; ++begin)
   {
      tmp.push(*begin, mask);
   }
   // add one characer at a time, counting how often each pattern occurs
   for (; begin != end; ++begin)
   {
      tmp.push(*begin, mask);
      ++frequencies[RunningHash(tmp)];
   }
   return frequencies;
}

void write_frequencies(std::ostream& output, const HashMap & f, unsigned input_size, unsigned size)
{
   std::vector<std::pair<unsigned, std::string>> freq_sorted;
   freq_sorted.reserve(f.size());
   for(auto && i: f)
   {
      freq_sorted.emplace_back(i.second, i.first.to_string(size));
   }
   std::sort(freq_sorted.begin(), freq_sorted.end(),
         [](const auto & l, const auto & r)
   {
      return l.first > r.first;
   });
   unsigned sum = input_size + 1 - size;
   for(auto && i : freq_sorted)
      output << i.second << ' ' << (double(100 * i.first) / sum) << '\n';
   output << '\n';
}

unsigned compute_count(const std::string & input, const std::string& string)
{
   // compute all values, but then only read one value. the problem description
   // requires that we compute all values
   const char * c_str_end = input.c_str() + input.size();
   return calculate(input.c_str(), c_str_end, string.size())[string];
}

void write_single_count(std::ostream& output, unsigned count, const char * string)
{
   output << count << '\t' << string << '\n';
}

static std::string render(unsigned n) {
   std::istringstream fasta(ClbgFasta::render(n));
   std::string input;
   char buffer[256];
   while (fasta.getline(buffer, 100) && std::memcmp(">THREE", buffer, 6) != 0) {
   }
   while (fasta.getline(buffer, 100) && buffer[0] != '>') {
      if (buffer[0] != ';') {
         // getline removes the LF that fgets left for the source to subtract.
         input.append(buffer, std::strlen(buffer));
      }
   }

   std::ostringstream output;
   output.imbue(std::locale::classic());
   output << std::setprecision(3) << std::setiosflags(std::ios::fixed);
   const char* begin = input.data();
   const char* end = input.data() + input.size();
   // The execution order of the source's launch::deferred single-thread mode.
   write_frequencies(output, calculate(begin, end, 1), input.size(), 1);
   write_frequencies(output, calculate(begin, end, 2), input.size(), 2);
   write_single_count(output, compute_count(input, "GGT"), "GGT");
   write_single_count(output, compute_count(input, "GGTA"), "GGTA");
   write_single_count(output, compute_count(input, "GGTATT"), "GGTATT");
   write_single_count(output, compute_count(input, "GGTATTTTAATT"), "GGTATTTTAATT");
   write_single_count(output, compute_count(input, "GGTATTTTAATTTATAGT"), "GGTATTTTAATTTATAGT");
   return output.str();
}

double bench_run(void) {
   volatile std::uint32_t n = 1000;
   const std::string output = render(n);
   std::uint32_t hash = 0;
   for (unsigned char c : output) hash = hash * 31u + c;
   return hash;
}

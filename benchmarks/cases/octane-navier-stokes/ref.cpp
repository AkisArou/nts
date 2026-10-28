/**
 * Copyright 2013 the V8 project authors. All rights reserved.
 * Copyright 2009 Oliver Hunt <http://nerget.com>
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 *
 * Update 10/21/2013: fixed loop variables at line 119
 */

// Mechanically transcribed from Oliver Hunt's MIT-licensed fluid solver in
// chromium/octane navier-stokes.js at 570ad1ccfe86e3eecba0636c8f932ac08edec517:
// https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/navier-stokes.js
// Its algorithm descends from Jos Stam's "Real-Time Fluid Dynamics for Games"
// (GDC 2003): https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf
// The licensed source for this file is Hunt's Octane program, not Stam's
// separately distributed solver.c. This is not an independently authored
// Octane C++ program. Native double arrays provide the C++ ceiling for the
// C-derived algorithm while preserving Hunt's arithmetic, loop order,
// zero-diffusion copy, paired velocity pass, input and validation exactly.
// Closure state becomes a struct; array parameters are pointers so the source's
// local swaps retain their meaning. Index increments are sequenced explicitly
// where JavaScript evaluates an assignment's destination before its source.

#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include "harness.h"

namespace {

struct FluidState {
    int iterations = 10;
    double visc = 0.5;
    double dt = 0.1;
    std::vector<double> dens, dens_prev, u, u_prev, v, v_prev;
    int width = 0;
    int height = 0;
    int rowSize = 0;
    int size = 0;

    FluidState() { setResolution(64, 64); }

    void addFields(double* x, const double* s, double dt) {
        for (int i = 0; i < size; i++) x[i] += dt * s[i];
    }

    void set_bnd(int b, double* x) {
        if (b == 1) {
            for (int i = 1; i <= width; i++) {
                x[i] = x[i + rowSize];
                x[i + (height + 1) * rowSize] = x[i + height * rowSize];
            }
            for (int j = 1; j <= height; j++) {
                x[j * rowSize] = -x[1 + j * rowSize];
                x[(width + 1) + j * rowSize] = -x[width + j * rowSize];
            }
        } else if (b == 2) {
            for (int i = 1; i <= width; i++) {
                x[i] = -x[i + rowSize];
                x[i + (height + 1) * rowSize] = -x[i + height * rowSize];
            }
            for (int j = 1; j <= height; j++) {
                x[j * rowSize] = x[1 + j * rowSize];
                x[(width + 1) + j * rowSize] = x[width + j * rowSize];
            }
        } else {
            for (int i = 1; i <= width; i++) {
                x[i] = x[i + rowSize];
                x[i + (height + 1) * rowSize] = x[i + height * rowSize];
            }
            for (int j = 1; j <= height; j++) {
                x[j * rowSize] = x[1 + j * rowSize];
                x[(width + 1) + j * rowSize] = x[width + j * rowSize];
            }
        }
        int maxEdge = (height + 1) * rowSize;
        x[0] = 0.5 * (x[1] + x[rowSize]);
        x[maxEdge] = 0.5 * (x[1 + maxEdge] + x[height * rowSize]);
        x[width + 1] = 0.5 * (x[width] + x[(width + 1) + rowSize]);
        x[(width + 1) + maxEdge] = 0.5 * (x[width + maxEdge] + x[(width + 1) + height * rowSize]);
    }

    void lin_solve(int b, double* x, const double* x0, double a, double c) {
        if (a == 0 && c == 1) {
            for (int j = 1; j <= height; j++) {
                int currentRow = j * rowSize;
                ++currentRow;
                for (int i = 0; i < width; i++) {
                    x[currentRow] = x0[currentRow];
                    ++currentRow;
                }
            }
            set_bnd(b, x);
        } else {
            double invC = 1 / c;
            for (int k = 0; k < iterations; k++) {
                for (int j = 1; j <= height; j++) {
                    int lastRow = (j - 1) * rowSize;
                    int currentRow = j * rowSize;
                    int nextRow = (j + 1) * rowSize;
                    double lastX = x[currentRow];
                    ++currentRow;
                    for (int i = 1; i <= width; i++) {
                        // JS captures x[currentRow] and x0[currentRow] before
                        // evaluating the three pre-increments on the right.
                        int cell = currentRow;
                        double source = x0[currentRow];
                        ++currentRow;
                        ++lastRow;
                        ++nextRow;
                        lastX = x[cell] = (source + a * (lastX + x[currentRow] + x[lastRow] + x[nextRow])) * invC;
                    }
                }
                set_bnd(b, x);
            }
        }
    }

    void diffuse(int b, double* x, const double* x0, double /*dt*/) {
        double a = 0;
        lin_solve(b, x, x0, a, 1 + 4 * a);
    }

    void lin_solve2(double* x, const double* x0, double* y, const double* y0, double a, double c) {
        if (a == 0 && c == 1) {
            for (int j = 1; j <= height; j++) {
                int currentRow = j * rowSize;
                ++currentRow;
                for (int i = 0; i < width; i++) {
                    x[currentRow] = x0[currentRow];
                    y[currentRow] = y0[currentRow];
                    ++currentRow;
                }
            }
            set_bnd(1, x);
            set_bnd(2, y);
        } else {
            double invC = 1 / c;
            for (int k = 0; k < iterations; k++) {
                for (int j = 1; j <= height; j++) {
                    int lastRow = (j - 1) * rowSize;
                    int currentRow = j * rowSize;
                    int nextRow = (j + 1) * rowSize;
                    double lastX = x[currentRow];
                    double lastY = y[currentRow];
                    ++currentRow;
                    for (int i = 1; i <= width; i++) {
                        // Preserve Hunt's nonzero-diffusion indexing exactly,
                        // including the x[currentRow] read. Octane uses a=0.
                        lastX = x[currentRow] = (x0[currentRow] + a * (lastX + x[currentRow] + x[lastRow] + x[nextRow])) * invC;
                        int cell = currentRow;
                        double source = y0[currentRow];
                        ++currentRow;
                        ++lastRow;
                        ++nextRow;
                        lastY = y[cell] = (source + a * (lastY + y[currentRow] + y[lastRow] + y[nextRow])) * invC;
                    }
                }
                set_bnd(1, x);
                set_bnd(2, y);
            }
        }
    }

    void diffuse2(double* x, const double* x0, double* y, const double* y0, double /*dt*/) {
        double a = 0;
        lin_solve2(x, x0, y, y0, a, 1 + 4 * a);
    }

    void advect(int b, double* d, const double* d0, const double* u, const double* v, double dt) {
        double Wdt0 = dt * width;
        double Hdt0 = dt * height;
        double Wp5 = width + 0.5;
        double Hp5 = height + 0.5;
        for (int j = 1; j <= height; j++) {
            int pos = j * rowSize;
            for (int i = 1; i <= width; i++) {
                ++pos;
                double x = i - Wdt0 * u[pos];
                double y = j - Hdt0 * v[pos];
                if (x < 0.5) x = 0.5;
                else if (x > Wp5) x = Wp5;
                int i0 = static_cast<int>(x);
                int i1 = i0 + 1;
                if (y < 0.5) y = 0.5;
                else if (y > Hp5) y = Hp5;
                int j0 = static_cast<int>(y);
                int j1 = j0 + 1;
                double s1 = x - i0;
                double s0 = 1 - s1;
                double t1 = y - j0;
                double t0 = 1 - t1;
                int row1 = j0 * rowSize;
                int row2 = j1 * rowSize;
                d[pos] = s0 * (t0 * d0[i0 + row1] + t1 * d0[i0 + row2]) + s1 * (t0 * d0[i1 + row1] + t1 * d0[i1 + row2]);
            }
        }
        set_bnd(b, d);
    }

    void project(double* u, double* v, double* p, double* div) {
        double h = -0.5 / std::sqrt(width * height);
        for (int j = 1; j <= height; j++) {
            int row = j * rowSize;
            int previousRow = (j - 1) * rowSize;
            int prevValue = row - 1;
            int currentRow = row;
            int nextValue = row + 1;
            int nextRow = (j + 1) * rowSize;
            for (int i = 1; i <= width; i++) {
                ++currentRow;
                ++nextValue;
                ++prevValue;
                ++nextRow;
                ++previousRow;
                div[currentRow] = h * (u[nextValue] - u[prevValue] + v[nextRow] - v[previousRow]);
                p[currentRow] = 0;
            }
        }
        set_bnd(0, div);
        set_bnd(0, p);
        lin_solve(0, p, div, 1, 4);
        double wScale = 0.5 * width;
        double hScale = 0.5 * height;
        for (int j = 1; j <= height; j++) {
            int prevPos = j * rowSize - 1;
            int currentPos = j * rowSize;
            int nextPos = j * rowSize + 1;
            int prevRow = (j - 1) * rowSize;
            int nextRow = (j + 1) * rowSize;
            for (int i = 1; i <= width; i++) {
                ++currentPos;
                ++nextPos;
                ++prevPos;
                u[currentPos] -= wScale * (p[nextPos] - p[prevPos]);
                ++nextRow;
                ++prevRow;
                v[currentPos] -= hScale * (p[nextRow] - p[prevRow]);
            }
        }
        set_bnd(1, u);
        set_bnd(2, v);
    }

    void dens_step(double* x, double* x0, double* u, double* v, double dt) {
        addFields(x, x0, dt);
        diffuse(0, x0, x, dt);
        advect(0, x, x0, u, v, dt);
    }

    void vel_step(double* u, double* v, double* u0, double* v0, double dt) {
        addFields(u, u0, dt);
        addFields(v, v0, dt);
        double* temp = u0; u0 = u; u = temp;
        temp = v0; v0 = v; v = temp;
        diffuse2(u, u0, v, v0, dt);
        project(u, v, u0, v0);
        temp = u0; u0 = u; u = temp;
        temp = v0; v0 = v; v = temp;
        advect(1, u, u0, u0, v0, dt);
        advect(2, v, v0, u0, v0, dt);
        project(u, v, u0, v0);
    }

    void reset() {
        rowSize = width + 2;
        size = (width + 2) * (height + 2);
        // Fresh arrays match each independent FluidField.reset call.
        dens = std::vector<double>(size, 0);
        dens_prev = std::vector<double>(size, 0);
        u = std::vector<double>(size, 0);
        u_prev = std::vector<double>(size, 0);
        v = std::vector<double>(size, 0);
        v_prev = std::vector<double>(size, 0);
    }

    bool setResolution(int hRes, int wRes) {
        int res = wRes * hRes;
        if (res > 0 && res < 1000000 && (wRes != width || hRes != height)) {
            width = wRes;
            height = hRes;
            reset();
            return true;
        }
        return false;
    }

    void set_density(int x, int y, double value) {
        dens_prev[(x + 1) + (y + 1) * rowSize] = value;
    }
    void set_velocity(int x, int y, double xv, double yv) {
        u_prev[(x + 1) + (y + 1) * rowSize] = xv;
        v_prev[(x + 1) + (y + 1) * rowSize] = yv;
    }
    void add_points() {
        int n = 64;
        for (int i = 1; i <= n; i++) {
            set_velocity(i, i, n, n);
            set_density(i, i, 5);
            set_velocity(i, n - i, -n, -n);
            set_density(i, n - i, 20);
            set_velocity(128 - i, n + i, -n, -n);
            set_density(128 - i, n + i, 30);
        }
    }
};

int check_result(const std::vector<double>& dens) {
    int result = 0;
    for (int i = 7000; i < 7100; i++) result += static_cast<int>(dens[i] * 10);
    if (result != 77) throw std::runtime_error("checksum failed");
    return result;
}

FluidState simulate(int n) {
    FluidState state;
    // Constructor initializes 64x64, then original setup resets 128x128 twice.
    state.setResolution(128, 128);
    state.iterations = 20;
    state.reset();
    int frames_till_adding_points = 0;
    int frames_between_adding_points = 5;
    for (int frame = 0; frame < n; frame++) {
        for (int i = 0; i < state.size; i++) {
            state.u_prev[i] = state.v_prev[i] = state.dens_prev[i] = 0.0;
        }
        if (frames_till_adding_points == 0) {
            state.add_points();
            frames_till_adding_points = frames_between_adding_points;
            frames_between_adding_points++;
        } else {
            frames_till_adding_points--;
        }
        state.vel_step(state.u.data(), state.v.data(), state.u_prev.data(), state.v_prev.data(), state.dt);
        state.dens_step(state.dens.data(), state.dens_prev.data(), state.u.data(), state.v.data(), state.dt);
        if (frame + 1 == 15) check_result(state.dens);
    }
    return state;
}

double run(int n) {
    const FluidState state = simulate(n);
    std::uint32_t hash = 0;
    for (double value : state.dens) {
        hash = hash * 31u + static_cast<std::uint32_t>(static_cast<std::int32_t>(value * 1000000));
    }
    return static_cast<double>(hash);
}
} // namespace

double bench_run(void) {
    volatile std::int32_t frames = 1;
    return run(frames);
}

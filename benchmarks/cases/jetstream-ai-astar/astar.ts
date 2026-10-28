/*
 * Copyright (c) Brian Grinstead, http://briangrinstead.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// javascript-astar 0.4.1
// http://github.com/bgrins/javascript-astar
// Freely distributable under the MIT License.
// Implements the astar search algorithm in javascript using a Binary Heap.
// Includes Binary Heap (with modifications) from Marijn Haverbeke.
// http://eloquentjavascript.net/appendix2.html

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/ai-astar.js
// Fixed bundle registration becomes local typed exports. See README.md.

export interface Position { x: number; y: number; }
export interface SearchOptions { closest?: boolean; heuristic?: (pos0: GridNode, pos1: GridNode) => number; }
export interface GraphOptions { diagonal?: boolean; }

function pathTo(node: GridNode): GridNode[] {
        var curr = node;
        var path: GridNode[] = [];
        while (curr.parent) {
            path.unshift(curr);
            curr = curr.parent;
        }
        return path;
    }

function getHeap(): BinaryHeap {
        return new BinaryHeap(function(node: GridNode) {
            return node.f;
        });
    }

export const astar = {
  search: function(graph: Graph, start: GridNode, end: GridNode, options?: SearchOptions): GridNode[] {
            graph.cleanDirty();
            options = options || {};
            var heuristic = options.heuristic || astar.heuristics.manhattan;
            var closest = options.closest || false;

            var openHeap = getHeap();
            var closestNode = start; // set the start node to be the closest if required

            start.h = heuristic(start, end);
            graph.markDirty(start);

            openHeap.push(start);

            while (openHeap.size() > 0) {

                // Grab the lowest f(x) to process next.  Heap keeps this sorted for us.
                var currentNode = openHeap.pop();
                // size() guarantees a node for this dense heap. Preserve an
                // explicit TypeError if that source invariant is violated.
                if (currentNode === undefined)
                    throw new TypeError("Cannot set properties of undefined (setting 'closed')");

                // End case -- result has been found, return the traced path.
                if (currentNode === end) {
                    return pathTo(currentNode);
                }

                // Normal case -- move currentNode from open to closed, process each of its neighbors.
                currentNode.closed = true;

                // Find all neighbors for the current node.
                var neighbors = graph.neighbors(currentNode);

                for (var i = 0, il = neighbors.length; i < il; ++i) {
                    var neighbor = neighbors[i];

                    if (neighbor.closed || neighbor.isWall()) {
                        // Not a valid node to process, skip to next neighbor.
                        continue;
                    }

                    // The g score is the shortest distance from start to current node.
                    // We need to check if the path we have arrived at this neighbor is the shortest one we have seen yet.
                    var gScore = currentNode.g + neighbor.getCost(currentNode);
                    var beenVisited = neighbor.visited;

                    if (!beenVisited || gScore < neighbor.g) {

                        // Found an optimal (so far) path to this node.  Take score for node to see how good it is.
                        neighbor.visited = true;
                        neighbor.parent = currentNode;
                        neighbor.h = neighbor.h || heuristic(neighbor, end);
                        neighbor.g = gScore;
                        neighbor.f = neighbor.g + neighbor.h;
                        graph.markDirty(neighbor);
                        if (closest) {
                            // If the neighbour is closer than the current closestNode or if it's equally close but has
                            // a cheaper path than the current closest node then it becomes the closest node
                            if (neighbor.h < closestNode.h || (neighbor.h === closestNode.h && neighbor.g < closestNode.g)) {
                                closestNode = neighbor;
                            }
                        }

                        if (!beenVisited) {
                            // Pushing to heap will put it in proper place based on the 'f' value.
                            openHeap.push(neighbor);
                        } else {
                            // Already seen the node, but since it has been rescored we need to reorder it in the heap
                            openHeap.rescoreElement(neighbor);
                        }
                    }
                }
            }

            if (closest) {
                return pathTo(closestNode);
            }

            // No result was found - empty array signifies failure to find path.
            return [];
        },
  heuristics: {
    manhattan: function(pos0: Position, pos1: Position): number {
                var d1 = Math.abs(pos1.x - pos0.x);
                var d2 = Math.abs(pos1.y - pos0.y);
                return d1 + d2;
            },
    diagonal: function(pos0: Position, pos1: Position): number {
                var D = 1;
                var D2 = Math.sqrt(2);
                var d1 = Math.abs(pos1.x - pos0.x);
                var d2 = Math.abs(pos1.y - pos0.y);
                return (D * (d1 + d2)) + ((D2 - (2 * D)) * Math.min(d1, d2));
            },
  },
  cleanNode: function(node: GridNode): void {
            node.f = 0;
            node.g = 0;
            node.h = 0;
            node.visited = false;
            node.closed = false;
            node.parent = null;
        }
};

export class Graph {
  declare nodes: GridNode[];
  declare diagonal: boolean;
  declare grid: GridNode[][];
  declare dirtyNodes: GridNode[];

  constructor(gridIn: number[][], options?: GraphOptions) {
        options = options || {};
        this.nodes = [];
        this.diagonal = !!options.diagonal;
        this.grid = [];
        for (var x = 0; x < gridIn.length; x++) {
            this.grid[x] = [];

            for (var y = 0, row = gridIn[x]; y < row.length; y++) {
                var node = new GridNode(x, y, row[y]);
                this.grid[x][y] = node;
                this.nodes.push(node);
            }
        }
        this.init();
    }

  init(): void {
        this.dirtyNodes = [];
        for (var i = 0; i < this.nodes.length; i++) {
            astar.cleanNode(this.nodes[i]);
        }
    }

  cleanDirty(): void {
        for (var i = 0; i < this.dirtyNodes.length; i++) {
            astar.cleanNode(this.dirtyNodes[i]);
        }
        this.dirtyNodes = [];
    }

  markDirty(node: GridNode): void {
        this.dirtyNodes.push(node);
    }

  neighbors(node: GridNode): GridNode[] {
        var ret: GridNode[] = [];
        var x = node.x;
        var y = node.y;
        var grid = this.grid;

        // West
        if (grid[x - 1] && grid[x - 1][y]) {
            ret.push(grid[x - 1][y]);
        }

        // East
        if (grid[x + 1] && grid[x + 1][y]) {
            ret.push(grid[x + 1][y]);
        }

        // South
        if (grid[x] && grid[x][y - 1]) {
            ret.push(grid[x][y - 1]);
        }

        // North
        if (grid[x] && grid[x][y + 1]) {
            ret.push(grid[x][y + 1]);
        }

        if (this.diagonal) {
            // Southwest
            if (grid[x - 1] && grid[x - 1][y - 1]) {
                ret.push(grid[x - 1][y - 1]);
            }

            // Southeast
            if (grid[x + 1] && grid[x + 1][y - 1]) {
                ret.push(grid[x + 1][y - 1]);
            }

            // Northwest
            if (grid[x - 1] && grid[x - 1][y + 1]) {
                ret.push(grid[x - 1][y + 1]);
            }

            // Northeast
            if (grid[x + 1] && grid[x + 1][y + 1]) {
                ret.push(grid[x + 1][y + 1]);
            }
        }

        return ret;
    }

  toString(): string {
        var graphString: string[] = [];
        var nodes = this.grid;
        for (var x = 0; x < nodes.length; x++) {
            var rowDebug: number[] = [];
            var row = nodes[x];
            for (var y = 0; y < row.length; y++) {
                rowDebug.push(row[y].weight);
            }
            graphString.push(rowDebug.join(" "));
        }
        return graphString.join("\n");
    }
}

export class GridNode {
  declare x: number;
  declare y: number;
  declare weight: number;
  declare f: number;
  declare g: number;
  declare h: number;
  declare visited: boolean;
  declare closed: boolean;
  declare parent: GridNode | null;

  constructor(x: number, y: number, weight: number) {
        this.x = x;
        this.y = y;
        this.weight = weight;
    }

  toString(): string {
        return "[" + this.x + " " + this.y + "]";
    }

  getCost(fromNeighbor?: GridNode | null): number {
        // Take diagonal weight into consideration.
        if (fromNeighbor && fromNeighbor.x != this.x && fromNeighbor.y != this.y) {
            return this.weight * 1.41421;
        }
        return this.weight;
    }

  isWall(): boolean {
        return this.weight === 0;
    }
}

export class BinaryHeap {
  declare content: GridNode[];
  declare scoreFunction: (node: GridNode) => number;

  constructor(scoreFunction: (node: GridNode) => number) {
        this.content = [];
        this.scoreFunction = scoreFunction;
    }

  push(element: GridNode): void {
            // Add the new element to the end of the array.
            this.content.push(element);

            // Allow it to sink down.
            this.sinkDown(this.content.length - 1);
        }

  pop(): GridNode | undefined {
            // Store the first element so we can return it later.
            var result = this.content[0];
            // Get the element at the end of the array.
            var end = this.content.pop();
            // If there are any elements left, put the end element at the
            // start, and let it bubble up.
            if (this.content.length > 0) {
                if (end === undefined)
                    throw new TypeError("Cannot read properties of undefined (reading 'f')");
                this.content[0] = end;
                this.bubbleUp(0);
            }
            return result;
        }

  remove(node: GridNode): void {
            var i = this.content.indexOf(node);

            // When it is found, the process seen in 'pop' is repeated
            // to fill up the hole.
            var end = this.content.pop();

            if (i !== this.content.length - 1) {
                if (end === undefined)
                    throw new TypeError("Cannot read properties of undefined (reading 'f')");
                this.content[i] = end;

                if (this.scoreFunction(end) < this.scoreFunction(node)) {
                    this.sinkDown(i);
                } else {
                    this.bubbleUp(i);
                }
            }
        }

  size(): number {
            return this.content.length;
        }

  rescoreElement(node: GridNode): void {
            this.sinkDown(this.content.indexOf(node));
        }

  sinkDown(n: number): void {
            // Fetch the element that has to be sunk.
            var element = this.content[n];

            // When at 0, an element can not sink any further.
            while (n > 0) {

                // Compute the parent element's index, and fetch it.
                var parentN = ((n + 1) >> 1) - 1;
                var parent = this.content[parentN];
                // Swap the elements if the parent is greater.
                if (this.scoreFunction(element) < this.scoreFunction(parent)) {
                    this.content[parentN] = element;
                    this.content[n] = parent;
                    // Update 'n' to continue at the new position.
                    n = parentN;
                }
                // Found a parent that is less, no need to sink any further.
                else {
                    break;
                }
            }
        }

  bubbleUp(n: number): void {
            // Look up the target element and its score.
            var length = this.content.length;
            var element = this.content[n];
            var elemScore = this.scoreFunction(element);

            while (true) {
                // Compute the indices of the child elements.
                var child2N = (n + 1) << 1;
                var child1N = child2N - 1;
                // This is used to store the new position of the element, if any.
                var swap: number | null = null;
                var child1Score: number | undefined;
                // If the first child exists (is inside the array)...
                if (child1N < length) {
                    // Look it up and compute its score.
                    var child1 = this.content[child1N];
                    child1Score = this.scoreFunction(child1);

                    // If the score is less than our element's, we need to swap.
                    if (child1Score < elemScore) {
                        swap = child1N;
                    }
                }

                // Do the same checks for the other child.
                if (child2N < length) {
                    var child2 = this.content[child2N];
                    var child2Score = this.scoreFunction(child2);
                    if (child2Score < (swap === null ? elemScore : Number(child1Score))) {
                        swap = child2N;
                    }
                }

                // If the element needs to be moved, swap it, and continue.
                if (swap !== null) {
                    this.content[n] = this.content[swap];
                    this.content[swap] = element;
                    n = swap;
                }
                // Otherwise, we are done.
                else {
                    break;
                }
            }
        }
}

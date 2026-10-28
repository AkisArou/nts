/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

// Pinned JetStream 3.0 source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/UniPoker/benchmark.js
// Revision 3967678fa8ab98d847ab33cf3728dba726fa854b. See README.md, provenance.json and ../LICENSE-jetstream.

import { Player, playHands } from "./poker.ts";
import { getPlayerExpectations } from "./expected.ts";
import { resetRandom } from "./random.ts";
export { CardDeck, Hand, Player, playHands } from "./poker.ts";
export { PlayerExpectation, getPlayerExpectations } from "./expected.ts";

"use strict";

export class Benchmark {
    declare _players: Player[];

    constructor()
    {
        this._players = [];
        this._players.push(new Player("Player 1"));
        this._players.push(new Player("Player 2"));
        this._players.push(new Player("Player 3"));
        this._players.push(new Player("Player 4"));
    }

    runIteration(): void
    {
        playHands(this._players);
    }

    validate(iterations: number): void
    {
        if (!iterations)
            throw "Invalid iterations"
        const playerExpectations = getPlayerExpectations(iterations)
        if (this._players.length != playerExpectations.length)
            throw "Expect " + playerExpectations.length + ", but actually have " + this._players.length;
        for (let playerIdx = 0; playerIdx < playerExpectations.length; playerIdx++)
            playerExpectations[playerIdx].validate(this._players[playerIdx]);
    }
}

// Each call is one independent original trial. Constructor/setup is included
// in work because player statistics evolve across iterations.
let latestBenchmark: Benchmark | undefined;
let completedIterations = 0;
let checksum = 0;
export const seed = 1;

export interface PlayerObservation {
    name: string; cards: (string | undefined)[]; rank: number; wins: number; handTypeCounts: number[];
}

function observePlayers(players: Player[]): void {
    for (const player of players) {
        checksum = (checksum * 31 + player.rank) >>> 0;
        checksum = (checksum * 31 + player.wins) >>> 0;
        for (const count of player.handTypeCounts)
            checksum = (checksum * 31 + count) >>> 0;
        for (const card of player._cards)
            checksum = (checksum * 31 + (card === undefined ? 0 : card.codePointAt(0) ?? 0)) >>> 0;
    }
}

export function work(n: number): number {
    const benchmark = new Benchmark();
    latestBenchmark = benchmark;
    completedIterations = 0;
    checksum = 0;
    for (let i = 0; i < n; ++i) {
        resetRandom();
        benchmark.runIteration();
        completedIterations++;
        observePlayers(benchmark._players);
    }
    if (completedIterations > 0)
        benchmark.validate(completedIterations);
    return checksum;
}

export function observation(): {iterations: number; players: PlayerObservation[]; checksum: number} {
    const players = latestBenchmark === undefined ? [] : latestBenchmark._players.map(player => ({name: player.name, cards: player._cards.slice(), rank: player.rank, wins: player.wins, handTypeCounts: player.handTypeCounts.slice()}));
    return {iterations: completedIterations, players, checksum};
}

export function render(n: number = 1): PlayerObservation[] {
    work(n);
    return observation().players;
}

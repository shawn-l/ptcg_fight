import { describe, expect, it } from "vitest";
import { createInitialState, getLegalActions, resolveAction } from "../src";
import { type CardDefinition, sampleCards } from "@ptcg-fight/cards";

const p1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "sv1-005",
  "sv1-006",
  "sv1-010",
  "sv1-011",
  "sv1-012",
  "sv1-013",
  "sv1-008",
  "sv1-009"
];
const p2Deck = [
  "sv1-101",
  "sv1-102",
  "sv1-103",
  "sv1-104",
  "sv1-105",
  "sv1-106",
  "sv1-107",
  "sv1-108",
  "sv1-109",
  "sv1-102",
  "sv1-106",
  "sv1-107",
  "sv1-103",
  "sv1-104"
];
const rulePokemonCards: CardDefinition[] = [
  ...sampleCards,
  {
    id: "sv1-201",
    languageRefs: { en: { name: "Koraidon ex" }, zhHans: { name: "故勒顿ex" } },
    regulationMark: "G",
    supertype: "Pokemon",
    subtypes: ["Basic", "ex"],
    hp: 230,
    types: ["Fighting"],
    retreatCost: 2,
    attacks: [{ name: "Claw Slash", cost: ["Fighting"], damage: 10 }],
    rulesText: ["Pokemon ex rule: When your Pokemon ex is Knocked Out, your opponent takes 2 Prize cards."],
    prizeCardsWhenKnockedOut: 2,
    effectRefs: []
  }
];

function setupGame() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: p1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: sampleCards,
    seed: "phase2",
    ruleset: { prizeCount: 1 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, {
      playerId,
      type: "PLACE_ACTIVE",
      payload: { cardInstanceId },
      clientActionId: `active-${playerId}`
    });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  return state;
}

function startedGame() {
  const setup = setupGame();
  const started = resolveAction(setup, {
    playerId: "p1",
    type: "START_GAME",
    payload: {},
    clientActionId: "start"
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

describe("phase 2 core rules", () => {
  it("places Basic Pokemon onto the bench and enforces bench size", () => {
    let state = setupGame();

    const legalSetupActions = getLegalActions(state, "p1").filter((action) => action.type === "PLACE_BENCH");
    expect(legalSetupActions.map((action) => action.payload?.cardInstanceId)).toContain("p1-card-2");

    const placed = resolveAction(state, {
      playerId: "p1",
      type: "PLACE_BENCH",
      payload: { cardInstanceId: "p1-card-2" },
      clientActionId: "bench"
    });

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    state = placed.state;
    expect(state.players.p1.bench).toHaveLength(1);
    expect(state.players.p1.bench[0].cardInstanceId).toBe("p1-card-2");

    for (const cardInstanceId of ["p1-card-6", "p1-card-8", "p1-card-9", "p1-card-10"]) {
      state.players.p1.hand.push(cardInstanceId);
      const result = resolveAction(state, {
        playerId: "p1",
        type: "PLACE_BENCH",
        payload: { cardInstanceId },
        clientActionId: `bench-${cardInstanceId}`
      });
      if (result.ok) state = result.state;
    }

    expect(state.players.p1.bench).toHaveLength(state.ruleset.maxBenchSize);
    state.players.p1.hand.push("p1-card-8");
    const overflow = resolveAction(state, {
      playerId: "p1",
      type: "PLACE_BENCH",
      payload: { cardInstanceId: "p1-card-7" },
      clientActionId: "bench-overflow"
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.code).toBe("BENCH_FULL");
  });

  it("retreats active Pokemon once per turn by discarding enough attached energy", () => {
    let state = startedGame();
    const benched = resolveAction(state, {
      playerId: "p1",
      type: "PLACE_BENCH",
      payload: { cardInstanceId: "p1-card-2" },
      clientActionId: "bench"
    });
    if (!benched.ok) throw new Error(benched.error.message);
    state = benched.state;
    const attached = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-3", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach"
    });
    if (!attached.ok) throw new Error(attached.error.message);
    state = attached.state;

    const retreated = resolveAction(state, {
      playerId: "p1",
      type: "RETREAT",
      payload: { benchIndex: 0, energyCardInstanceIds: ["p1-card-3"] },
      clientActionId: "retreat"
    });

    expect(retreated.ok).toBe(true);
    if (!retreated.ok) return;
    state = retreated.state;
    expect(state.players.p1.active?.cardInstanceId).toBe("p1-card-2");
    expect(state.players.p1.bench[0].cardInstanceId).toBe("p1-card-1");
    expect(state.players.p1.discard).toContain("p1-card-3");

    const secondRetreat = resolveAction(state, {
      playerId: "p1",
      type: "RETREAT",
      payload: { benchIndex: 0, energyCardInstanceIds: [] },
      clientActionId: "retreat-again"
    });
    expect(secondRetreat.ok).toBe(false);
    if (!secondRetreat.ok) expect(secondRetreat.error.code).toBe("RETREAT_ALREADY_USED");
  });

  it("evolves a Pokemon only after it has been in play since a previous turn", () => {
    let state = startedGame();

    const tooSoon = resolveAction(state, {
      playerId: "p1",
      type: "EVOLVE",
      payload: { evolutionCardInstanceId: "p1-card-7", target: { playerId: "p1", zone: "active" } },
      clientActionId: "too-soon"
    });
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error.code).toBe("CANNOT_EVOLVE_THIS_TURN");

    const passed1 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-1" });
    if (!passed1.ok) throw new Error(passed1.error.message);
    const passed2 = resolveAction(passed1.state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "pass-2" });
    if (!passed2.ok) throw new Error(passed2.error.message);
    state = passed2.state;

    const evolved = resolveAction(state, {
      playerId: "p1",
      type: "EVOLVE",
      payload: { evolutionCardInstanceId: "p1-card-7", target: { playerId: "p1", zone: "active" } },
      clientActionId: "evolve"
    });

    expect(evolved.ok).toBe(true);
    if (!evolved.ok) return;
    expect(evolved.state.players.p1.active?.cardInstanceId).toBe("p1-card-7");
    expect(evolved.state.players.p1.active?.evolution).toEqual(["p1-card-1"]);
  });

  it("takes a prize after knocking out an opponent and wins when no prizes remain", () => {
    let state = startedGame();
    const passed = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass" });
    if (!passed.ok) throw new Error(passed.error.message);
    state = passed.state;
    const attached = resolveAction(state, {
      playerId: "p2",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p2-card-3", target: { playerId: "p2", zone: "active" } },
      clientActionId: "attach"
    });
    if (!attached.ok) throw new Error(attached.error.message);
    state = attached.state;
    state.players.p1.active!.damage = 60;

    const knockout = resolveAction(state, {
      playerId: "p2",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "ko"
    });

    expect(knockout.ok).toBe(true);
    if (!knockout.ok) return;
    expect(knockout.events.map((event) => event.type)).toContain("PRIZE_TAKEN");
    expect(knockout.events.map((event) => event.type)).toContain("GAME_OVER");
    expect(knockout.state.winner).toBe("p2");
    expect(knockout.state.phase).toBe("game-over");
  });

  it("takes extra prize cards when a rule box Pokemon is knocked out", () => {
    let state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck: p1Deck },
        { id: "p2", name: "Player 2", deck: ["sv1-201", ...p2Deck] }
      ],
      cards: rulePokemonCards,
      seed: "rule-pokemon-prizes",
      ruleset: { prizeCount: 3 }
    });

    for (const [playerId, cardInstanceId] of [
      ["p1", "p1-card-1"],
      ["p2", "p2-card-1"]
    ] as const) {
      const placed = resolveAction(state, {
        playerId,
        type: "PLACE_ACTIVE",
        payload: { cardInstanceId },
        clientActionId: `active-${playerId}`
      });
      if (!placed.ok) throw new Error(placed.error.message);
      state = placed.state;
    }
    const benched = resolveAction(state, {
      playerId: "p2",
      type: "PLACE_BENCH",
      payload: { cardInstanceId: "p2-card-2" },
      clientActionId: "bench-p2"
    });
    if (!benched.ok) throw new Error(benched.error.message);
    state = benched.state;
    const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
    if (!started.ok) throw new Error(started.error.message);
    state = started.state;
    const passed1 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-1" });
    if (!passed1.ok) throw new Error(passed1.error.message);
    const passed2 = resolveAction(passed1.state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "pass-2" });
    if (!passed2.ok) throw new Error(passed2.error.message);
    state = passed2.state;
    const attached = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-3", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach"
    });
    if (!attached.ok) throw new Error(attached.error.message);
    state = attached.state;
    state.players.p2.active!.damage = 220;

    const knockout = resolveAction(state, {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "ko-ex"
    });

    expect(knockout.ok).toBe(true);
    if (!knockout.ok) return;
    const prizeEvent = knockout.events.find((event) => event.type === "PRIZE_TAKEN");
    expect(prizeEvent?.payload).toMatchObject({ playerId: "p1", takenCount: 2, remainingPrizes: 1 });
    expect(knockout.state.players.p1.prizes).toHaveLength(1);
    expect(knockout.state.winner).toBeUndefined();
  });
});

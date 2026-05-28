import { describe, expect, it } from "vitest";
import { type CardDefinition, sampleCards } from "@ptcg-fight/cards";
import { createInitialState, getLegalActions, resolveAction, type GameState } from "../src";

const phase3Cards: CardDefinition[] = sampleCards.map((card) => {
  if (card.id === "sv1-001") {
    return {
      ...card,
      weakness: { type: "Fire", multiplier: 2 },
      resistance: { type: "Lightning", reduction: 30 },
      attacks: [{ name: "Leafage", cost: ["Grass"], damage: 20 }]
    };
  }
  if (card.id === "sv1-101") {
    return {
      ...card,
      attacks: [{ name: "Ember", cost: ["Fire"], damage: 20 }]
    };
  }
  if (card.id === "sv1-106") {
    return {
      ...card,
      types: ["Lightning"],
      attacks: [{ name: "Spark", cost: ["Lightning"], damage: 40 }]
    };
  }
  return card;
});

const p1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "sv1-005",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009",
  "sv1-011",
  "sv1-012",
  "sv1-013",
  "sv1-003",
  "sv1-004"
];
const p2Deck = [
  "sv1-101",
  "sv1-102",
  "sv1-103",
  "sv1-009",
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

function setupGame(options: { p1Deck?: string[]; p2Deck?: string[]; cards?: CardDefinition[] } = {}): GameState {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: options.p1Deck ?? p1Deck },
      { id: "p2", name: "Player 2", deck: options.p2Deck ?? p2Deck }
    ],
    cards: options.cards ?? phase3Cards,
    seed: "phase3",
    ruleset: { prizeCount: 2 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const result = resolveAction(state, {
      playerId,
      type: "PLACE_ACTIVE",
      payload: { cardInstanceId },
      clientActionId: `active-${playerId}`
    });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

describe("phase 3 complete battle rules", () => {
  it("requires enough attached Energy to attack", () => {
    let state = setupGame();
    const pass1 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-1" });
    if (!pass1.ok) throw new Error(pass1.error.message);
    const pass2 = resolveAction(pass1.state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "pass-2" });
    if (!pass2.ok) throw new Error(pass2.error.message);
    state = pass2.state;

    expect(getLegalActions(state, "p1").map((action) => action.type)).not.toContain("ATTACK");

    const result = resolveAction(state, {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "attack-without-energy"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_ENOUGH_ENERGY_TO_ATTACK");
  });

  it("applies weakness and resistance to Active Pokemon damage", () => {
    let state = setupGame();
    const pass1 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-1" });
    if (!pass1.ok) throw new Error(pass1.error.message);
    state = pass1.state;

    const attachFire = resolveAction(state, {
      playerId: "p2",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p2-card-3", target: { playerId: "p2", zone: "active" } },
      clientActionId: "attach-fire"
    });
    if (!attachFire.ok) throw new Error(attachFire.error.message);
    state = attachFire.state;

    const fireAttack = resolveAction(state, {
      playerId: "p2",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "fire-attack"
    });
    expect(fireAttack.ok).toBe(true);
    if (!fireAttack.ok) return;
    expect(fireAttack.state.players.p1.active?.damage).toBe(40);
    expect(fireAttack.events.find((event) => event.type === "DAMAGE_PLACED")?.payload).toMatchObject({
      baseDamage: 20,
      weaknessApplied: true,
      resistanceApplied: false,
      totalDamage: 40
    });

    state = fireAttack.state;
    const attachGrass = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-3", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach-grass"
    });
    if (!attachGrass.ok) throw new Error(attachGrass.error.message);
    state = attachGrass.state;

    const pass2 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-2" });
    if (!pass2.ok) throw new Error(pass2.error.message);
    state = pass2.state;

    const attachLightning = resolveAction(state, {
      playerId: "p2",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p2-card-4", target: { playerId: "p2", zone: "active" } },
      clientActionId: "attach-lightning"
    });
    if (!attachLightning.ok) throw new Error(attachLightning.error.message);
    state = attachLightning.state;
    state.players.p2.active!.cardInstanceId = "p2-card-6";

    const lightningAttack = resolveAction(state, {
      playerId: "p2",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "lightning-attack"
    });
    expect(lightningAttack.ok).toBe(true);
    if (!lightningAttack.ok) return;
    expect(lightningAttack.events.find((event) => event.type === "DAMAGE_PLACED")?.payload).toMatchObject({
      baseDamage: 40,
      weaknessApplied: false,
      resistanceApplied: true,
      amount: 10
    });
  });

  it("requires the knocked-out player to promote a benched Pokemon before taking other actions", () => {
    let state = setupGame();
    const passToP2 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-to-p2" });
    if (!passToP2.ok) throw new Error(passToP2.error.message);
    state = passToP2.state;
    const bench = resolveAction(state, {
      playerId: "p2",
      type: "PLACE_BENCH",
      payload: { cardInstanceId: "p2-card-2" },
      clientActionId: "bench"
    });
    if (!bench.ok) throw new Error(bench.error.message);
    state = bench.state;
    const pass1 = resolveAction(state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "pass-1" });
    if (!pass1.ok) throw new Error(pass1.error.message);
    state = pass1.state;
    const attach = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-3", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach"
    });
    if (!attach.ok) throw new Error(attach.error.message);
    state = attach.state;
    state.players.p2.active!.damage = 60;

    const knockout = resolveAction(state, { playerId: "p1", type: "ATTACK", payload: { attackIndex: 0 }, clientActionId: "ko" });
    expect(knockout.ok).toBe(true);
    if (!knockout.ok) return;
    state = knockout.state;
    expect(state.pendingPromotionPlayerId).toBe("p2");
    expect(getLegalActions(state, "p2")).toEqual([{ type: "PROMOTE_ACTIVE", payload: { benchIndex: 0 } }]);

    const blocked = resolveAction(state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "blocked" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("PROMOTION_REQUIRED");

    const promoted = resolveAction(state, {
      playerId: "p2",
      type: "PROMOTE_ACTIVE",
      payload: { benchIndex: 0 },
      clientActionId: "promote"
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.state.pendingPromotionPlayerId).toBeUndefined();
    expect(promoted.state.players.p2.active?.cardInstanceId).toBe("p2-card-2");
  });

  it("wins when the opponent has no Pokemon left in play", () => {
    let state = setupGame();
    const pass1 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass-1" });
    if (!pass1.ok) throw new Error(pass1.error.message);
    const pass2 = resolveAction(pass1.state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "pass-2" });
    if (!pass2.ok) throw new Error(pass2.error.message);
    state = pass2.state;
    const attach = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-3", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach"
    });
    if (!attach.ok) throw new Error(attach.error.message);
    state = attach.state;
    state.players.p2.active!.damage = 60;

    const result = resolveAction(state, { playerId: "p1", type: "ATTACK", payload: { attackIndex: 0 }, clientActionId: "ko" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("game-over");
    expect(result.state.winner).toBe("p1");
    expect(result.events.find((event) => event.type === "GAME_OVER")?.payload).toMatchObject({
      winner: "p1",
      reason: "NO_POKEMON_IN_PLAY"
    });
  });

  it("loses when a player cannot draw a card at the start of turn", () => {
    let state = setupGame();
    state.players.p2.deck = [];

    const result = resolveAction(state, {
      playerId: "p1",
      type: "PASS_TURN",
      payload: {},
      clientActionId: "deck-out"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("game-over");
    expect(result.state.winner).toBe("p1");
    expect(result.events.find((event) => event.type === "GAME_OVER")?.payload).toMatchObject({
      winner: "p1",
      reason: "CANNOT_DRAW_AT_START_OF_TURN"
    });
  });
});

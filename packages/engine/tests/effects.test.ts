import { describe, expect, it } from "vitest";
import { createInitialState, getLegalActions, resolveAction } from "../src";
import { sampleCards } from "@ptcg-fight/cards";

const p1Deck = ["sv1-001", "sv1-002", "sv1-003", "sv1-004", "sv1-005", "sv1-006", "sv1-007", "sv1-008", "sv1-009"];
const p2Deck = ["sv1-101", "sv1-102", "sv1-103", "sv1-104", "sv1-105", "sv1-106", "sv1-107", "sv1-108", "sv1-109"];
const firstTurnSupporterDeck = ["sv1-001", "sv1-008", "sv1-005", "sv1-003", "sv1-004", "sv1-006", "sv1-007", "sv1-002", "sv1-009"];

function startedGame() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: p1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: sampleCards,
    seed: "effects"
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, {
      playerId,
      type: "PLACE_ACTIVE",
      payload: { cardInstanceId },
      clientActionId: `place-${playerId}`
    });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, {
    playerId: "p1",
    type: "START_GAME",
    payload: {},
    clientActionId: "start"
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

function startedGameWithSupporterInOpeningHand() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: firstTurnSupporterDeck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: sampleCards,
    seed: "supporter"
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, {
      playerId,
      type: "PLACE_ACTIVE",
      payload: { cardInstanceId },
      clientActionId: `place-${playerId}`
    });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, {
    playerId: "p1",
    type: "START_GAME",
    payload: {},
    clientActionId: "start"
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

describe("effect resolution", () => {
  it("does not allow the starting player to attack on the first turn", () => {
    const state = startedGame();

    expect(getLegalActions(state, "p1").map((action) => action.type)).not.toContain("ATTACK");

    const result = resolveAction(state, {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "first-turn-attack"
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FIRST_TURN_ATTACK_NOT_ALLOWED");
  });

  it("does not allow the starting player to play a Supporter on the first turn", () => {
    const state = startedGameWithSupporterInOpeningHand();

    const legalSupporterAction = getLegalActions(state, "p1").find(
      (action) => action.type === "PLAY_TRAINER" && action.payload?.cardInstanceId === "p1-card-2"
    );
    expect(legalSupporterAction).toBeUndefined();

    const result = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-2" },
      clientActionId: "first-turn-supporter"
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FIRST_TURN_SUPPORTER_NOT_ALLOWED");
  });

  it("resolves a declared trainer draw effect through the event log", () => {
    const state = startedGame();
    const beforeHandSize = state.players.p1.hand.length;

    const result = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-5" },
      clientActionId: "trainer"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.discard).toContain("p1-card-5");
    expect(result.state.players.p1.hand.length).toBe(beforeHandSize);
    expect(result.events.map((event) => event.type)).toEqual(["TRAINER_PLAYED", "CARD_DRAWN"]);
  });

  it("allows the second player to attack on their first turn", () => {
    const state = startedGame();
    const passed = resolveAction(state, {
      playerId: "p1",
      type: "PASS_TURN",
      payload: {},
      clientActionId: "pass"
    });
    if (!passed.ok) throw new Error(passed.error.message);

    const attached = resolveAction(passed.state, {
      playerId: "p2",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p2-card-3", target: { playerId: "p2", zone: "active" } },
      clientActionId: "attach"
    });
    if (!attached.ok) throw new Error(attached.error.message);

    const result = resolveAction(attached.state, {
      playerId: "p2",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "attack"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.active?.damage).toBe(10);
    expect(result.state.turn.playerId).toBe("p1");
    expect(result.events.map((event) => event.type)).toEqual(["DAMAGE_PLACED", "TURN_PASSED", "CARD_DRAWN"]);
  });
});

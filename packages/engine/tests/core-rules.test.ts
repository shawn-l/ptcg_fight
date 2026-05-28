import { describe, expect, it } from "vitest";
import {
  createInitialState,
  getLegalActions,
  resolveAction,
  serializePublicState
} from "../src";
import { sampleCards } from "@ptcg-fight/cards";

const p1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "sv1-005",
  "sv1-006",
  "sv1-007",
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
  "sv1-109"
];

const noBasicFirstHandDeck = [
  "sv1-003",
  "sv1-004",
  "sv1-005",
  "sv1-008",
  "sv1-009",
  "sv1-003",
  "sv1-004",
  "sv1-001",
  "sv1-002",
  "sv1-006",
  "sv1-007",
  "sv1-001",
  "sv1-002",
  "sv1-006",
  "sv1-007",
  "sv1-001"
];

describe("core PTCG rules", () => {
  it("creates a serializable setup state with hidden private zones", () => {
    const state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck: p1Deck },
        { id: "p2", name: "Player 2", deck: p2Deck }
      ],
      cards: sampleCards,
      seed: "test-seed"
    });

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.phase).toBe("setup");
    expect(state.players.p1.hand).toHaveLength(7);
    expect(state.players.p1.prizes).toHaveLength(0);
    expect(serializePublicState(state, "p2").players.p1.hand).toEqual({ count: 7 });
  });

  it("automatically mulligans opening hands with no Basic Pokemon and lets the opponent draw bonus cards", () => {
    let state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck: noBasicFirstHandDeck },
        { id: "p2", name: "Player 2", deck: p2Deck }
      ],
      cards: sampleCards,
      seed: "mulligan-test"
    });

    expect(state.players.p1.mulligansTaken).toBeGreaterThanOrEqual(1);
    expect(state.players.p1.hand.some((cardInstanceId) => state.cards[state.instances[cardInstanceId].cardId].subtypes.includes("Basic"))).toBe(true);
    expect(state.players.p2.pendingMulliganDraws).toBe(state.players.p1.mulligansTaken);
    expect(getLegalActions(state, "p2").map((action) => action.type)).toContain("TAKE_MULLIGAN_DRAWS");

    const p2HandSize = state.players.p2.hand.length;
    const bonusDraw = resolveAction(state, {
      playerId: "p2",
      type: "TAKE_MULLIGAN_DRAWS",
      payload: { count: state.players.p2.pendingMulliganDraws },
      clientActionId: "bonus-draw"
    });

    expect(bonusDraw.ok).toBe(true);
    if (!bonusDraw.ok) return;
    state = bonusDraw.state;
    expect(state.players.p2.pendingMulliganDraws).toBe(0);
    expect(state.players.p2.hand.length).toBe(p2HandSize + state.players.p1.mulligansTaken);
    expect(bonusDraw.events.map((event) => event.type)).toContain("MULLIGAN_CARDS_DRAWN");
  });

  it("only allows basic Pokemon to be placed into active during setup", () => {
    let state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck: p1Deck },
        { id: "p2", name: "Player 2", deck: p2Deck }
      ],
      cards: sampleCards,
      seed: "test-seed"
    });

    expect(getLegalActions(state, "p1").map((action) => action.type)).toContain("PLACE_ACTIVE");

    const result = resolveAction(state, {
      playerId: "p1",
      type: "PLACE_ACTIVE",
      payload: { cardInstanceId: "p1-card-1" },
      clientActionId: "a1"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(state.players.p1.active?.cardInstanceId).toBe("p1-card-1");
    expect(result.events.map((event) => event.type)).toContain("CARD_MOVED");

    const illegal = resolveAction(state, {
      playerId: "p1",
      type: "PLACE_ACTIVE",
      payload: { cardInstanceId: "p1-card-3" },
      clientActionId: "a2"
    });
    expect(illegal.ok).toBe(false);
    if (illegal.ok) return;
    expect(illegal.error.code).toBe("ACTIVE_ALREADY_SET");
  });

  it("starts the game only after both players have active Pokemon and then enforces turn actions", () => {
    let state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck: p1Deck },
        { id: "p2", name: "Player 2", deck: p2Deck }
      ],
      cards: sampleCards,
      seed: "test-seed"
    });

    const startedTooEarly = resolveAction(state, {
      playerId: "p1",
      type: "START_GAME",
      payload: {},
      clientActionId: "start-early"
    });
    expect(startedTooEarly.ok).toBe(false);

    for (const action of [
      { playerId: "p1", cardInstanceId: "p1-card-1" },
      { playerId: "p2", cardInstanceId: "p2-card-1" }
    ] as const) {
      const placed = resolveAction(state, {
        playerId: action.playerId,
        type: "PLACE_ACTIVE",
        payload: { cardInstanceId: action.cardInstanceId },
        clientActionId: `place-${action.playerId}`
      });
      expect(placed.ok).toBe(true);
      if (placed.ok) state = placed.state;
    }

    const started = resolveAction(state, {
      playerId: "p1",
      type: "START_GAME",
      payload: {},
      clientActionId: "start"
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    state = started.state;
    expect(state.phase).toBe("main");
    expect(state.players.p1.prizes).toHaveLength(1);
    expect(state.players.p2.prizes).toHaveLength(1);

    const wrongPlayer = resolveAction(state, {
      playerId: "p2",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p2-card-2", target: { playerId: "p2", zone: "active" } },
      clientActionId: "wrong-player"
    });
    expect(wrongPlayer.ok).toBe(false);
    if (!wrongPlayer.ok) expect(wrongPlayer.error.code).toBe("NOT_YOUR_TURN");

    const attach = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-3", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach"
    });
    expect(attach.ok).toBe(true);
    if (!attach.ok) return;
    state = attach.state;
    expect(state.players.p1.active?.attachedEnergy).toEqual(["p1-card-3"]);

    const secondAttach = resolveAction(state, {
      playerId: "p1",
      type: "ATTACH_ENERGY",
      payload: { cardInstanceId: "p1-card-4", target: { playerId: "p1", zone: "active" } },
      clientActionId: "attach-2"
    });
    expect(secondAttach.ok).toBe(false);
    if (!secondAttach.ok) expect(secondAttach.error.code).toBe("ENERGY_ALREADY_ATTACHED");
  });
});

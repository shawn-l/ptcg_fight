import { describe, expect, it } from "vitest";
import { type CardDefinition, sampleCards } from "@ptcg-fight/cards";
import { createInitialState, getLegalActions, resolveAction } from "../src";

const choiceTrainer: CardDefinition = {
  id: "test-choice-trainer",
  languageRefs: {
    en: { name: "Choice Drill", rulesText: "Discard 1 card from your hand. If you do, draw 2 cards." },
    zhHans: { name: "选择训练", rulesText: "从手牌丢弃1张卡。若如此，抽2张卡。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["Discard 1 card from your hand. If you do, draw 2 cards."],
  effectRefs: ["trainer.discard.1.draw.2"]
};

const searchTrainer: CardDefinition = {
  id: "test-search-trainer",
  languageRefs: {
    en: { name: "Nest Search", rulesText: "Search your deck for a Basic Pokemon, reveal it, and put it into your hand. Then shuffle your deck." },
    zhHans: { name: "巢穴检索", rulesText: "从牌库选择1张基础宝可梦，展示后加入手牌。然后洗牌。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["Search your deck for a Basic Pokemon, reveal it, and put it into your hand. Then shuffle your deck."],
  effectRefs: ["trainer.search.basic.1.to-hand"]
};

const cards = [...sampleCards, choiceTrainer, searchTrainer];

const p1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "test-choice-trainer",
  "test-search-trainer",
  "sv1-007",
  "sv1-008",
  "sv1-009",
  "sv1-011",
  "sv1-012",
  "sv1-013"
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
  "sv1-107"
];

function startedGame() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: p1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards,
    seed: "phase4-choice",
    ruleset: { prizeCount: 2 }
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

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

describe("phase 4 choice system", () => {
  it("creates a pending choice and blocks non-choice actions until it is resolved", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-5" },
      clientActionId: "choice-trainer"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice).toMatchObject({
      playerId: "p1",
      kind: "DISCARD_FROM_HAND",
      minSelections: 1,
      maxSelections: 1
    });
    expect(played.state.pendingChoice?.options.map((option) => option.id)).toContain("p1-card-2");
    expect(played.state.pendingChoice?.options.map((option) => option.id)).not.toContain("p1-card-5");
    expect(played.events.map((event) => event.type)).toEqual(["TRAINER_PLAYED", "CHOICE_REQUESTED"]);
    expect(getLegalActions(played.state, "p1")).toEqual([
      { type: "RESOLVE_CHOICE", payload: { choiceId: played.state.pendingChoice?.id } }
    ]);

    const blocked = resolveAction(played.state, {
      playerId: "p1",
      type: "PASS_TURN",
      payload: {},
      clientActionId: "blocked"
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("CHOICE_REQUIRED");
  });

  it("rejects invalid choice selections and resolves valid selections into effects", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-5" },
      clientActionId: "choice-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");

    const invalid = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2-card-1"] },
      clientActionId: "invalid-choice"
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_CHOICE_SELECTION");

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p1-card-2"] },
      clientActionId: "resolve-choice"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.state.players.p1.discard).toEqual(expect.arrayContaining(["p1-card-5", "p1-card-2"]));
    expect(resolved.state.players.p1.hand).not.toContain("p1-card-2");
    expect(resolved.state.players.p1.hand).toHaveLength(6);
    expect(resolved.events.map((event) => event.type)).toEqual(["CHOICE_RESOLVED", "CARD_DRAWN", "CARD_DRAWN"]);
  });

  it("searches the deck through a pending choice and moves the selected card to hand", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice).toMatchObject({
      playerId: "p1",
      kind: "SEARCH_DECK",
      minSelections: 1,
      maxSelections: 1
    });
    expect(played.state.pendingChoice?.options.map((option) => option.id)).toEqual(
      expect.arrayContaining(["p1-card-10", "p1-card-11", "p1-card-12"])
    );
    expect(played.state.pendingChoice?.options.map((option) => option.id)).not.toContain("p1-card-8");

    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p1-card-10"] },
      clientActionId: "resolve-search"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.state.players.p1.hand).toContain("p1-card-10");
    expect(resolved.state.players.p1.deck).not.toContain("p1-card-10");
    expect(resolved.events.map((event) => event.type)).toEqual(["CHOICE_RESOLVED", "CARD_MOVED", "DECK_SHUFFLED"]);
    expect(resolved.events.find((event) => event.type === "CARD_MOVED")?.payload).toMatchObject({
      playerId: "p1",
      cardInstanceId: "p1-card-10",
      from: "deck",
      to: "hand"
    });
  });
});

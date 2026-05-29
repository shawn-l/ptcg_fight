import { describe, expect, it } from "vitest";
import { type CardDefinition, sampleCards } from "@ptcg-fight/cards";
import { createInitialState, getLegalActions, resolveAction, serializePublicState } from "../src";

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

const singleBasicP1Deck = [
  "sv1-001",
  "sv1-010",
  "sv1-003",
  "sv1-005",
  "sv1-008",
  "test-search-trainer",
  "sv1-004",
  "sv1-009",
  "sv1-003",
  "sv1-005",
  "sv1-008",
  "sv1-004"
];

function startedGameSingleBasic() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: singleBasicP1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards,
    seed: "phase4-single-basic",
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

function findInHand(state: { players: Record<string, { hand: string[] }>; instances: Record<string, { cardId: string }> }, playerId: string, cardDefId: string): string | undefined {
  return state.players[playerId]?.hand.find(
    (instanceId: string) => state.instances[instanceId]?.cardId === cardDefId
  );
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

  it("creates a choice with 0 selections when no cards match the search filter", () => {
    const state = startedGameSingleBasic();
    const searchInstanceId = findInHand(state, "p1", "test-search-trainer");
    if (!searchInstanceId) throw new Error("test-search-trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: searchInstanceId },
      clientActionId: "search-trainer-no-match"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice).toMatchObject({
      playerId: "p1",
      kind: "SEARCH_DECK",
      minSelections: 0,
      maxSelections: 0
    });
    expect(played.state.pendingChoice?.options).toHaveLength(0);

    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [] },
      clientActionId: "resolve-empty-search"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.events.map((event) => event.type)).toEqual(["CHOICE_RESOLVED", "DECK_SHUFFLED"]);
    const cardMovedEvents = resolved.events.filter((event) => event.type === "CARD_MOVED");
    expect(cardMovedEvents).toHaveLength(0);
  });

  it("rejects a selection containing an option not in the choice", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");

    const invalid = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2-card-1"] },
      clientActionId: "invalid-search-choice"
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_CHOICE_SELECTION");
  });

  it("rejects a selection when the card was removed from the deck after choice creation", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const targetCardId = played.state.pendingChoice?.options[0]?.cardInstanceId;
    if (!targetCardId) throw new Error("expected at least one option");

    // Remove the card from the deck before resolving
    const mutated = played.state;
    mutated.players.p1.deck = mutated.players.p1.deck.filter((c) => c !== targetCardId);

    const result = resolveAction(mutated, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [targetCardId] },
      clientActionId: "resolve-gone-card"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_CHOICE_SELECTION");
      expect(result.error.message).toMatch(/no longer in deck/i);
    }
  });

  it("rejects selecting more options than maxSelections", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const optionIds = played.state.pendingChoice?.options.map((o) => o.id) ?? [];
    if (optionIds.length < 2) throw new Error("expected at least 2 options");

    const result = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [optionIds[0], optionIds[1]] },
      clientActionId: "too-many-selections"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CHOICE_SELECTION");
  });

  it("rejects a choice resolution with the wrong choiceId", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);

    const result = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId: "wrong-choice-id", selectedOptionIds: [] },
      clientActionId: "wrong-choice"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CHOICE_MISMATCH");
  });

  it("emits DECK_SHUFFLED with public visibility and keeps deck contents hidden from the opponent", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const targetCardId = played.state.pendingChoice?.options[0]?.cardInstanceId;
    if (!targetCardId) throw new Error("expected at least one option");

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [targetCardId] },
      clientActionId: "resolve-visibility-test"
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const shuffledEvent = resolved.events.find((event) => event.type === "DECK_SHUFFLED");
    expect(shuffledEvent?.visibility).toBe("public");

    const movedEvent = resolved.events.find((event) => event.type === "CARD_MOVED");
    expect(movedEvent?.visibility).toEqual({ playerId: "p1" });

    const publicStateP2 = serializePublicState(resolved.state, "p2");
    expect(publicStateP2.players.p1.deck).toEqual({ count: resolved.state.players.p1.deck.length });
    expect(publicStateP2.players.p1.hand).toEqual({ count: resolved.state.players.p1.hand.length });

    // Positive-direction: viewer sees own private zones as arrays
    const publicStateP1 = serializePublicState(resolved.state, "p1");
    expect(Array.isArray(publicStateP1.players.p1.hand)).toBe(true);
    expect(Array.isArray(publicStateP1.players.p1.deck)).toBe(true);
    expect(Array.isArray(publicStateP1.players.p1.prizes)).toBe(true);

    // Both-players combined: one call shows p1 full + p2 hidden
    expect(Array.isArray(publicStateP1.players.p1.hand)).toBe(true);
    expect(publicStateP1.players.p2.hand).toEqual({ count: resolved.state.players.p2.hand.length });
    expect(publicStateP1.players.p2.deck).toEqual({ count: resolved.state.players.p2.deck.length });

    // Private events are not public
    const choiceResolvedEvent = resolved.events.find((event) => event.type === "CHOICE_RESOLVED");
    expect(choiceResolvedEvent?.visibility).toEqual({ playerId: "p1" });

    const allPublicEvents = resolved.events.filter((event) => event.visibility === "public");
    const publicEventTypes = allPublicEvents.map((event) => event.type);
    expect(publicEventTypes).toContain("DECK_SHUFFLED");
    expect(publicEventTypes).not.toContain("CHOICE_RESOLVED");
    expect(publicEventTypes).not.toContain("CARD_MOVED");
  });

  it("keeps private choice events visible only to the owning player", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);

    const choiceRequested = played.events.find((event) => event.type === "CHOICE_REQUESTED");
    expect(choiceRequested?.visibility).toEqual({ playerId: "p1" });

    // CHOICE_REQUESTED payload does not leak deck card IDs
    const payload = choiceRequested?.payload as Record<string, unknown> | undefined;
    expect(payload?.choiceId).toBeTruthy();
    expect(payload?.kind).toBe("SEARCH_DECK");
    // Payload should only contain metadata, not card IDs
    expect(payload).not.toHaveProperty("cardInstanceIds");
    expect(payload).not.toHaveProperty("options");
  });

  it("emits CHOICE_REQUESTED with the correct metadata", () => {
    const played = resolveAction(startedGame(), {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: "p1-card-6" },
      clientActionId: "search-trainer"
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    const event = played.events.find((e) => e.type === "CHOICE_REQUESTED");
    expect(event).toBeDefined();
    expect(event?.payload).toMatchObject({
      choiceId: expect.any(String),
      playerId: "p1",
      kind: "SEARCH_DECK",
      minSelections: expect.any(Number),
      maxSelections: expect.any(Number)
    });
    expect(event?.payload.choiceId).toBeTruthy();
    expect(event?.sourceActionId).toBe("search-trainer");
  });
});

const sniperPokemon: CardDefinition = {
  id: "test-sniper",
  languageRefs: {
    en: { name: "Test Sniper", rulesText: "Choose 1 of your opponent's Benched Pokemon. This attack does 30 damage to it." },
    zhHans: { name: "测试狙击手", rulesText: "选择对手备战区的1只宝可梦，造成30点伤害。" }
  },
  regulationMark: "G",
  supertype: "Pokemon",
  subtypes: ["Basic"],
  hp: 80,
  types: ["Colorless"],
  retreatCost: 1,
  attacks: [
    {
      name: "Snipe Shot",
      cost: ["Colorless"],
      text: "Choose 1 of your opponent's Benched Pokemon. This attack does 30 damage to it.",
      effectRef: "attack.snipe.bench.30"
    }
  ],
  rulesText: ["Choose 1 of your opponent's Benched Pokemon. This attack does 30 damage to it."],
  effectRefs: ["attack.snipe.bench.30"]
};

const snipeP1Deck = [
  "test-sniper",
  "sv1-010",
  "sv1-003",
  "sv1-004",
  "sv1-005",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009"
];

const snipeP2Deck = [
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

const snipeCards = [...sampleCards, sniperPokemon];

function findCardInHand(state: ReturnType<typeof createInitialState>, playerId: string, cardDefId: string): string | undefined {
  return state.players[playerId]?.hand.find(
    (id: string) => state.instances[id]?.cardId === cardDefId
  );
}

function startedGameWithSniper() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: snipeP1Deck },
      { id: "p2", name: "Player 2", deck: snipeP2Deck }
    ],
    cards: snipeCards,
    seed: "phase4-snipe",
    ruleset: { prizeCount: 1 }
  });

  const sniperId = findCardInHand(state, "p1", "test-sniper");
  if (!sniperId) throw new Error("test-sniper not in opening hand");

  const placed1 = resolveAction(state, { playerId: "p1", type: "PLACE_ACTIVE", payload: { cardInstanceId: sniperId }, clientActionId: "a1" });
  if (!placed1.ok) throw new Error(placed1.error.message);
  state = placed1.state;

  const placed2 = resolveAction(state, { playerId: "p2", type: "PLACE_ACTIVE", payload: { cardInstanceId: "p2-card-1" }, clientActionId: "a2" });
  if (!placed2.ok) throw new Error(placed2.error.message);
  state = placed2.state;

  // Bench p2-card-2 (sv1-102 Tarountula, 50 HP) as snipe target
  const benched = resolveAction(state, { playerId: "p2", type: "PLACE_BENCH", payload: { cardInstanceId: "p2-card-2" }, clientActionId: "bench-p2" });
  if (!benched.ok) throw new Error(benched.error.message);
  state = benched.state;

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  state = started.state;

  // p1 turn 1: can't attack, PASS
  const pass1 = resolveAction(state, { playerId: "p1", type: "PASS_TURN", payload: {}, clientActionId: "pass1" });
  if (!pass1.ok) throw new Error(pass1.error.message);
  state = pass1.state;

  // p2 turn: attach energy, PASS
  const p2Energy = findCardInHand(state, "p2", "sv1-103");
  if (!p2Energy) throw new Error("p2 energy not found");
  const attachP2 = resolveAction(state, { playerId: "p2", type: "ATTACH_ENERGY", payload: { cardInstanceId: p2Energy, target: { playerId: "p2", zone: "active" } }, clientActionId: "a3" });
  if (!attachP2.ok) throw new Error(attachP2.error.message);
  state = attachP2.state;

  const pass2 = resolveAction(state, { playerId: "p2", type: "PASS_TURN", payload: {}, clientActionId: "pass2" });
  if (!pass2.ok) throw new Error(pass2.error.message);
  state = pass2.state;

  // p1 turn 2: attach energy to active, ready to attack
  const p1Energy = findCardInHand(state, "p1", "sv1-003");
  if (!p1Energy) throw new Error("p1 energy not found");
  const attachP1 = resolveAction(state, { playerId: "p1", type: "ATTACH_ENERGY", payload: { cardInstanceId: p1Energy, target: { playerId: "p1", zone: "active" } }, clientActionId: "a4" });
  if (!attachP1.ok) throw new Error(attachP1.error.message);
  return attachP1.state;
}

describe("SELECT_POKEMON choice type", () => {
  it("creates a SELECT_POKEMON pending choice when using a snipe attack", () => {
    const attacked = resolveAction(startedGameWithSniper(), {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "snipe-attack"
    });

    expect(attacked.ok).toBe(true);
    if (!attacked.ok) return;
    expect(attacked.state.pendingChoice).toMatchObject({
      playerId: "p1",
      kind: "SELECT_POKEMON",
      minSelections: 1,
      maxSelections: 1
    });
    const optionIds = attacked.state.pendingChoice?.options.map((o) => o.id) ?? [];
    expect(optionIds).toContain("p2:bench:0");
    expect(optionIds).not.toContain("p2:active");
    expect(attacked.events.map((e) => e.type)).toContain("CHOICE_REQUESTED");
    expect(attacked.state.turn.playerId).toBe("p1");
  });

  it("resolves SELECT_POKEMON and places damage on the selected bench Pokemon", () => {
    const attacked = resolveAction(startedGameWithSniper(), {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "snipe-attack"
    });
    if (!attacked.ok) throw new Error(attacked.error.message);
    const choiceId = attacked.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");

    const resolved = resolveAction(attacked.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2:bench:0"] },
      clientActionId: "resolve-snipe"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.state.players.p2.bench[0].damage).toBe(30);
    expect(resolved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["CHOICE_RESOLVED", "DAMAGE_PLACED"])
    );
    const damageEvent = resolved.events.find((e) => e.type === "DAMAGE_PLACED");
    expect(damageEvent?.payload).toMatchObject({
      playerId: "p2",
      amount: 30,
      target: { playerId: "p2", zone: "bench", index: 0 }
    });
  });

  it("rejects an invalid option ID", () => {
    const attacked = resolveAction(startedGameWithSniper(), {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "snipe-attack"
    });
    if (!attacked.ok) throw new Error(attacked.error.message);
    const choiceId = attacked.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");

    const invalid = resolveAction(attacked.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2:bench:99"] },
      clientActionId: "bad-choice"
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_CHOICE_SELECTION");
  });

  it("does not auto-pass the turn after an attack that creates a pending choice", () => {
    const attacked = resolveAction(startedGameWithSniper(), {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "snipe-attack"
    });
    expect(attacked.ok).toBe(true);
    if (!attacked.ok) return;
    expect(attacked.state.turn.playerId).toBe("p1");

    const legal = getLegalActions(attacked.state, "p1");
    expect(legal.map((a) => a.type)).toContain("RESOLVE_CHOICE");
    expect(legal.map((a) => a.type)).not.toContain("PASS_TURN");
    expect(legal.map((a) => a.type)).not.toContain("ATTACK");

    // Resolve choice, then turn can be passed
    const choiceId = attacked.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const resolved = resolveAction(attacked.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2:bench:0"] },
      clientActionId: "resolve-snipe"
    });
    if (!resolved.ok) throw new Error(resolved.error.message);

    const passed = resolveAction(resolved.state, {
      playerId: "p1",
      type: "PASS_TURN",
      payload: {},
      clientActionId: "pass-after-snipe"
    });
    expect(passed.ok).toBe(true);
    if (passed.ok) expect(passed.state.turn.playerId).toBe("p2");
  });

  it("knocks out a benched Pokemon when damage exceeds HP without triggering promotion", () => {
    const attacked = resolveAction(startedGameWithSniper(), {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "snipe-attack"
    });
    if (!attacked.ok) throw new Error(attacked.error.message);
    const choiceId = attacked.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");

    // Pre-damage the bench slot to 30 so snipe (30) brings it to 60 > 50 HP
    const mutated = attacked.state;
    mutated.players.p2.bench[0].damage = 30;

    const resolved = resolveAction(mutated, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2:bench:0"] },
      clientActionId: "resolve-snipe-ko"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.players.p2.bench).toHaveLength(0);
    const koEvent = resolved.events.find((e) => e.type === "POKEMON_KNOCKED_OUT");
    expect(koEvent?.payload).toMatchObject({ playerId: "p2", zone: "bench", benchIndex: 0 });
    // No promotion needed for bench KO
    expect(resolved.state.pendingPromotionPlayerId).toBeUndefined();
    // Attacker takes a prize
    const prizeEvent = resolved.events.find((e) => e.type === "PRIZE_TAKEN");
    expect(prizeEvent).toBeDefined();
    expect(prizeEvent?.payload).toMatchObject({ playerId: "p1", takenCount: 1 });
  });

  it("emits events with correct visibility for SELECT_POKEMON", () => {
    const attacked = resolveAction(startedGameWithSniper(), {
      playerId: "p1",
      type: "ATTACK",
      payload: { attackIndex: 0 },
      clientActionId: "snipe-attack"
    });
    if (!attacked.ok) throw new Error(attacked.error.message);

    const choiceRequested = attacked.events.find((e) => e.type === "CHOICE_REQUESTED");
    expect(choiceRequested?.visibility).toEqual({ playerId: "p1" });

    const choiceId = attacked.state.pendingChoice?.id;
    if (!choiceId) throw new Error("expected pending choice");
    const resolved = resolveAction(attacked.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2:bench:0"] },
      clientActionId: "resolve-snipe"
    });
    if (!resolved.ok) throw new Error(resolved.error.message);

    const choiceResolved = resolved.events.find((e) => e.type === "CHOICE_RESOLVED");
    expect(choiceResolved?.visibility).toEqual({ playerId: "p1" });

    const damagePlaced = resolved.events.find((e) => e.type === "DAMAGE_PLACED");
    expect(damagePlaced?.visibility).toBe("public");
  });
});

const retrieveTrainer: CardDefinition = {
  id: "test-retrieve-trainer",
  languageRefs: {
    en: { name: "Rescue Trolley", rulesText: "Choose 1 Basic Pokemon from your discard pile and put it into your hand." },
    zhHans: { name: "救援担架", rulesText: "从弃牌区选择1张基础宝可梦，加入手牌。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["Choose 1 Basic Pokemon from your discard pile and put it into your hand."],
  effectRefs: ["trainer.retrieve.basic.1.to-hand"]
};

const retrieveCards = [...sampleCards, retrieveTrainer];

const retrieveP1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "test-retrieve-trainer",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009"
];

function startedGameWithDiscardSetup() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: retrieveP1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: retrieveCards,
    seed: "phase4-discard",
    ruleset: { prizeCount: 2 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, { playerId, type: "PLACE_ACTIVE", payload: { cardInstanceId }, clientActionId: `active-${playerId}` });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  state = started.state;

  const basicId = state.players.p1.hand.find((id: string) => {
    const cid = state.instances[id]?.cardId;
    const card = cid ? state.cards[cid] : undefined;
    return card?.supertype === "Pokemon" && card?.subtypes.includes("Basic");
  });
  if (!basicId) throw new Error("no Basic in hand to discard");
  state.players.p1.hand = state.players.p1.hand.filter((id: string) => id !== basicId);
  state.players.p1.discard.push(basicId);

  return state;
}

describe("SEARCH_DISCARD choice type", () => {
  it("retrieves a Basic Pokemon from discard to hand", () => {
    const state = startedGameWithDiscardSetup();
    const retrieveId = findInHand(state, "p1", "test-retrieve-trainer");
    if (!retrieveId) throw new Error("retrieve trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: retrieveId },
      clientActionId: "retrieve-trainer"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice).toMatchObject({
      playerId: "p1",
      kind: "SEARCH_DISCARD",
      minSelections: 1,
      maxSelections: 1
    });
    expect(played.state.pendingChoice!.options.length).toBeGreaterThanOrEqual(1);

    const choiceId = played.state.pendingChoice!.id;
    const targetId = played.state.pendingChoice!.options[0].cardInstanceId;
    expect(state.players.p1.discard).toContain(targetId);

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [targetId!] },
      clientActionId: "resolve-retrieve"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.state.players.p1.hand).toContain(targetId);
    expect(resolved.state.players.p1.discard).not.toContain(targetId);
    expect(resolved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["CHOICE_RESOLVED", "CARD_MOVED"])
    );
  });

  it("creates a 0-selection choice when discard has no matching cards", () => {
    let state = startedGameWithDiscardSetup();
    // Clear the discard pile
    state.players.p1.discard = [];
    const retrieveId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-retrieve-trainer");
    if (!retrieveId) throw new Error("retrieve trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: retrieveId },
      clientActionId: "retrieve-trainer-empty"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice?.minSelections).toBe(0);
    expect(played.state.pendingChoice?.maxSelections).toBe(0);
    expect(played.state.pendingChoice?.options).toHaveLength(0);

    const choiceId = played.state.pendingChoice!.id;
    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [] },
      clientActionId: "resolve-empty-discard"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.events.map((e) => e.type)).toEqual(["CHOICE_RESOLVED"]);
    expect(resolved.events.filter((e) => e.type === "CARD_MOVED")).toHaveLength(0);
  });

  it("rejects an option not in the discard pile", () => {
    const state = startedGameWithDiscardSetup();
    const retrieveId = findInHand(state, "p1", "test-retrieve-trainer");
    if (!retrieveId) throw new Error("retrieve trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: retrieveId },
      clientActionId: "retrieve-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;

    const invalid = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["p2-card-1"] },
      clientActionId: "invalid-retrieve"
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_CHOICE_SELECTION");
  });

  it("emits CARD_MOVED with public visibility from discard to hand", () => {
    const state = startedGameWithDiscardSetup();
    const retrieveId = findInHand(state, "p1", "test-retrieve-trainer");
    if (!retrieveId) throw new Error("retrieve trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: retrieveId },
      clientActionId: "retrieve-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;
    const targetId = played.state.pendingChoice!.options[0].cardInstanceId;

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [targetId!] },
      clientActionId: "resolve-retrieve-vis"
    });
    if (!resolved.ok) throw new Error(resolved.error.message);

    const movedEvent = resolved.events.find((e) => e.type === "CARD_MOVED");
    expect(movedEvent?.visibility).toBe("public");
    expect(movedEvent?.payload).toMatchObject({ from: "discard", to: "hand" });
  });
});

const retrieveToDeckTrainer: CardDefinition = {
  id: "test-retrieve-deck-trainer",
  languageRefs: {
    en: { name: "Super Rod", rulesText: "Choose 1 Basic Pokemon from your discard pile and shuffle it into your deck." },
    zhHans: { name: "超级钓竿", rulesText: "从弃牌区选择1张基础宝可梦，放回牌库并洗牌。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["Choose 1 Basic Pokemon from your discard pile and shuffle it into your deck."],
  effectRefs: ["trainer.retrieve.basic.1.to-deck"]
};

const retrieveDeckCards = [...sampleCards, retrieveToDeckTrainer];

const retrieveDeckP1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "test-retrieve-deck-trainer",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009"
];

function startedGameWithDiscardToDeckSetup() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: retrieveDeckP1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: retrieveDeckCards,
    seed: "phase4-discard-deck",
    ruleset: { prizeCount: 2 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, { playerId, type: "PLACE_ACTIVE", payload: { cardInstanceId }, clientActionId: `active-${playerId}` });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  state = started.state;

  const basicId = state.players.p1.hand.find((id: string) => {
    const cid = state.instances[id]?.cardId;
    const card = cid ? state.cards[cid] : undefined;
    return card?.supertype === "Pokemon" && card?.subtypes.includes("Basic");
  });
  if (!basicId) throw new Error("no Basic in hand to discard");
  state.players.p1.hand = state.players.p1.hand.filter((id: string) => id !== basicId);
  state.players.p1.discard.push(basicId);

  return state;
}

describe("MOVE_FROM_DISCARD_TO_DECK choice type", () => {
  it("moves a Basic Pokemon from discard to deck and shuffles", () => {
    const state = startedGameWithDiscardToDeckSetup();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-retrieve-deck-trainer");
    if (!trainerId) throw new Error("retrieve-deck trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "retrieve-deck-trainer"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;
    const targetId = played.state.pendingChoice!.options[0].cardInstanceId;
    expect(state.players.p1.discard).toContain(targetId);

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [targetId!] },
      clientActionId: "resolve-retrieve-deck"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.state.players.p1.discard).not.toContain(targetId);
    expect(resolved.state.players.p1.deck).toContain(targetId);
    expect(resolved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["CHOICE_RESOLVED", "CARD_MOVED", "DECK_SHUFFLED"])
    );
    const movedEvent = resolved.events.find((e) => e.type === "CARD_MOVED");
    expect(movedEvent?.payload).toMatchObject({ from: "discard", to: "deck" });
    expect(movedEvent?.visibility).toEqual({ playerId: "p1" });
  });

  it("creates a 0-selection choice when discard has no matching cards for to-deck", () => {
    let state = startedGameWithDiscardToDeckSetup();
    state.players.p1.discard = [];
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-retrieve-deck-trainer");
    if (!trainerId) throw new Error("retrieve-deck trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "retrieve-deck-trainer-empty"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice?.minSelections).toBe(0);
    expect(played.state.pendingChoice?.maxSelections).toBe(0);

    const choiceId = played.state.pendingChoice!.id;
    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [] },
      clientActionId: "resolve-empty-deck"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["CHOICE_RESOLVED", "DECK_SHUFFLED"])
    );
  });
});

const superRodTrainer: CardDefinition = {
  id: "test-super-rod",
  languageRefs: {
    en: { name: "Super Rod", rulesText: "Choose up to 3 Pokemon and Basic Energy cards from your discard pile, and shuffle them into your deck." },
    zhHans: { name: "超级钓竿", rulesText: "从弃牌区选择宝可梦和基本能量卡最多3张，放回牌库并洗牌。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["Choose up to 3 Pokemon and Basic Energy cards from your discard pile, and shuffle them into your deck."],
  effectRefs: ["trainer.super-rod.3.to-deck"]
};

const superRodCards = [...sampleCards, superRodTrainer];

const superRodP1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "test-super-rod",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009"
];

function startedGameWithSuperRodSetup() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: superRodP1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: superRodCards,
    seed: "phase4-super-rod",
    ruleset: { prizeCount: 2 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, { playerId, type: "PLACE_ACTIVE", payload: { cardInstanceId }, clientActionId: `active-${playerId}` });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  state = started.state;

  // Move a Basic Pokemon and a Basic Energy from hand to discard
  const basicPokemonId = state.players.p1.hand.find((id: string) => {
    const cid = state.instances[id]?.cardId;
    const card = cid ? state.cards[cid] : undefined;
    return card?.supertype === "Pokemon" && card?.subtypes.includes("Basic");
  });
  const basicEnergyId = state.players.p1.hand.find((id: string) => {
    const cid = state.instances[id]?.cardId;
    const card = cid ? state.cards[cid] : undefined;
    return card?.supertype === "Energy" && card?.subtypes.includes("Basic");
  });
  if (!basicPokemonId || !basicEnergyId) throw new Error("not enough cards for discard setup");
  state.players.p1.hand = state.players.p1.hand.filter((id: string) => id !== basicPokemonId && id !== basicEnergyId);
  state.players.p1.discard.push(basicPokemonId, basicEnergyId);

  return state;
}

describe("super rod and filter/minCount features", () => {
  it("OR filter: options include both Pokemon and Basic Energy from discard", () => {
    const state = startedGameWithSuperRodSetup();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-super-rod");
    if (!trainerId) throw new Error("super-rod not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "super-rod"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice?.kind).toBe("SEARCH_DISCARD");
    expect(played.state.pendingChoice?.minSelections).toBe(0);
    expect(played.state.pendingChoice?.maxSelections).toBe(2); // 2 matching cards
    const labels = played.state.pendingChoice!.options.map((o) => o.label);
    // Should contain both a Pokemon and an Energy card name
    expect(labels.length).toBe(2);
  });

  it("allows selecting fewer than max (minCount=0 optional)", () => {
    const state = startedGameWithSuperRodSetup();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-super-rod");
    if (!trainerId) throw new Error("super-rod not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "super-rod"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;
    // Select only 1 of the 2 available options
    const targetId = played.state.pendingChoice!.options[0].cardInstanceId;

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: [targetId!] },
      clientActionId: "resolve-partial"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    expect(resolved.state.players.p1.discard).not.toContain(targetId);
    expect(resolved.state.players.p1.deck).toContain(targetId);
    // The other card should still be in discard (not selected)
    const otherId = played.state.pendingChoice!.options[1].cardInstanceId;
    expect(resolved.state.players.p1.discard).toContain(otherId);
  });

  it("moves selected cards from discard to deck and shuffles", () => {
    const state = startedGameWithSuperRodSetup();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-super-rod");
    if (!trainerId) throw new Error("super-rod not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "super-rod"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;
    const optionIds = played.state.pendingChoice!.options.map((o) => o.cardInstanceId!);

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: optionIds },
      clientActionId: "resolve-all"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["CHOICE_RESOLVED", "CARD_MOVED", "DECK_SHUFFLED"])
    );
    expect(resolved.events.filter((e) => e.type === "CARD_MOVED")).toHaveLength(2);
    expect(resolved.state.players.p1.discard).toHaveLength(1); // trainer itself stays in discard
  });
});

const optionalDrawTrainer: CardDefinition = {
  id: "test-optional-draw",
  languageRefs: {
    en: { name: "Optional Draw", rulesText: "You may draw 2 cards." },
    zhHans: { name: "可选抽牌", rulesText: "你可以抽2张卡。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["You may draw 2 cards."],
  effectRefs: ["trainer.draw.2-optional"]
};

const optionalDrawCards = [...sampleCards, optionalDrawTrainer];

const optionalDrawP1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "test-optional-draw",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009",
  "sv1-011",
  "sv1-012",
  "sv1-013"
];

function startedGameOptionalDraw() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: optionalDrawP1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: optionalDrawCards,
    seed: "phase4-optional",
    ruleset: { prizeCount: 2 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, { playerId, type: "PLACE_ACTIVE", payload: { cardInstanceId }, clientActionId: `active-${playerId}` });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

describe("OPTIONAL_EFFECT choice type", () => {
  it("executes the effect when the player selects Yes", () => {
    const state = startedGameOptionalDraw();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-optional-draw");
    if (!trainerId) throw new Error("optional draw trainer not in hand");
    const handBefore = state.players.p1.hand.length;

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "optional-draw"
    });

    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice?.kind).toBe("OPTIONAL_EFFECT");
    expect(played.state.pendingChoice?.options.map((o) => o.id)).toEqual(["yes", "no"]);

    const choiceId = played.state.pendingChoice!.id;
    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["yes"] },
      clientActionId: "resolve-yes"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    // hand: -1 trainer, +2 drawn = net +1. Trainer goes to discard.
    expect(resolved.state.players.p1.hand.length).toBe(handBefore + 1);
    expect(resolved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["CHOICE_RESOLVED", "CARD_DRAWN"])
    );
  });

  it("does nothing when the player selects No", () => {
    const state = startedGameOptionalDraw();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-optional-draw");
    if (!trainerId) throw new Error("optional draw trainer not in hand");
    const handBefore = state.players.p1.hand.length;

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "optional-draw"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["no"] },
      clientActionId: "resolve-no"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    // hand: only -1 trainer (moved to discard), no draws
    expect(resolved.state.players.p1.hand.length).toBe(handBefore - 1);
    expect(resolved.events.map((e) => e.type)).not.toContain("CARD_DRAWN");
  });

  it("rejects an invalid option for OPTIONAL_EFFECT", () => {
    const state = startedGameOptionalDraw();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-optional-draw");
    if (!trainerId) throw new Error("optional draw trainer not in hand");

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "optional-draw"
    });
    if (!played.ok) throw new Error(played.error.message);
    const choiceId = played.state.pendingChoice!.id;

    const invalid = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId, selectedOptionIds: ["maybe"] },
      clientActionId: "resolve-invalid"
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_CHOICE_SELECTION");
  });
});

const rescueTrainer: CardDefinition = {
  id: "test-rescue-trainer",
  languageRefs: {
    en: { name: "Rescue Op", rulesText: "Choose 1 Basic Pokemon from your discard pile and put it into your hand. Then search your deck for 1 Basic Pokemon and put it into your hand. Shuffle your deck." },
    zhHans: { name: "救援行动", rulesText: "从弃牌区选择1张基础宝可梦加入手牌。然后从牌库检索1张基础宝可梦加入手牌。洗牌。" }
  },
  regulationMark: "G",
  supertype: "Trainer",
  subtypes: ["Item"],
  rulesText: ["Two-stage rescue effect."],
  effectRefs: ["trainer.rescue.retrieve-and-search"]
};

const rescueCards = [...sampleCards, rescueTrainer];

const rescueP1Deck = [
  "sv1-001",
  "sv1-002",
  "sv1-003",
  "sv1-004",
  "test-rescue-trainer",
  "sv1-006",
  "sv1-007",
  "sv1-008",
  "sv1-009",
  "sv1-011",
  "sv1-012",
  "sv1-013"
];

function startedGameRescue() {
  let state = createInitialState({
    players: [
      { id: "p1", name: "Player 1", deck: rescueP1Deck },
      { id: "p2", name: "Player 2", deck: p2Deck }
    ],
    cards: rescueCards,
    seed: "phase4-rescue",
    ruleset: { prizeCount: 2 }
  });

  for (const [playerId, cardInstanceId] of [
    ["p1", "p1-card-1"],
    ["p2", "p2-card-1"]
  ] as const) {
    const placed = resolveAction(state, { playerId, type: "PLACE_ACTIVE", payload: { cardInstanceId }, clientActionId: `active-${playerId}` });
    if (!placed.ok) throw new Error(placed.error.message);
    state = placed.state;
  }

  const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
  if (!started.ok) throw new Error(started.error.message);
  state = started.state;

  // Move a Basic from hand to discard for the first stage
  const basicId = state.players.p1.hand.find((id: string) => {
    const cid = state.instances[id]?.cardId;
    const card = cid ? state.cards[cid] : undefined;
    return card?.supertype === "Pokemon" && card?.subtypes.includes("Basic");
  });
  if (!basicId) throw new Error("no Basic in hand");
  state.players.p1.hand = state.players.p1.hand.filter((id: string) => id !== basicId);
  state.players.p1.discard.push(basicId);

  return state;
}

describe("multi-stage choice flow", () => {
  it("executes two sequential choices: discard retrieve then deck search", () => {
    const state = startedGameRescue();
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-rescue-trainer");
    if (!trainerId) throw new Error("rescue trainer not in hand");

    // Play trainer → creates first pendingChoice (SEARCH_DISCARD)
    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "rescue"
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice?.kind).toBe("SEARCH_DISCARD");

    // Resolve first choice → card from discard to hand
    const choice1Id = played.state.pendingChoice!.id;
    const discardTargetId = played.state.pendingChoice!.options[0].cardInstanceId;
    const resolved1 = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId: choice1Id, selectedOptionIds: [discardTargetId!] },
      clientActionId: "resolve-1"
    });
    expect(resolved1.ok).toBe(true);
    if (!resolved1.ok) return;
    expect(resolved1.state.players.p1.discard).not.toContain(discardTargetId);
    expect(resolved1.state.players.p1.hand).toContain(discardTargetId);

    // Second pendingChoice should have been created (SEARCH_DECK)
    expect(resolved1.state.pendingChoice?.kind).toBe("SEARCH_DECK");

    // Resolve second choice → card from deck to hand + shuffle
    const choice2Id = resolved1.state.pendingChoice!.id;
    const deckTargetId = resolved1.state.pendingChoice!.options[0].cardInstanceId;
    const resolved2 = resolveAction(resolved1.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId: choice2Id, selectedOptionIds: [deckTargetId!] },
      clientActionId: "resolve-2"
    });
    expect(resolved2.ok).toBe(true);
    if (!resolved2.ok) return;
    expect(resolved2.state.pendingChoice).toBeUndefined();
    expect(resolved2.state.players.p1.hand).toContain(deckTargetId);
    expect(resolved2.state.players.p1.deck).not.toContain(deckTargetId);
    expect(resolved2.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["DECK_SHUFFLED"])
    );
  });

  it("OPTIONAL_EFFECT No clears remainingSteps so they do not execute", () => {
    // Use optional draw effect: steps = [OPTIONAL_EFFECT(draw 1), draw 1]
    // No → only first draw skipped, remaining draw also skipped = total 0 draws
    const noThanksTrainer: CardDefinition = {
      id: "test-no-thanks",
      languageRefs: { en: { name: "No Thanks" }, zhHans: { name: "免了" } },
      regulationMark: "G",
      supertype: "Trainer",
      subtypes: ["Item"],
      rulesText: ["You may draw 1 card. Draw 1 card."],
      effectRefs: ["trainer.draw.1-optional-then-draw.1"]
    };
    const cards = [...sampleCards, noThanksTrainer];
    const deck = ["sv1-001", "sv1-002", "sv1-003", "sv1-004", "test-no-thanks", "sv1-006", "sv1-007", "sv1-008", "sv1-009", "sv1-011", "sv1-012", "sv1-013"];

    let state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck },
        { id: "p2", name: "Player 2", deck: p2Deck }
      ],
      cards,
      seed: "phase4-no-thanks",
      ruleset: { prizeCount: 2 }
    });

    for (const [playerId, cardInstanceId] of [["p1", "p1-card-1"], ["p2", "p2-card-1"]] as const) {
      const placed = resolveAction(state, { playerId, type: "PLACE_ACTIVE", payload: { cardInstanceId }, clientActionId: `a-${playerId}` });
      if (!placed.ok) throw new Error(placed.error.message);
      state = placed.state;
    }
    const started = resolveAction(state, { playerId: "p1", type: "START_GAME", payload: {}, clientActionId: "start" });
    if (!started.ok) throw new Error(started.error.message);
    state = started.state;

    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-no-thanks");
    if (!trainerId) throw new Error("no-thanks trainer not in hand");
    const handBefore = state.players.p1.hand.length;

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "no-thanks"
    });
    if (!played.ok) throw new Error(played.error.message);

    const resolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId: played.state.pendingChoice!.id, selectedOptionIds: ["no"] },
      clientActionId: "resolve-no"
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingChoice).toBeUndefined();
    // Only -1 for trainer played, no draws
    expect(resolved.events.map((e) => e.type)).not.toContain("CARD_DRAWN");
    expect(resolved.state.players.p1.hand.length).toBe(handBefore - 1);
  });

  it("OPTIONAL_EFFECT Yes can create a choice and then continue remainingSteps", () => {
    const optionalRetrieveTrainer: CardDefinition = {
      id: "test-optional-retrieve-then-draw",
      languageRefs: {
        en: { name: "Optional Rescue Draw", rulesText: "You may put a Basic Pokemon from your discard pile into your hand. Draw 1 card." },
        zhHans: { name: "可选救援抽牌", rulesText: "你可以将弃牌区的1张基础宝可梦加入手牌。抽1张卡。" }
      },
      regulationMark: "G",
      supertype: "Trainer",
      subtypes: ["Item"],
      rulesText: ["You may put a Basic Pokemon from your discard pile into your hand. Draw 1 card."],
      effectRefs: ["trainer.optional-retrieve-basic-then-draw.1"]
    };
    const cards = [...sampleCards, optionalRetrieveTrainer];
    const deck = [
      "sv1-001",
      "sv1-002",
      "sv1-003",
      "sv1-004",
      "test-optional-retrieve-then-draw",
      "sv1-006",
      "sv1-007",
      "sv1-008",
      "sv1-009",
      "sv1-011",
      "sv1-012",
      "sv1-013"
    ];
    let state = createInitialState({
      players: [
        { id: "p1", name: "Player 1", deck },
        { id: "p2", name: "Player 2", deck: p2Deck }
      ],
      cards,
      seed: "phase4-optional-retrieve",
      ruleset: { prizeCount: 2 }
    });

    for (const [playerId, cardInstanceId] of [["p1", "p1-card-1"], ["p2", "p2-card-1"]] as const) {
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
    state = started.state;

    const discardTargetId = state.players.p1.hand.find((id: string) => {
      const cardId = state.instances[id]?.cardId;
      const card = cardId ? state.cards[cardId] : undefined;
      return card?.supertype === "Pokemon" && card.subtypes.includes("Basic");
    });
    if (!discardTargetId) throw new Error("expected a Basic Pokemon in hand");
    const trainerId = state.players.p1.hand.find((id: string) => state.instances[id]?.cardId === "test-optional-retrieve-then-draw");
    if (!trainerId) throw new Error("expected optional retrieve trainer in hand");
    state.players.p1.hand = state.players.p1.hand.filter((id: string) => id !== discardTargetId);
    state.players.p1.discard.push(discardTargetId);

    const played = resolveAction(state, {
      playerId: "p1",
      type: "PLAY_TRAINER",
      payload: { cardInstanceId: trainerId },
      clientActionId: "optional-retrieve"
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingChoice?.kind).toBe("OPTIONAL_EFFECT");

    const yesResolved = resolveAction(played.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId: played.state.pendingChoice!.id, selectedOptionIds: ["yes"] },
      clientActionId: "optional-yes"
    });
    expect(yesResolved.ok).toBe(true);
    if (!yesResolved.ok) return;
    expect(yesResolved.events.map((event) => event.type)).toEqual(["CHOICE_RESOLVED", "CHOICE_REQUESTED"]);
    expect(yesResolved.state.pendingChoice?.kind).toBe("SEARCH_DISCARD");
    expect(yesResolved.state.pendingChoice?.remainingSteps).toMatchObject([{ type: "draw", count: 1 }]);

    const retrieveResolved = resolveAction(yesResolved.state, {
      playerId: "p1",
      type: "RESOLVE_CHOICE",
      payload: { choiceId: yesResolved.state.pendingChoice!.id, selectedOptionIds: [discardTargetId] },
      clientActionId: "resolve-retrieve"
    });
    expect(retrieveResolved.ok).toBe(true);
    if (!retrieveResolved.ok) return;
    expect(retrieveResolved.state.pendingChoice).toBeUndefined();
    expect(retrieveResolved.state.players.p1.discard).not.toContain(discardTargetId);
    expect(retrieveResolved.state.players.p1.hand).toContain(discardTargetId);
    expect(retrieveResolved.events.map((event) => event.type)).toEqual(["CHOICE_RESOLVED", "CARD_MOVED", "CARD_DRAWN"]);
  });
});

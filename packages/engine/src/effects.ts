import type { ChoiceOption, EffectDefinition, GameEvent, GameState, PlayerId, PokemonSlot } from "./types";
import { moveTopDeckCardToHand, nextEvent, placeDamageOnActive } from "./mutations";

export const effectRegistry: Record<string, EffectDefinition> = {
  "trainer.draw.2": {
    id: "trainer.draw.2",
    trigger: "trainer-played",
    steps: [{ type: "draw", player: "self", count: 2 }]
  },
  "trainer.discard.1.draw.2": {
    id: "trainer.discard.1.draw.2",
    trigger: "trainer-played",
    steps: [{ type: "choice", kind: "DISCARD_FROM_HAND", count: 1, then: { type: "draw", count: 2 } }]
  },
  "trainer.search.basic.1.to-hand": {
    id: "trainer.search.basic.1.to-hand",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "SEARCH_DECK",
        count: 1,
        filter: [{ supertype: "Pokemon", subtypes: ["Basic"] }],
        then: { type: "move-to-hand", shuffleAfter: true }
      }
    ]
  },
  "attack.damage.20": {
    id: "attack.damage.20",
    trigger: "attack",
    steps: [{ type: "damage", target: "opponent-active", amount: 20 }]
  },
  "attack.snipe.bench.30": {
    id: "attack.snipe.bench.30",
    trigger: "attack",
    steps: [
      {
        type: "choice",
        kind: "SELECT_POKEMON",
        count: 1,
        filter: { player: "opponent", zones: ["bench"] },
        then: { type: "damage-to-selected", amount: 30 }
      }
    ]
  },
  "trainer.retrieve.basic.1.to-hand": {
    id: "trainer.retrieve.basic.1.to-hand",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "SEARCH_DISCARD",
        count: 1,
        filter: [{ supertype: "Pokemon", subtypes: ["Basic"] }],
        then: { type: "move-to-hand" }
      }
    ]
  },
  "trainer.retrieve.basic.1.to-deck": {
    id: "trainer.retrieve.basic.1.to-deck",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "SEARCH_DISCARD",
        count: 1,
        filter: [{ supertype: "Pokemon", subtypes: ["Basic"] }],
        then: { type: "move-to-deck", shuffleAfter: true }
      }
    ]
  },
  "trainer.rescue.retrieve-and-search": {
    id: "trainer.rescue.retrieve-and-search",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "SEARCH_DISCARD",
        count: 1,
        filter: [{ supertype: "Pokemon", subtypes: ["Basic"] }],
        then: { type: "move-to-hand" }
      },
      {
        type: "choice",
        kind: "SEARCH_DECK",
        count: 1,
        filter: [{ supertype: "Pokemon", subtypes: ["Basic"] }],
        then: { type: "move-to-hand", shuffleAfter: true }
      }
    ]
  },
  "trainer.draw.1-optional-then-draw.1": {
    id: "trainer.draw.1-optional-then-draw.1",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "OPTIONAL_EFFECT",
        prompt: "Draw 1 card?",
        then: [{ type: "draw", player: "self", count: 1 }]
      },
      { type: "draw", player: "self", count: 1 }
    ]
  },
  "trainer.draw.2-optional": {
    id: "trainer.draw.2-optional",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "OPTIONAL_EFFECT",
        prompt: "Draw 2 cards?",
        then: [{ type: "draw", player: "self", count: 2 }]
      }
    ]
  },
  "trainer.super-rod.3.to-deck": {
    id: "trainer.super-rod.3.to-deck",
    trigger: "trainer-played",
    steps: [
      {
        type: "choice",
        kind: "SEARCH_DISCARD",
        count: 3,
        minCount: 0,
        filter: [{ supertype: "Pokemon" }, { supertype: "Energy", subtypes: ["Basic"] }],
        then: { type: "move-to-deck", shuffleAfter: true }
      }
    ]
  }
};

export function applyEffect(
  state: GameState,
  effectId: string,
  sourcePlayerId: PlayerId,
  sourceActionId: string
): GameEvent[] {
  const effect = effectRegistry[effectId];
  if (!effect) return [];
  return applyEffectSteps(state, effect.steps, sourcePlayerId, sourceActionId);
}

export function applyEffectSteps(
  state: GameState,
  steps: EffectDefinition["steps"],
  sourcePlayerId: PlayerId,
  sourceActionId: string
): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === "draw") {
      for (let index = 0; index < step.count; index += 1) {
        const drawn = moveTopDeckCardToHand(state, sourcePlayerId);
        if (!drawn) break;
        events.push(
          nextEvent(state, {
            type: "CARD_DRAWN",
            payload: { playerId: sourcePlayerId, cardInstanceId: drawn },
            visibility: { playerId: sourcePlayerId },
            sourceActionId
          })
        );
      }
    }

    if (step.type === "damage") {
      const opponentId = state.playerOrder.find((id) => id !== sourcePlayerId);
      if (!opponentId) continue;
      const damage = placeDamageOnActive(state, opponentId, step.amount);
      if (!damage) continue;
      events.push(
        nextEvent(state, {
          type: "DAMAGE_PLACED",
          payload: { playerId: opponentId, amount: step.amount, totalDamage: damage.totalDamage },
          visibility: "public",
          sourceActionId
        })
      );
    }

    if (step.type === "choice") {
      const player = state.players[sourcePlayerId];
      const choiceId = `${sourceActionId}:choice:${state.eventSeq + 1}`;
      if (step.kind === "DISCARD_FROM_HAND") {
        const options = player.hand.map((cardInstanceId) => choiceOptionForCard(state, cardInstanceId));
        state.pendingChoice = {
          id: choiceId,
          playerId: sourcePlayerId,
          kind: step.kind,
          prompt: "Choose a card from your hand to discard.",
          minSelections: step.count,
          maxSelections: step.count,
          options,
          resolution: {
            type: "DISCARD_THEN_DRAW",
            drawCount: step.then.count,
            sourceActionId
          }
        };
      }
      if (step.kind === "SEARCH_DECK") {
        const options = player.deck
          .filter((cardInstanceId) => matchesDeckSearchFilter(state, cardInstanceId, step.filter))
          .map((cardInstanceId) => choiceOptionForCard(state, cardInstanceId));
        const min = step.minCount ?? step.count;
        state.pendingChoice = {
          id: choiceId,
          playerId: sourcePlayerId,
          kind: step.kind,
          prompt: "Choose a Pokemon from your deck.",
          minSelections: Math.min(min, options.length),
          maxSelections: Math.min(step.count, options.length),
          options,
          resolution: {
            type: "MOVE_FROM_DECK_TO_HAND",
            shuffleAfter: step.then.shuffleAfter,
            sourceActionId
          }
        };
      }
      if (step.kind === "SELECT_POKEMON") {
        const targetPlayerId =
          step.filter.player === "self"
            ? sourcePlayerId
            : state.playerOrder.find((id) => id !== sourcePlayerId);
        if (!targetPlayerId) continue;
        const targetPlayer = state.players[targetPlayerId];
        const options: ChoiceOption[] = [];
        if (step.filter.zones.includes("active") && targetPlayer.active) {
          options.push(
            choiceOptionForSlot(state, targetPlayerId, "active", 0, targetPlayer.active)
          );
        }
        if (step.filter.zones.includes("bench")) {
          targetPlayer.bench.forEach((slot, index) => {
            options.push(choiceOptionForSlot(state, targetPlayerId, "bench", index, slot));
          });
        }
        const selectableCount = Math.min(step.count, options.length);
        state.pendingChoice = {
          id: choiceId,
          playerId: sourcePlayerId,
          kind: step.kind,
          prompt: `Choose ${step.count} Pokemon from ${step.filter.player === "self" ? "your" : "your opponent's"} ${step.filter.zones.join("/")}.`,
          minSelections: selectableCount,
          maxSelections: selectableCount,
          options,
          resolution: {
            type: "DAMAGE_TO_SELECTED_POKEMON",
            amount: step.then.amount,
            sourceActionId
          }
        };
      }
      if (step.kind === "SEARCH_DISCARD") {
        const options = player.discard
          .filter((cardInstanceId) => matchesDeckSearchFilter(state, cardInstanceId, step.filter))
          .map((cardInstanceId) => choiceOptionForCard(state, cardInstanceId));
        const min = step.minCount ?? step.count;
        const resolution =
          step.then.type === "move-to-deck"
            ? { type: "MOVE_FROM_DISCARD_TO_DECK" as const, shuffleAfter: step.then.shuffleAfter, sourceActionId }
            : { type: "MOVE_FROM_DISCARD_TO_HAND" as const, sourceActionId };
        state.pendingChoice = {
          id: choiceId,
          playerId: sourcePlayerId,
          kind: step.kind,
          prompt: "Choose cards from your discard pile.",
          minSelections: Math.min(min, options.length),
          maxSelections: Math.min(step.count, options.length),
          options,
          resolution
        };
      }
      if (step.kind === "OPTIONAL_EFFECT") {
        state.pendingChoice = {
          id: choiceId,
          playerId: sourcePlayerId,
          kind: step.kind,
          prompt: step.prompt,
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" }
          ],
          resolution: {
            type: "OPTIONAL_EFFECT",
            yesSteps: step.then,
            sourceActionId
          }
        };
      }
      if (!state.pendingChoice) continue;
      events.push(
        nextEvent(state, {
          type: "CHOICE_REQUESTED",
          payload: {
            choiceId,
            playerId: sourcePlayerId,
            kind: step.kind,
            minSelections: state.pendingChoice.minSelections,
            maxSelections: state.pendingChoice.maxSelections
          },
          visibility: { playerId: sourcePlayerId },
          sourceActionId
        })
      );

      if (i < steps.length - 1) {
        state.pendingChoice.remainingSteps = steps.slice(i + 1);
        break;
      }
    }
  }

  return events;
}

function choiceOptionForCard(state: GameState, cardInstanceId: string): {
  id: string;
  cardInstanceId: string;
  label: string;
} {
  const cardId = state.instances[cardInstanceId]?.cardId;
  const card = cardId ? state.cards[cardId] : undefined;
  return {
    id: cardInstanceId,
    cardInstanceId,
    label: card?.languageRefs.zhHans?.name ?? card?.languageRefs.en.name ?? cardInstanceId
  };
}

function choiceOptionForSlot(
  state: GameState,
  playerId: string,
  zone: "active" | "bench",
  index: number,
  slot: PokemonSlot
): ChoiceOption {
  const cardId = state.instances[slot.cardInstanceId]?.cardId;
  const card = cardId ? state.cards[cardId] : undefined;
  const label = card?.languageRefs.zhHans?.name ?? card?.languageRefs.en.name ?? slot.cardInstanceId;
  const id = zone === "active"
    ? `${playerId}:active`
    : `${playerId}:bench:${index}`;
  return { id, label, cardInstanceId: slot.cardInstanceId };
}

function matchesDeckSearchFilter(
  state: GameState,
  cardInstanceId: string,
  filters: { supertype?: string; subtypes?: string[] }[]
): boolean {
  const cardId = state.instances[cardInstanceId]?.cardId;
  const card = cardId ? state.cards[cardId] : undefined;
  if (!card) return false;
  return filters.some((filter) => {
    if (filter.supertype && card.supertype !== filter.supertype) return false;
    if (filter.subtypes?.some((subtype) => !card.subtypes.includes(subtype))) return false;
    return true;
  });
}

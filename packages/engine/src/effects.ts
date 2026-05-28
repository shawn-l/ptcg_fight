import type { EffectDefinition, GameEvent, GameState, PlayerId } from "./types";
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
        filter: { supertype: "Pokemon", subtypes: ["Basic"] },
        then: { type: "move-to-hand", shuffleAfter: true }
      }
    ]
  },
  "attack.damage.20": {
    id: "attack.damage.20",
    trigger: "attack",
    steps: [{ type: "damage", target: "opponent-active", amount: 20 }]
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

  const events: GameEvent[] = [];
  for (const step of effect.steps) {
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
        state.pendingChoice = {
          id: choiceId,
          playerId: sourcePlayerId,
          kind: step.kind,
          prompt: "Choose a Basic Pokemon from your deck.",
          minSelections: step.count,
          maxSelections: step.count,
          options,
          resolution: {
            type: "MOVE_FROM_DECK_TO_HAND",
            shuffleAfter: step.then.shuffleAfter,
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
            minSelections: step.count,
            maxSelections: step.count
          },
          visibility: { playerId: sourcePlayerId },
          sourceActionId
        })
      );
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

function matchesDeckSearchFilter(
  state: GameState,
  cardInstanceId: string,
  filter: { supertype?: string; subtypes?: string[] }
): boolean {
  const cardId = state.instances[cardInstanceId]?.cardId;
  const card = cardId ? state.cards[cardId] : undefined;
  if (!card) return false;
  if (filter.supertype && card.supertype !== filter.supertype) return false;
  if (filter.subtypes?.some((subtype) => !card.subtypes.includes(subtype))) return false;
  return true;
}

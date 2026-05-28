import type { CardDefinition } from "@ptcg-fight/cards";
import type { CardInstance, GameState, PlayerId, PlayerState, RulesetConfig } from "./types";

export type InitialPlayerInput = {
  id: PlayerId;
  name: string;
  deck: string[];
};

export type CreateInitialStateInput = {
  id?: string;
  players: [InitialPlayerInput, InitialPlayerInput];
  cards: CardDefinition[];
  seed: string;
  ruleset?: Partial<RulesetConfig>;
};

export const defaultRuleset: RulesetConfig = {
  id: "current",
  name: "Current rules with regional card mapping",
  prizeCount: 1,
  openingHandSize: 7,
  maxBenchSize: 5
};

export function createInitialState(input: CreateInitialStateInput): GameState {
  const ruleset = { ...defaultRuleset, ...input.ruleset };
  const cards = Object.fromEntries(input.cards.map((card) => [card.id, card]));
  const instances: GameState["instances"] = {};
  const players: Record<PlayerId, PlayerState> = {};

  for (const player of input.players) {
    const instanceIds = player.deck.map((cardId, index) => {
      if (!cards[cardId]) {
        throw new Error(`Unknown card id in deck: ${cardId}`);
      }
      const instanceId = `${player.id}-card-${index + 1}`;
      instances[instanceId] = { id: instanceId, cardId, ownerId: player.id };
      return instanceId;
    });

    const opening = drawOpeningHandWithMulligans(instanceIds, cards, instances, ruleset.openingHandSize, `${input.seed}:${player.id}`);

    players[player.id] = {
      id: player.id,
      name: player.name,
      deck: opening.deck,
      hand: opening.hand,
      discard: [],
      prizes: [],
      lostZone: [],
      bench: [],
      mulligansTaken: opening.mulligansTaken,
      pendingMulliganDraws: 0,
      retreatedThisTurn: false,
      supporterUsedThisTurn: false,
      energyAttachedThisTurn: false
    };
  }

  for (const playerId of Object.keys(players)) {
    const opponentId = input.players.map((player) => player.id).find((id) => id !== playerId);
    if (!opponentId) continue;
    players[playerId].pendingMulliganDraws = Math.max(
      players[opponentId].mulligansTaken - players[playerId].mulligansTaken,
      0
    );
  }

  return {
    id: input.id ?? "local-game",
    ruleset,
    phase: "setup",
    turn: { playerId: input.players[0].id, number: 1 },
    cards,
    instances,
    players,
    playerOrder: input.players.map((player) => player.id),
    eventSeq: 0,
    seed: input.seed
  };
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function drawOpeningHandWithMulligans(
  deck: string[],
  cards: Record<string, CardDefinition>,
  instances: Record<string, CardInstance>,
  openingHandSize: number,
  seed: string
): { hand: string[]; deck: string[]; mulligansTaken: number } {
  let workingDeck = [...deck];
  let hand = workingDeck.slice(0, openingHandSize);
  workingDeck = workingDeck.slice(openingHandSize);
  let mulligansTaken = 0;

  while (!handHasBasicPokemon(hand, cards, instances)) {
    mulligansTaken += 1;
    if (!deckHasBasicPokemon(deck, cards, instances)) {
      throw new Error("Deck must contain at least one Basic Pokemon");
    }
    workingDeck = shuffleDeterministically([...hand, ...workingDeck], `${seed}:${mulligansTaken}`);
    hand = workingDeck.slice(0, openingHandSize);
    workingDeck = workingDeck.slice(openingHandSize);
    if (mulligansTaken > 20) {
      throw new Error("Unable to draw an opening hand with a Basic Pokemon after 20 mulligans");
    }
  }

  return { hand, deck: workingDeck, mulligansTaken };
}

function handHasBasicPokemon(
  hand: string[],
  cards: Record<string, CardDefinition>,
  instances: Record<string, CardInstance>
): boolean {
  return hand.some((instanceId) => {
    const instance = instances[instanceId];
    const card = instance ? cards[instance.cardId] : undefined;
    return card?.supertype === "Pokemon" && card.subtypes.includes("Basic");
  });
}

function deckHasBasicPokemon(
  deck: string[],
  cards: Record<string, CardDefinition>,
  instances: Record<string, CardInstance>
): boolean {
  return deck.some((instanceId) => {
    const instance = instances[instanceId];
    const card = instance ? cards[instance.cardId] : undefined;
    return card?.supertype === "Pokemon" && card.subtypes.includes("Basic");
  });
}

function shuffleDeterministically<T>(items: T[], seed: string): T[] {
  const shuffled = [...items];
  let randomState = hashSeed(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    const swapIndex = randomState % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

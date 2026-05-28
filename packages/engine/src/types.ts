import type { CardDefinition } from "@ptcg-fight/cards";

export type PlayerId = string;

export type GamePhase = "setup" | "main" | "between-turns" | "game-over";

export type ZoneName = "deck" | "hand" | "active" | "bench" | "discard" | "prizes" | "lostZone";

export type CardInstance = {
  id: string;
  cardId: string;
  ownerId: PlayerId;
};

export type PokemonSlot = {
  cardInstanceId: string;
  evolution: string[];
  attachedEnergy: string[];
  damage: number;
  specialConditions: string[];
  enteredTurn: number;
  evolvedThisTurn: boolean;
};

export type PlayerState = {
  id: PlayerId;
  name: string;
  deck: string[];
  hand: string[];
  discard: string[];
  prizes: string[];
  lostZone: string[];
  active?: PokemonSlot;
  bench: PokemonSlot[];
  mulligansTaken: number;
  pendingMulliganDraws: number;
  retreatedThisTurn: boolean;
  supporterUsedThisTurn: boolean;
  energyAttachedThisTurn: boolean;
};

export type RulesetConfig = {
  id: "current";
  name: string;
  prizeCount: number;
  openingHandSize: number;
  maxBenchSize: number;
};

export type GameState = {
  id: string;
  ruleset: RulesetConfig;
  phase: GamePhase;
  turn: {
    playerId: PlayerId;
    number: number;
  };
  cards: Record<string, CardDefinition>;
  instances: Record<string, CardInstance>;
  players: Record<PlayerId, PlayerState>;
  playerOrder: PlayerId[];
  pendingPromotionPlayerId?: PlayerId;
  pendingChoice?: PendingChoice;
  eventSeq: number;
  winner?: PlayerId;
  seed: string;
};

export type PendingChoice = {
  id: string;
  playerId: PlayerId;
  kind: "DISCARD_FROM_HAND" | "SEARCH_DECK" | "SELECT_POKEMON" | "SEARCH_DISCARD" | "OPTIONAL_EFFECT";
  prompt: string;
  minSelections: number;
  maxSelections: number;
  options: ChoiceOption[];
  remainingSteps?: EffectStep[];
  resolution:
    | {
        type: "DISCARD_THEN_DRAW";
        drawCount: number;
        sourceActionId: string;
      }
    | {
        type: "MOVE_FROM_DECK_TO_HAND";
        shuffleAfter: boolean;
        sourceActionId: string;
      }
    | {
        type: "DAMAGE_TO_SELECTED_POKEMON";
        amount: number;
        sourceActionId: string;
      }
    | {
        type: "MOVE_FROM_DISCARD_TO_HAND";
        sourceActionId: string;
      }
    | {
        type: "MOVE_FROM_DISCARD_TO_DECK";
        shuffleAfter: boolean;
        sourceActionId: string;
      }
    | {
        type: "OPTIONAL_EFFECT";
        yesSteps: EffectStep[];
        sourceActionId: string;
      };
};

export type ChoiceOption = {
  id: string;
  label: string;
  cardInstanceId?: string;
};

export type ActionTarget =
  | { playerId: PlayerId; zone: "active" }
  | { playerId: PlayerId; zone: "bench"; index: number };

export type GameAction =
  | {
      playerId: PlayerId;
      type: "PLACE_ACTIVE";
      payload: { cardInstanceId: string };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "PLACE_BENCH";
      payload: { cardInstanceId: string };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "START_GAME";
      payload: Record<string, never>;
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "TAKE_MULLIGAN_DRAWS";
      payload: { count: number };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "ATTACH_ENERGY";
      payload: { cardInstanceId: string; target: ActionTarget };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "PROMOTE_ACTIVE";
      payload: { benchIndex: number };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "RESOLVE_CHOICE";
      payload: { choiceId: string; selectedOptionIds: string[] };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "EVOLVE";
      payload: { evolutionCardInstanceId: string; target: ActionTarget };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "RETREAT";
      payload: { benchIndex: number; energyCardInstanceIds: string[] };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "PLAY_TRAINER";
      payload: { cardInstanceId: string };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "ATTACK";
      payload: { attackIndex: number };
      clientActionId: string;
    }
  | {
      playerId: PlayerId;
      type: "PASS_TURN";
      payload: Record<string, never>;
      clientActionId: string;
    };

export type GameEvent = {
  seq: number;
  type:
    | "GAME_CREATED"
    | "MULLIGAN_TAKEN"
    | "MULLIGAN_CARDS_DRAWN"
    | "CARD_MOVED"
    | "GAME_STARTED"
    | "CHOICE_REQUESTED"
    | "CHOICE_RESOLVED"
    | "DECK_SHUFFLED"
    | "POKEMON_PROMOTED"
    | "POKEMON_EVOLVED"
    | "POKEMON_RETREATED"
    | "ENERGY_ATTACHED"
    | "TRAINER_PLAYED"
    | "CARD_DRAWN"
    | "DAMAGE_PLACED"
    | "POKEMON_KNOCKED_OUT"
    | "PRIZE_TAKEN"
    | "TURN_PASSED"
    | "GAME_OVER";
  payload: Record<string, unknown>;
  visibility: "public" | { playerId: PlayerId };
  sourceActionId?: string;
};

export type GameError = {
  code: string;
  message: string;
};

export type ResolveResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: GameError; state: GameState };

export type LegalActionDescriptor = {
  type: GameAction["type"];
  payload?: Record<string, unknown>;
};

export type EffectDefinition = {
  id: string;
  trigger: "trainer-played" | "attack";
  steps: EffectStep[];
};

export type EffectStep =
  | { type: "draw"; player: "self"; count: number }
  | { type: "damage"; target: "opponent-active"; amount: number }
  | { type: "choice"; kind: "DISCARD_FROM_HAND"; count: number; then: { type: "draw"; count: number } }
  | {
      type: "choice";
      kind: "SEARCH_DECK";
      count: number;
      minCount?: number;
      filter: { supertype?: CardDefinition["supertype"]; subtypes?: string[] }[];
      then: { type: "move-to-hand"; shuffleAfter: boolean };
    }
  | {
      type: "choice";
      kind: "SELECT_POKEMON";
      count: number;
      filter: { player: "self" | "opponent"; zones: ("active" | "bench")[] };
      then: { type: "damage-to-selected"; amount: number };
    }
  | {
      type: "choice";
      kind: "SEARCH_DISCARD";
      count: number;
      minCount?: number;
      filter: { supertype?: CardDefinition["supertype"]; subtypes?: string[] }[];
      then: { type: "move-to-hand" } | { type: "move-to-deck"; shuffleAfter: boolean };
    }
  | { type: "choice"; kind: "OPTIONAL_EFFECT"; prompt: string; then: EffectStep[] };

export type PublicPlayerState = Omit<PlayerState, "hand" | "deck" | "prizes"> & {
  hand: string[] | { count: number };
  deck: string[] | { count: number };
  prizes: string[] | { count: number };
};

export type PublicGameState = Omit<GameState, "players"> & {
  players: Record<PlayerId, PublicPlayerState>;
};

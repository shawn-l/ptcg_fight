import type { CardDefinition } from "@ptcg-fight/cards";
import type {
  ActionTarget,
  GameAction,
  GameEvent,
  GameState,
  LegalActionDescriptor,
  PlayerId,
  PokemonSlot,
  ResolveResult
} from "./types";
import { cloneState } from "./state";
import { applyEffect, applyEffectSteps } from "./effects";
import { moveTopDeckCardToHand, nextEvent, placeDamageOnActive, placeDamageOnSlot } from "./mutations";

export function getLegalActions(state: GameState, playerId: PlayerId): LegalActionDescriptor[] {
  const player = state.players[playerId];
  if (!player) return [];

  if (state.pendingChoice) {
    if (state.pendingChoice.playerId !== playerId) return [];
    return [{ type: "RESOLVE_CHOICE", payload: { choiceId: state.pendingChoice.id } }];
  }

  if (state.pendingPromotionPlayerId) {
    if (state.pendingPromotionPlayerId !== playerId) return [];
    return player.bench.map((_slot, benchIndex) => ({ type: "PROMOTE_ACTIVE", payload: { benchIndex } }));
  }

  if (state.phase === "setup") {
    const actions: LegalActionDescriptor[] = [];
    if (player.pendingMulliganDraws > 0) {
      actions.push({ type: "TAKE_MULLIGAN_DRAWS", payload: { count: player.pendingMulliganDraws } });
      actions.push({ type: "TAKE_MULLIGAN_DRAWS", payload: { count: 0 } });
    }
    if (!player.active) {
      for (const cardInstanceId of player.hand) {
        if (isBasicPokemon(state, cardInstanceId)) {
          actions.push({ type: "PLACE_ACTIVE", payload: { cardInstanceId } });
        }
      }
    }
    if (player.bench.length < state.ruleset.maxBenchSize) {
      for (const cardInstanceId of player.hand) {
        if (isBasicPokemon(state, cardInstanceId)) {
          actions.push({ type: "PLACE_BENCH", payload: { cardInstanceId } });
        }
      }
    }
    if (allPlayersHaveActive(state) && allMulliganDrawsResolved(state)) {
      actions.push({ type: "START_GAME" });
    }
    return actions;
  }

  if (state.phase !== "main" || state.turn.playerId !== playerId) {
    return [];
  }

  const actions: LegalActionDescriptor[] = [{ type: "PASS_TURN" }];
  if (player.bench.length < state.ruleset.maxBenchSize) {
    for (const cardInstanceId of player.hand) {
      if (isBasicPokemon(state, cardInstanceId)) {
        actions.push({ type: "PLACE_BENCH", payload: { cardInstanceId } });
      }
    }
  }
  if (!player.energyAttachedThisTurn) {
    for (const cardInstanceId of player.hand) {
      if (getCardForInstance(state, cardInstanceId)?.supertype === "Energy" && player.active) {
        actions.push({
          type: "ATTACH_ENERGY",
          payload: { cardInstanceId, target: { playerId, zone: "active" } }
        });
      }
    }
  }
  for (const cardInstanceId of player.hand) {
    const card = getCardForInstance(state, cardInstanceId);
    if (card?.supertype === "Trainer" && canPlayTrainerThisTurn(state, playerId, card)) {
      actions.push({ type: "PLAY_TRAINER", payload: { cardInstanceId } });
    }
    if (card?.supertype === "Pokemon" && !card.subtypes.includes("Basic")) {
      for (const target of evolutionTargetsForCard(state, playerId, card)) {
        actions.push({ type: "EVOLVE", payload: { evolutionCardInstanceId: cardInstanceId, target } });
      }
    }
  }
  if (player.active && player.bench.length > 0 && !player.retreatedThisTurn) {
    const activeCard = getCardForInstance(state, player.active.cardInstanceId);
    const retreatCost = activeCard?.retreatCost ?? 0;
    if (player.active.attachedEnergy.length >= retreatCost) {
      actions.push({
        type: "RETREAT",
        payload: { benchIndex: 0, energyCardInstanceIds: player.active.attachedEnergy.slice(0, retreatCost) }
      });
    }
  }
  if (player.active && canAttackThisTurn(state, playerId)) {
    const activeCard = getCardForInstance(state, player.active.cardInstanceId);
    const attackDefinition = activeCard?.attacks?.[0];
    if (attackDefinition && hasEnoughEnergyForAttack(state, player.active, attackDefinition.cost)) {
      actions.push({ type: "ATTACK", payload: { attackIndex: 0 } });
    }
  }
  return actions;
}

export function resolveAction(state: GameState, action: GameAction): ResolveResult {
  if (!state.players[action.playerId]) {
    return failure(state, "UNKNOWN_PLAYER", `Unknown player: ${action.playerId}`);
  }
  if (state.phase === "game-over") {
    return failure(state, "GAME_ALREADY_OVER", "The game is already over");
  }
  if (state.pendingChoice && action.type !== "RESOLVE_CHOICE") {
    return failure(state, "CHOICE_REQUIRED", "A pending choice must be resolved before other actions");
  }
  if (state.pendingChoice && action.playerId !== state.pendingChoice.playerId) {
    return failure(state, "CHOICE_REQUIRED", "The pending player must resolve the choice");
  }
  if (state.pendingPromotionPlayerId && action.type !== "PROMOTE_ACTIVE") {
    return failure(state, "PROMOTION_REQUIRED", "A knocked-out Active Pokemon must be replaced before other actions");
  }
  if (state.pendingPromotionPlayerId && action.playerId !== state.pendingPromotionPlayerId) {
    return failure(state, "PROMOTION_REQUIRED", "The pending player must promote a new Active Pokemon");
  }

  const next = cloneState(state);
  const events: GameEvent[] = [];

  const setupOnly =
    action.type === "PLACE_ACTIVE" ||
    action.type === "PLACE_BENCH" ||
    action.type === "START_GAME" ||
    action.type === "TAKE_MULLIGAN_DRAWS";
  if (next.phase === "setup" && !setupOnly) {
    return failure(state, "ACTION_NOT_ALLOWED_IN_SETUP", `${action.type} is not legal during setup`);
  }
  if (next.phase === "main" && action.type !== "PROMOTE_ACTIVE" && next.turn.playerId !== action.playerId) {
    return failure(state, "NOT_YOUR_TURN", "Only the current player may act");
  }

  switch (action.type) {
    case "PLACE_ACTIVE":
      return placeActive(next, action, events);
    case "PLACE_BENCH":
      return placeBench(next, action, events);
    case "START_GAME":
      return startGame(next, action, events);
    case "TAKE_MULLIGAN_DRAWS":
      return takeMulliganDraws(next, action, events);
    case "ATTACH_ENERGY":
      return attachEnergy(next, action, events);
    case "RESOLVE_CHOICE":
      return resolveChoice(next, action, events);
    case "PROMOTE_ACTIVE":
      return promoteActive(next, action, events);
    case "PLAY_TRAINER":
      return playTrainer(next, action, events);
    case "EVOLVE":
      return evolve(next, action, events);
    case "RETREAT":
      return retreat(next, action, events);
    case "ATTACK":
      return attack(next, action, events);
    case "PASS_TURN":
      return passTurn(next, action, events);
  }
}

function placeActive(
  state: GameState,
  action: Extract<GameAction, { type: "PLACE_ACTIVE" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  if (player.active) {
    return failure(state, "ACTIVE_ALREADY_SET", "Active Pokemon is already set");
  }
  if (!player.hand.includes(action.payload.cardInstanceId)) {
    return failure(state, "CARD_NOT_IN_HAND", "Card is not in hand");
  }
  if (!isBasicPokemon(state, action.payload.cardInstanceId)) {
    return failure(state, "NOT_BASIC_POKEMON", "Only Basic Pokemon can be placed active in setup");
  }

  player.hand = player.hand.filter((id) => id !== action.payload.cardInstanceId);
  player.active = createPokemonSlot(action.payload.cardInstanceId, state.turn.number);
  events.push(
    nextEvent(state, {
      type: "CARD_MOVED",
      payload: {
        playerId: action.playerId,
        cardInstanceId: action.payload.cardInstanceId,
        from: "hand",
        to: "active"
      },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function placeBench(
  state: GameState,
  action: Extract<GameAction, { type: "PLACE_BENCH" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  if (player.bench.length >= state.ruleset.maxBenchSize) {
    return failure(state, "BENCH_FULL", "Bench is full");
  }
  if (!player.hand.includes(action.payload.cardInstanceId)) {
    return failure(state, "CARD_NOT_IN_HAND", "Card is not in hand");
  }
  if (!isBasicPokemon(state, action.payload.cardInstanceId)) {
    return failure(state, "NOT_BASIC_POKEMON", "Only Basic Pokemon can be placed on the bench");
  }

  player.hand = player.hand.filter((id) => id !== action.payload.cardInstanceId);
  player.bench.push(createPokemonSlot(action.payload.cardInstanceId, state.turn.number));
  events.push(
    nextEvent(state, {
      type: "CARD_MOVED",
      payload: {
        playerId: action.playerId,
        cardInstanceId: action.payload.cardInstanceId,
        from: "hand",
        to: "bench",
        benchIndex: player.bench.length - 1
      },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function startGame(
  state: GameState,
  action: Extract<GameAction, { type: "START_GAME" }>,
  events: GameEvent[]
): ResolveResult {
  if (!allPlayersHaveActive(state)) {
    return failure(state, "SETUP_INCOMPLETE", "Both players must have an Active Pokemon");
  }
  if (!allMulliganDrawsResolved(state)) {
    return failure(state, "MULLIGAN_DRAWS_PENDING", "All mulligan bonus draws must be taken or declined before starting");
  }

  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    for (let count = 0; count < state.ruleset.prizeCount; count += 1) {
      const prize = player.deck.shift();
      if (prize) {
        player.prizes.push(prize);
        events.push(
          nextEvent(state, {
            type: "CARD_MOVED",
            payload: { playerId, from: "deck", to: "prizes" },
            visibility: { playerId },
            sourceActionId: action.clientActionId
          })
        );
      }
    }
  }
  state.phase = "main";
  events.push(
    nextEvent(state, {
      type: "GAME_STARTED",
      payload: { firstPlayerId: state.turn.playerId },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function takeMulliganDraws(
  state: GameState,
  action: Extract<GameAction, { type: "TAKE_MULLIGAN_DRAWS" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  const count = action.payload.count;
  if (!Number.isInteger(count) || count < 0) {
    return failure(state, "INVALID_MULLIGAN_DRAW_COUNT", "Mulligan draw count must be a non-negative integer");
  }
  if (count > player.pendingMulliganDraws) {
    return failure(state, "TOO_MANY_MULLIGAN_DRAWS", "Cannot draw more than the pending mulligan bonus");
  }

  const drawn: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const cardInstanceId = player.deck.shift();
    if (!cardInstanceId) break;
    player.hand.push(cardInstanceId);
    drawn.push(cardInstanceId);
  }
  player.pendingMulliganDraws = 0;
  events.push(
    nextEvent(state, {
      type: "MULLIGAN_CARDS_DRAWN",
      payload: { playerId: action.playerId, requestedCount: count, drawnCount: drawn.length, cardInstanceIds: drawn },
      visibility: { playerId: action.playerId },
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function attachEnergy(
  state: GameState,
  action: Extract<GameAction, { type: "ATTACH_ENERGY" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  const card = getCardForInstance(state, action.payload.cardInstanceId);
  if (!player.hand.includes(action.payload.cardInstanceId)) {
    return failure(state, "CARD_NOT_IN_HAND", "Energy card is not in hand");
  }
  if (card?.supertype !== "Energy") {
    return failure(state, "NOT_ENERGY", "Only Energy cards can be attached with this action");
  }
  if (player.energyAttachedThisTurn) {
    return failure(state, "ENERGY_ALREADY_ATTACHED", "Only one Energy may be attached each turn");
  }

  const slot = resolveTargetSlot(state, action.payload.target);
  if (!slot) {
    return failure(state, "INVALID_TARGET", "Energy target does not exist");
  }

  player.hand = player.hand.filter((id) => id !== action.payload.cardInstanceId);
  slot.attachedEnergy.push(action.payload.cardInstanceId);
  player.energyAttachedThisTurn = true;
  events.push(
    nextEvent(state, {
      type: "ENERGY_ATTACHED",
      payload: {
        playerId: action.playerId,
        cardInstanceId: action.payload.cardInstanceId,
        target: action.payload.target
      },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function resolveChoice(
  state: GameState,
  action: Extract<GameAction, { type: "RESOLVE_CHOICE" }>,
  events: GameEvent[]
): ResolveResult {
  const choice = state.pendingChoice;
  if (!choice) return failure(state, "NO_CHOICE_PENDING", "There is no pending choice to resolve");
  if (choice.id !== action.payload.choiceId) {
    return failure(state, "CHOICE_MISMATCH", "Choice id does not match the pending choice");
  }
  if (choice.playerId !== action.playerId) {
    return failure(state, "CHOICE_REQUIRED", "The pending player must resolve the choice");
  }

  const selectedOptionIds = action.payload.selectedOptionIds;
  if (
    selectedOptionIds.length < choice.minSelections ||
    selectedOptionIds.length > choice.maxSelections ||
    new Set(selectedOptionIds).size !== selectedOptionIds.length
  ) {
    return failure(state, "INVALID_CHOICE_SELECTION", "Choice selection count is invalid");
  }
  const optionIds = new Set(choice.options.map((option) => option.id));
  if (selectedOptionIds.some((optionId) => !optionIds.has(optionId))) {
    return failure(state, "INVALID_CHOICE_SELECTION", "Choice selection contains an invalid option");
  }

  if (choice.resolution.type === "DISCARD_THEN_DRAW") {
    const player = state.players[action.playerId];
    for (const optionId of selectedOptionIds) {
      const option = choice.options.find((candidate) => candidate.id === optionId);
      if (!option?.cardInstanceId || !player.hand.includes(option.cardInstanceId)) {
        return failure(state, "INVALID_CHOICE_SELECTION", "Selected card is no longer in hand");
      }
      player.hand = player.hand.filter((cardInstanceId) => cardInstanceId !== option.cardInstanceId);
      player.discard.push(option.cardInstanceId);
    }
    state.pendingChoice = undefined;
    events.push(
      nextEvent(state, {
        type: "CHOICE_RESOLVED",
        payload: { choiceId: choice.id, playerId: action.playerId, selectedOptionIds },
        visibility: { playerId: action.playerId },
        sourceActionId: action.clientActionId
      })
    );

    for (let index = 0; index < choice.resolution.drawCount; index += 1) {
      const drawn = moveTopDeckCardToHand(state, action.playerId);
      if (!drawn) break;
      events.push(
        nextEvent(state, {
          type: "CARD_DRAWN",
          payload: { playerId: action.playerId, cardInstanceId: drawn },
          visibility: { playerId: action.playerId },
          sourceActionId: action.clientActionId
        })
      );
    }
  }

  if (choice.resolution.type === "MOVE_FROM_DECK_TO_HAND") {
    const player = state.players[action.playerId];
    const selectedOptions = selectedOptionIds.map((optionId) =>
      choice.options.find((candidate) => candidate.id === optionId)
    );
    for (const option of selectedOptions) {
      if (!option?.cardInstanceId || !player.deck.includes(option.cardInstanceId)) {
        return failure(state, "INVALID_CHOICE_SELECTION", "Selected card is no longer in deck");
      }
    }

    state.pendingChoice = undefined;
    events.push(
      nextEvent(state, {
        type: "CHOICE_RESOLVED",
        payload: { choiceId: choice.id, playerId: action.playerId, selectedOptionIds },
        visibility: { playerId: action.playerId },
        sourceActionId: action.clientActionId
      })
    );

    for (const option of selectedOptions) {
      const cardInstanceId = option?.cardInstanceId;
      if (!cardInstanceId) continue;
      player.deck = player.deck.filter((candidate) => candidate !== cardInstanceId);
      player.hand.push(cardInstanceId);
      events.push(
        nextEvent(state, {
          type: "CARD_MOVED",
          payload: { playerId: action.playerId, cardInstanceId, from: "deck", to: "hand" },
          visibility: { playerId: action.playerId },
          sourceActionId: action.clientActionId
        })
      );
    }

    if (choice.resolution.shuffleAfter) {
      player.deck = shuffleDeckDeterministically(player.deck, `${state.seed}:${choice.id}:${action.clientActionId}`);
      events.push(
        nextEvent(state, {
          type: "DECK_SHUFFLED",
          payload: { playerId: action.playerId },
          visibility: "public",
          sourceActionId: action.clientActionId
        })
      );
    }
  }

  if (choice.resolution.type === "DAMAGE_TO_SELECTED_POKEMON") {
    for (const optionId of selectedOptionIds) {
      const slot = resolveSlotFromChoiceOptionId(state, optionId);
      if (!slot) {
        return failure(
          state,
          "INVALID_CHOICE_SELECTION",
          "Selected Pokemon slot no longer exists"
        );
      }
      const option = choice.options.find((c) => c.id === optionId);
      if (option?.cardInstanceId && slot.cardInstanceId !== option.cardInstanceId) {
        return failure(
          state,
          "INVALID_CHOICE_SELECTION",
          "Pokemon in selected slot has changed"
        );
      }
    }

    state.pendingChoice = undefined;
    events.push(
      nextEvent(state, {
        type: "CHOICE_RESOLVED",
        payload: { choiceId: choice.id, playerId: action.playerId, selectedOptionIds },
        visibility: { playerId: action.playerId },
        sourceActionId: action.clientActionId
      })
    );

    for (const optionId of selectedOptionIds) {
      const slot = resolveSlotFromChoiceOptionId(state, optionId);
      if (!slot) continue;
      const parsed = parseChoiceOptionId(optionId);
      placeDamageOnSlot(slot, choice.resolution.amount);
      events.push(
        nextEvent(state, {
          type: "DAMAGE_PLACED",
          payload: {
            playerId: parsed.playerId,
            amount: choice.resolution.amount,
            totalDamage: slot.damage,
            target: parsed.zone === "active"
              ? { playerId: parsed.playerId, zone: "active" as const }
              : { playerId: parsed.playerId, zone: "bench" as const, index: parsed.index! }
          },
          visibility: "public",
          sourceActionId: action.clientActionId
        })
      );
    }

    checkKnockOuts(state, events, action.clientActionId, action.playerId);
  }

  if (choice.resolution.type === "MOVE_FROM_DISCARD_TO_HAND") {
    const player = state.players[action.playerId];
    const selectedOptions = selectedOptionIds.map((optionId) =>
      choice.options.find((c) => c.id === optionId)
    );
    for (const option of selectedOptions) {
      if (!option?.cardInstanceId || !player.discard.includes(option.cardInstanceId)) {
        return failure(state, "INVALID_CHOICE_SELECTION", "Selected card is no longer in discard");
      }
    }

    state.pendingChoice = undefined;
    events.push(
      nextEvent(state, {
        type: "CHOICE_RESOLVED",
        payload: { choiceId: choice.id, playerId: action.playerId, selectedOptionIds },
        visibility: { playerId: action.playerId },
        sourceActionId: action.clientActionId
      })
    );

    for (const option of selectedOptions) {
      const cardInstanceId = option?.cardInstanceId;
      if (!cardInstanceId) continue;
      player.discard = player.discard.filter((c) => c !== cardInstanceId);
      player.hand.push(cardInstanceId);
      events.push(
        nextEvent(state, {
          type: "CARD_MOVED",
          payload: { playerId: action.playerId, cardInstanceId, from: "discard", to: "hand" },
          visibility: "public",
          sourceActionId: action.clientActionId
        })
      );
    }
  }

  if (choice.resolution.type === "MOVE_FROM_DISCARD_TO_DECK") {
    const player = state.players[action.playerId];
    const selectedOptions = selectedOptionIds.map((optionId) =>
      choice.options.find((c) => c.id === optionId)
    );
    for (const option of selectedOptions) {
      if (!option?.cardInstanceId || !player.discard.includes(option.cardInstanceId)) {
        return failure(state, "INVALID_CHOICE_SELECTION", "Selected card is no longer in discard");
      }
    }

    state.pendingChoice = undefined;
    events.push(
      nextEvent(state, {
        type: "CHOICE_RESOLVED",
        payload: { choiceId: choice.id, playerId: action.playerId, selectedOptionIds },
        visibility: { playerId: action.playerId },
        sourceActionId: action.clientActionId
      })
    );

    for (const option of selectedOptions) {
      const cardInstanceId = option?.cardInstanceId;
      if (!cardInstanceId) continue;
      player.discard = player.discard.filter((c) => c !== cardInstanceId);
      player.deck.push(cardInstanceId);
      events.push(
        nextEvent(state, {
          type: "CARD_MOVED",
          payload: { playerId: action.playerId, cardInstanceId, from: "discard", to: "deck" },
          visibility: { playerId: action.playerId },
          sourceActionId: action.clientActionId
        })
      );
    }

    if (choice.resolution.shuffleAfter) {
      player.deck = shuffleDeckDeterministically(player.deck, `${state.seed}:${choice.id}:${action.clientActionId}`);
      events.push(
        nextEvent(state, {
          type: "DECK_SHUFFLED",
          payload: { playerId: action.playerId },
          visibility: "public",
          sourceActionId: action.clientActionId
        })
      );
    }
  }

  if (choice.resolution.type === "OPTIONAL_EFFECT") {
    state.pendingChoice = undefined;
    if (selectedOptionIds.includes("yes")) {
      events.push(...applyEffectSteps(state, choice.resolution.yesSteps, action.playerId, action.clientActionId));
    } else {
      choice.remainingSteps = undefined;
    }
    events.push(
      nextEvent(state, {
        type: "CHOICE_RESOLVED",
        payload: { choiceId: choice.id, playerId: action.playerId, selectedOptionIds },
        visibility: { playerId: action.playerId },
        sourceActionId: action.clientActionId
      })
    );
  }

  if (choice.remainingSteps && choice.remainingSteps.length > 0) {
    if (state.pendingChoice) {
      state.pendingChoice.remainingSteps = [
        ...choice.remainingSteps,
        ...(state.pendingChoice.remainingSteps ?? [])
      ];
    } else {
      events.push(...applyEffectSteps(state, choice.remainingSteps, action.playerId, action.clientActionId));
    }
  }

  return { ok: true, state, events };
}

function promoteActive(
  state: GameState,
  action: Extract<GameAction, { type: "PROMOTE_ACTIVE" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  if (state.pendingPromotionPlayerId !== action.playerId) {
    return failure(state, "NO_PROMOTION_PENDING", "This player does not need to promote an Active Pokemon");
  }
  const promoted = player.bench[action.payload.benchIndex];
  if (!promoted) {
    return failure(state, "INVALID_TARGET", "Bench target does not exist");
  }
  player.active = promoted;
  player.bench.splice(action.payload.benchIndex, 1);
  state.pendingPromotionPlayerId = undefined;
  events.push(
    nextEvent(state, {
      type: "POKEMON_PROMOTED",
      payload: { playerId: action.playerId, promotedBenchIndex: action.payload.benchIndex },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return passTurn(state, { playerId: action.playerId, type: "PASS_TURN", payload: {}, clientActionId: action.clientActionId }, events);
}

function playTrainer(
  state: GameState,
  action: Extract<GameAction, { type: "PLAY_TRAINER" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  const card = getCardForInstance(state, action.payload.cardInstanceId);
  if (!player.hand.includes(action.payload.cardInstanceId)) {
    return failure(state, "CARD_NOT_IN_HAND", "Trainer card is not in hand");
  }
  if (card?.supertype !== "Trainer") {
    return failure(state, "NOT_TRAINER", "Only Trainer cards can be played with this action");
  }
  if (!canPlayTrainerThisTurn(state, action.playerId, card)) {
    return failure(
      state,
      "FIRST_TURN_SUPPORTER_NOT_ALLOWED",
      "The starting player cannot play Supporter cards on the first turn"
    );
  }
  if (card.subtypes.includes("Supporter") && player.supporterUsedThisTurn) {
    return failure(state, "SUPPORTER_ALREADY_USED", "Only one Supporter may be played each turn");
  }

  player.hand = player.hand.filter((id) => id !== action.payload.cardInstanceId);
  player.discard.push(action.payload.cardInstanceId);
  if (card.subtypes.includes("Supporter")) player.supporterUsedThisTurn = true;
  events.push(
    nextEvent(state, {
      type: "TRAINER_PLAYED",
      payload: { playerId: action.playerId, cardInstanceId: action.payload.cardInstanceId },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  for (const effectRef of card.effectRefs) {
    events.push(...applyEffect(state, effectRef, action.playerId, action.clientActionId));
  }
  return { ok: true, state, events };
}

function evolve(
  state: GameState,
  action: Extract<GameAction, { type: "EVOLVE" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  if (!player.hand.includes(action.payload.evolutionCardInstanceId)) {
    return failure(state, "CARD_NOT_IN_HAND", "Evolution card is not in hand");
  }
  const evolutionCard = getCardForInstance(state, action.payload.evolutionCardInstanceId);
  if (!evolutionCard || evolutionCard.supertype !== "Pokemon" || evolutionCard.subtypes.includes("Basic")) {
    return failure(state, "NOT_EVOLUTION_POKEMON", "Card is not an Evolution Pokemon");
  }

  const slot = resolveTargetSlot(state, action.payload.target);
  if (!slot) return failure(state, "INVALID_TARGET", "Evolution target does not exist");
  if (!canEvolveSlotThisTurn(state, slot)) {
    return failure(state, "CANNOT_EVOLVE_THIS_TURN", "Pokemon cannot evolve on the turn it entered play or already evolved");
  }

  const currentCard = getCardForInstance(state, slot.cardInstanceId);
  if (!currentCard || evolutionCard.evolvesFrom !== currentCard.languageRefs.en.name) {
    return failure(state, "EVOLUTION_MISMATCH", "Evolution card does not evolve from that Pokemon");
  }

  player.hand = player.hand.filter((id) => id !== action.payload.evolutionCardInstanceId);
  slot.evolution.push(slot.cardInstanceId);
  slot.cardInstanceId = action.payload.evolutionCardInstanceId;
  slot.specialConditions = [];
  slot.evolvedThisTurn = true;
  events.push(
    nextEvent(state, {
      type: "POKEMON_EVOLVED",
      payload: {
        playerId: action.playerId,
        evolutionCardInstanceId: action.payload.evolutionCardInstanceId,
        target: action.payload.target
      },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function retreat(
  state: GameState,
  action: Extract<GameAction, { type: "RETREAT" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  if (!player.active) return failure(state, "NO_ACTIVE", "Player has no Active Pokemon");
  if (player.retreatedThisTurn) return failure(state, "RETREAT_ALREADY_USED", "Only one retreat is allowed each turn");
  const benchSlot = player.bench[action.payload.benchIndex];
  if (!benchSlot) return failure(state, "INVALID_TARGET", "Bench target does not exist");

  const activeCard = getCardForInstance(state, player.active.cardInstanceId);
  const retreatCost = activeCard?.retreatCost ?? 0;
  if (action.payload.energyCardInstanceIds.length < retreatCost) {
    return failure(state, "NOT_ENOUGH_ENERGY_TO_RETREAT", "Not enough Energy was discarded to retreat");
  }
  for (const energyId of action.payload.energyCardInstanceIds) {
    if (!player.active.attachedEnergy.includes(energyId)) {
      return failure(state, "ENERGY_NOT_ATTACHED", "Retreat cost must use Energy attached to the Active Pokemon");
    }
  }

  const oldActive = player.active;
  oldActive.attachedEnergy = oldActive.attachedEnergy.filter(
    (energyId) => !action.payload.energyCardInstanceIds.includes(energyId)
  );
  player.discard.push(...action.payload.energyCardInstanceIds);
  player.active = benchSlot;
  player.bench[action.payload.benchIndex] = oldActive;
  player.retreatedThisTurn = true;
  events.push(
    nextEvent(state, {
      type: "POKEMON_RETREATED",
      payload: {
        playerId: action.playerId,
        promotedBenchIndex: action.payload.benchIndex,
        discardedEnergy: action.payload.energyCardInstanceIds
      },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  return { ok: true, state, events };
}

function attack(
  state: GameState,
  action: Extract<GameAction, { type: "ATTACK" }>,
  events: GameEvent[]
): ResolveResult {
  const player = state.players[action.playerId];
  if (!player.active) return failure(state, "NO_ACTIVE", "Attacking player has no Active Pokemon");
  if (!canAttackThisTurn(state, action.playerId)) {
    return failure(
      state,
      "FIRST_TURN_ATTACK_NOT_ALLOWED",
      "The starting player cannot attack on the first turn"
    );
  }
  const activeCard = getCardForInstance(state, player.active.cardInstanceId);
  const attackDefinition = activeCard?.attacks?.[action.payload.attackIndex];
  if (!attackDefinition) {
    return failure(state, "UNKNOWN_ATTACK", "Attack does not exist");
  }
  if (!hasEnoughEnergyForAttack(state, player.active, attackDefinition.cost)) {
    return failure(state, "NOT_ENOUGH_ENERGY_TO_ATTACK", "Not enough attached Energy to use this attack");
  }

  if (attackDefinition.damage) {
    const opponentId = state.playerOrder.find((id) => id !== action.playerId);
    if (!opponentId) return failure(state, "NO_OPPONENT", "Opponent does not exist");
    const damageAmount = calculateAttackDamage(state, activeCard, attackDefinition.damage, opponentId);
    const damage = placeDamageOnActive(state, opponentId, damageAmount.amount);
    if (!damage) return failure(state, "NO_TARGET", "Opponent has no Active Pokemon");
    events.push(
      nextEvent(state, {
        type: "DAMAGE_PLACED",
        payload: {
          playerId: opponentId,
          amount: damageAmount.amount,
          baseDamage: attackDefinition.damage,
          weaknessApplied: damageAmount.weaknessApplied,
          resistanceApplied: damageAmount.resistanceApplied,
          totalDamage: damage.totalDamage
        },
        visibility: "public",
        sourceActionId: action.clientActionId
      })
    );
    checkKnockOuts(state, events, action.clientActionId, action.playerId);
  }
  if (attackDefinition.effectRef) {
    events.push(...applyEffect(state, attackDefinition.effectRef, action.playerId, action.clientActionId));
  }

  if (state.pendingChoice) {
    return { ok: true, state, events };
  }

  if (state.phase === "game-over") {
    return { ok: true, state, events };
  }
  if (state.pendingPromotionPlayerId) {
    return { ok: true, state, events };
  }
  return passTurn(state, { ...action, type: "PASS_TURN", payload: {} }, events);
}

function passTurn(
  state: GameState,
  action: Extract<GameAction, { type: "PASS_TURN" }>,
  events: GameEvent[]
): ResolveResult {
  const currentIndex = state.playerOrder.indexOf(state.turn.playerId);
  const nextPlayerId = state.playerOrder[(currentIndex + 1) % state.playerOrder.length];
  state.turn = { playerId: nextPlayerId, number: state.turn.number + 1 };
  for (const player of Object.values(state.players)) {
    player.energyAttachedThisTurn = false;
    player.supporterUsedThisTurn = false;
    player.retreatedThisTurn = false;
    for (const slot of [player.active, ...player.bench]) {
      if (slot) slot.evolvedThisTurn = false;
    }
  }
  events.push(
    nextEvent(state, {
      type: "TURN_PASSED",
      payload: { nextPlayerId },
      visibility: "public",
      sourceActionId: action.clientActionId
    })
  );
  const drawResult = drawCardForStartOfTurn(state, nextPlayerId, action.clientActionId);
  events.push(...drawResult.events);
  if (!drawResult.ok) {
    const winner = state.playerOrder.find((id) => id !== nextPlayerId);
    if (winner) {
      endGame(state, events, winner, "CANNOT_DRAW_AT_START_OF_TURN", action.clientActionId);
    }
  }
  return { ok: true, state, events };
}

function checkKnockOuts(state: GameState, events: GameEvent[], sourceActionId: string, attackingPlayerId: PlayerId): void {
  for (const player of Object.values(state.players)) {
    if (player.active) {
      const card = getCardForInstance(state, player.active.cardInstanceId);
      if (card?.hp && player.active.damage >= card.hp) {
        handleKnockOut(state, events, player.id, player.active, "active", -1, sourceActionId, attackingPlayerId);
      }
    }
    for (let i = player.bench.length - 1; i >= 0; i--) {
      const slot = player.bench[i];
      const card = getCardForInstance(state, slot.cardInstanceId);
      if (card?.hp && slot.damage >= card.hp) {
        handleKnockOut(state, events, player.id, slot, "bench", i, sourceActionId, attackingPlayerId);
      }
    }
  }
}

function handleKnockOut(
  state: GameState,
  events: GameEvent[],
  playerId: PlayerId,
  slot: PokemonSlot,
  zone: "active" | "bench",
  benchIndex: number,
  sourceActionId: string,
  attackingPlayerId: PlayerId
): void {
  const player = state.players[playerId];
  const prizesToTake = getPrizeCardsForKnockOut(state, slot);
  player.discard.push(...slot.evolution, slot.cardInstanceId, ...slot.attachedEnergy);

  if (zone === "active") {
    player.active = undefined;
  } else {
    player.bench.splice(benchIndex, 1);
  }

  events.push(
    nextEvent(state, {
      type: "POKEMON_KNOCKED_OUT",
      payload: {
        playerId,
        cardInstanceId: slot.cardInstanceId,
        ...(zone === "bench" ? { zone: "bench", benchIndex } : {})
      },
      visibility: "public",
      sourceActionId
    })
  );

  const attacker = state.players[attackingPlayerId];
  const takenPrizeCards = attacker.prizes.splice(0, prizesToTake);
  if (takenPrizeCards.length > 0) {
    attacker.hand.push(...takenPrizeCards);
    events.push(
      nextEvent(state, {
        type: "PRIZE_TAKEN",
        payload: {
          playerId: attackingPlayerId,
          takenCount: takenPrizeCards.length,
          cardInstanceIds: takenPrizeCards,
          remainingPrizes: attacker.prizes.length
        },
        visibility: { playerId: attackingPlayerId },
        sourceActionId
      })
    );
    if (attacker.prizes.length === 0) {
      endGame(state, events, attackingPlayerId, "NO_PRIZES_REMAINING", sourceActionId);
      return;
    }
  }

  if (zone === "active" && state.phase !== "game-over") {
    if (player.bench.length === 0) {
      endGame(state, events, attackingPlayerId, "NO_POKEMON_IN_PLAY", sourceActionId);
    } else {
      state.pendingPromotionPlayerId = playerId;
    }
  }
}

function getPrizeCardsForKnockOut(state: GameState, slot: PokemonSlot): number {
  const card = getCardForInstance(state, slot.cardInstanceId);
  return card?.prizeCardsWhenKnockedOut ?? 1;
}

function drawCardForStartOfTurn(
  state: GameState,
  playerId: PlayerId,
  sourceActionId: string
): { ok: true; events: GameEvent[] } | { ok: false; events: GameEvent[] } {
  const player = state.players[playerId];
  const cardInstanceId = player.deck.shift();
  if (!cardInstanceId) {
    return { ok: false, events: [] };
  }
  player.hand.push(cardInstanceId);
  return {
    ok: true,
    events: [
      nextEvent(state, {
        type: "CARD_DRAWN",
        payload: { playerId, cardInstanceId, reason: "START_OF_TURN" },
        visibility: { playerId },
        sourceActionId
      })
    ]
  };
}

function endGame(
  state: GameState,
  events: GameEvent[],
  winner: PlayerId,
  reason: string,
  sourceActionId: string
): void {
  state.winner = winner;
  state.phase = "game-over";
  state.pendingPromotionPlayerId = undefined;
  events.push(
    nextEvent(state, {
      type: "GAME_OVER",
      payload: { winner, reason },
      visibility: "public",
      sourceActionId
    })
  );
}

function createPokemonSlot(cardInstanceId: string, enteredTurn: number): PokemonSlot {
  return {
    cardInstanceId,
    evolution: [],
    attachedEnergy: [],
    damage: 0,
    specialConditions: [],
    enteredTurn,
    evolvedThisTurn: false
  };
}

function getCardForInstance(state: GameState, cardInstanceId: string): CardDefinition | undefined {
  const instance = state.instances[cardInstanceId];
  return instance ? state.cards[instance.cardId] : undefined;
}

function isBasicPokemon(state: GameState, cardInstanceId: string): boolean {
  const card = getCardForInstance(state, cardInstanceId);
  return card?.supertype === "Pokemon" && card.subtypes.includes("Basic");
}

function allPlayersHaveActive(state: GameState): boolean {
  return state.playerOrder.every((playerId) => Boolean(state.players[playerId].active));
}

function allMulliganDrawsResolved(state: GameState): boolean {
  return state.playerOrder.every((playerId) => state.players[playerId].pendingMulliganDraws === 0);
}

function canEvolveSlotThisTurn(state: GameState, slot: PokemonSlot): boolean {
  return slot.enteredTurn < state.turn.number && !slot.evolvedThisTurn;
}

function evolutionTargetsForCard(state: GameState, playerId: PlayerId, evolutionCard: CardDefinition): ActionTarget[] {
  const player = state.players[playerId];
  const targets: ActionTarget[] = [];
  if (player.active && canEvolveSlotThisTurn(state, player.active)) {
    const activeCard = getCardForInstance(state, player.active.cardInstanceId);
    if (activeCard?.languageRefs.en.name === evolutionCard.evolvesFrom) {
      targets.push({ playerId, zone: "active" });
    }
  }
  player.bench.forEach((slot, index) => {
    if (!canEvolveSlotThisTurn(state, slot)) return;
    const card = getCardForInstance(state, slot.cardInstanceId);
    if (card?.languageRefs.en.name === evolutionCard.evolvesFrom) {
      targets.push({ playerId, zone: "bench", index });
    }
  });
  return targets;
}

function canAttackThisTurn(state: GameState, playerId: PlayerId): boolean {
  const startingPlayerId = state.playerOrder[0];
  return !(state.turn.number === 1 && playerId === startingPlayerId);
}

function hasEnoughEnergyForAttack(state: GameState, slot: PokemonSlot, cost: string[]): boolean {
  const attachedTypes = slot.attachedEnergy
    .map((cardInstanceId) => getCardForInstance(state, cardInstanceId))
    .filter((card): card is CardDefinition => card !== undefined && card.supertype === "Energy")
    .map((card) => card.types?.[0] ?? "Colorless");

  const remainingAttached = [...attachedTypes];
  for (const requiredType of cost.filter((type) => type !== "Colorless")) {
    const matchIndex = remainingAttached.findIndex((type) => type === requiredType);
    if (matchIndex === -1) return false;
    remainingAttached.splice(matchIndex, 1);
  }

  const colorlessCost = cost.filter((type) => type === "Colorless").length;
  return remainingAttached.length >= colorlessCost;
}

function calculateAttackDamage(
  state: GameState,
  attackingCard: CardDefinition,
  baseDamage: number,
  defendingPlayerId: PlayerId
): { amount: number; weaknessApplied: boolean; resistanceApplied: boolean } {
  const defender = state.players[defendingPlayerId];
  const defendingCard = defender.active ? getCardForInstance(state, defender.active.cardInstanceId) : undefined;
  const attackType = attackingCard.types?.[0];
  let amount = baseDamage;
  let weaknessApplied = false;
  let resistanceApplied = false;

  if (attackType && defendingCard?.weakness?.type === attackType) {
    amount *= defendingCard.weakness.multiplier;
    weaknessApplied = true;
  }
  if (attackType && defendingCard?.resistance?.type === attackType) {
    amount = Math.max(0, amount - defendingCard.resistance.reduction);
    resistanceApplied = true;
  }

  return { amount, weaknessApplied, resistanceApplied };
}

function canPlayTrainerThisTurn(state: GameState, playerId: PlayerId, card: CardDefinition): boolean {
  const startingPlayerId = state.playerOrder[0];
  return !(state.turn.number === 1 && playerId === startingPlayerId && card.subtypes.includes("Supporter"));
}

function resolveTargetSlot(state: GameState, target: ActionTarget): PokemonSlot | undefined {
  const player = state.players[target.playerId];
  if (!player) return undefined;
  if (target.zone === "active") return player.active;
  return player.bench[target.index];
}

function parseChoiceOptionId(optionId: string): {
  playerId: string;
  zone: "active" | "bench";
  index?: number;
} {
  const parts = optionId.split(":");
  if (parts.length === 2 && parts[1] === "active") {
    return { playerId: parts[0], zone: "active" };
  }
  if (parts.length === 3 && parts[1] === "bench") {
    const index = parseInt(parts[2], 10);
    if (Number.isNaN(index)) {
      throw new Error(`Invalid bench index in choice option ID: ${optionId}`);
    }
    return { playerId: parts[0], zone: "bench", index };
  }
  throw new Error(`Invalid choice option ID format: ${optionId}`);
}

function resolveSlotFromChoiceOptionId(
  state: GameState,
  optionId: string
): PokemonSlot | undefined {
  try {
    const parsed = parseChoiceOptionId(optionId);
    const player = state.players[parsed.playerId];
    if (!player) return undefined;
    if (parsed.zone === "active") return player.active;
    if (parsed.zone === "bench" && parsed.index !== undefined) {
      return player.bench[parsed.index];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function failure(state: GameState, code: string, message: string): ResolveResult {
  return { ok: false, state, error: { code, message } };
}

function shuffleDeckDeterministically(deck: string[], seed: string): string[] {
  const shuffled = [...deck];
  let randomState = hashString(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    randomState = nextRandomState(randomState);
    const swapIndex = randomState % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function nextRandomState(value: number): number {
  return (value * 1664525 + 1013904223) >>> 0;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

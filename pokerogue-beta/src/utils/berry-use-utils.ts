import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { BerryUseContext } from "#data/berry";
import { CommonAnim } from "#enums/move-anims-common";
import type { BerryType } from "#enums/berry-type";
import { BerryUsedEvent } from "#events/battle-scene";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier, PreserveBerryModifier } from "#modifiers/modifier";
import { BooleanHolder } from "#utils/common";
import i18next from "i18next";

export function canUseBerry(pokemon: Pokemon, queueBlockedMessage = true): boolean {
  if (!pokemon.isActive(true) || pokemon.isFainted()) {
    return false;
  }

  const cancelled = new BooleanHolder(false);
  pokemon.getOpponents().forEach(opp => applyAbAttrs("PreventBerryUseAbAttr", { pokemon: opp, cancelled }));
  if (cancelled.value) {
    if (queueBlockedMessage) {
      globalScene.phaseManager.queueMessage(
        i18next.t("abilityTriggers:preventBerryUse", {
          pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        }),
      );
    }
    return false;
  }

  return true;
}

interface ConsumeBerryModifierOptions {
  readonly animate?: boolean;
  readonly applyBerryUseHealing?: boolean;
}

export function consumeBerryModifier(
  pokemon: Pokemon,
  berryModifier: BerryModifier,
  context: BerryUseContext = { trigger: "turn-end" },
  options: ConsumeBerryModifierOptions = {},
): boolean {
  if (!canUseBerry(pokemon)) {
    return false;
  }

  if (options.animate ?? true) {
    globalScene.phaseManager.unshiftNew(
      "CommonAnimPhase",
      pokemon.getBattlerIndex(),
      pokemon.getBattlerIndex(),
      CommonAnim.USE_ITEM,
    );
  }

  const preserve = new BooleanHolder(false);
  globalScene.applyModifiersForPokemon(PreserveBerryModifier, pokemon, pokemon, preserve);
  const consumed = !preserve.value;

  applyAbAttrs("PostItemLostAbAttr", { pokemon });
  pokemon.recordEatenBerry(berryModifier.berryType, consumed);

  if (consumed) {
    pokemon.loseHeldItem(berryModifier);
    applySymbiosis(pokemon, berryModifier.berryType);
  }
  if (context.trigger !== "turn-end") {
    pokemon.turnData.reactiveBerriesEaten.push(berryModifier.berryType);
  }
  globalScene.eventTarget.dispatchEvent(new BerryUsedEvent(berryModifier));
  globalScene.updateModifiers(
    pokemon.isPlayer(),
    undefined,
    pokemon.isPlayer() ? globalScene.getPlayerIndexForPokemon(pokemon) : undefined,
  );

  if (options.applyBerryUseHealing ?? true) {
    applyAbAttrs("HealFromBerryUseAbAttr", { pokemon });
  }

  return true;
}

export function tryEatBerries(pokemon: Pokemon, context: BerryUseContext = { trigger: "turn-end" }): boolean {
  const hasUsableBerry = !!globalScene.findModifierForPokemon(
    m => m instanceof BerryModifier && m.shouldApply(pokemon, context),
    pokemon,
  );

  if (!hasUsableBerry) {
    return false;
  }

  if (!canUseBerry(pokemon)) {
    return false;
  }

  globalScene.phaseManager.unshiftNew(
    "CommonAnimPhase",
    pokemon.getBattlerIndex(),
    pokemon.getBattlerIndex(),
    CommonAnim.USE_ITEM,
  );

  let ateBerry = false;
  for (const berryModifier of globalScene.applyModifiersForPokemon(BerryModifier, pokemon, pokemon, context)) {
    ateBerry = true;
    if (berryModifier.consumed) {
      berryModifier.consumed = false;
      pokemon.loseHeldItem(berryModifier);
      applySymbiosis(pokemon, berryModifier.berryType);
    }
    if (context.trigger !== "turn-end") {
      pokemon.turnData.reactiveBerriesEaten.push(berryModifier.berryType);
    }
    globalScene.eventTarget.dispatchEvent(new BerryUsedEvent(berryModifier));
  }

  if (!ateBerry) {
    return false;
  }

  globalScene.updateModifiers(
    pokemon.isPlayer(),
    undefined,
    pokemon.isPlayer() ? globalScene.getPlayerIndexForPokemon(pokemon) : undefined,
  );

  applyAbAttrs("HealFromBerryUseAbAttr", { pokemon });
  return true;
}

function applySymbiosis(consumer: Pokemon, berryType: BerryType): void {
  const transferred = new BooleanHolder(false);
  for (const ally of consumer.getAllies()) {
    applyAbAttrs("PostAllyBerryUsedAbAttr", { pokemon: ally, consumer, berryType, transferred });
    if (transferred.value) {
      return;
    }
  }
}

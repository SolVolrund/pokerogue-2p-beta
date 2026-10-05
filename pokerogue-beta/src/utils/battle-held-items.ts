import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { BattleHeldItem } from "#data/pokemon/pokemon-data";
import type { BerryType } from "#enums/berry-type";
import type { Pokemon } from "#field/pokemon";
// biome-ignore lint/performance/noNamespaceImport: Saved class names require the same constructor lookup as session loading.
import * as Modifiers from "#modifiers/modifier";
import { BerryModifierType } from "#modifiers/modifier-type";
import { ModifierData } from "#system/modifier-data";
import i18next from "i18next";

function snapshotItem(pokemon: Pokemon, item: Modifiers.PokemonHeldItemModifier): BattleHeldItem {
  return {
    ...new ModifierData(item, pokemon.isPlayer()),
    args: [...item.getArgs()],
    stackCount: 1,
    waveIndex: globalScene.currentBattle.waveIndex,
    eonFluteGuestItem: item.eonFluteGuestItem,
  };
}

export function createBattleHeldItem(
  pokemon: Pokemon,
  data: BattleHeldItem,
): Modifiers.PokemonHeldItemModifier | undefined {
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: Recovery records identify item constructors by saved class name.
  const modifierConstructor = Modifiers[data.className as keyof typeof Modifiers];
  const item = new ModifierData({ ...data, args: [pokemon.id, ...data.args.slice(1)] }, pokemon.isPlayer()).toModifier(
    modifierConstructor,
    false,
  );
  if (!(item instanceof Modifiers.PokemonHeldItemModifier)) {
    return;
  }
  item.eonFluteGuestItem = !!data.eonFluteGuestItem;
  item.recoverableBattleTransfer = undefined;
  return item;
}

/** Keep legacy Harvest saves readable without changing state during AI scoring. */
export function getConsumedHeldItems(pokemon: Pokemon): BattleHeldItem[] {
  return (
    pokemon.battleData.consumedHeldItems
    ?? pokemon.battleData.berriesEaten.map(berryType => ({
      ...snapshotItem(pokemon, new Modifiers.BerryModifier(new BerryModifierType(berryType), pokemon.id, berryType, 1)),
      waveIndex: -1,
    }))
  );
}

function isRecyclable(item: Modifiers.PokemonHeldItemModifier): boolean {
  // Explicit whitelist: Reviver Seeds and other special consumables must not become renewable.
  return (
    item instanceof Modifiers.BerryModifier
    || item instanceof Modifiers.TypeGemModifier
    || item instanceof Modifiers.ResetNegativeStatStageModifier
    || item instanceof Modifiers.MirrorHerbModifier
  );
}

export function recordConsumedHeldItem(pokemon: Pokemon, item: Modifiers.PokemonHeldItemModifier): void {
  if (!isRecyclable(item)) {
    return;
  }
  pokemon.battleData.consumedHeldItems = [...getConsumedHeldItems(pokemon), snapshotItem(pokemon, item)];
}

export function recordConsumedBerry(pokemon: Pokemon, berryType: BerryType): void {
  recordConsumedHeldItem(
    pokemon,
    new Modifiers.BerryModifier(new BerryModifierType(berryType), pokemon.id, berryType, 1),
  );
}

export function canRestoreConsumedHeldItem(pokemon: Pokemon, data: BattleHeldItem): boolean {
  const item = createBattleHeldItem(pokemon, data);
  if (!item || !isRecyclable(item)) {
    return false;
  }
  const existing = pokemon.getHeldItems().find(held => held.matchType(item));
  return (existing?.getStackCount() ?? 0) < item.getMaxStackCount();
}

export function getRecycleItemIndex(pokemon: Pokemon): number {
  const items = getConsumedHeldItems(pokemon);
  for (let i = items.length - 1; i >= 0; i--) {
    const data = items[i];
    if (data.waveIndex === globalScene.currentBattle.waveIndex && canRestoreConsumedHeldItem(pokemon, data)) {
      return i;
    }
  }
  return -1;
}

export function restoreConsumedHeldItem(
  pokemon: Pokemon,
  index: number,
): Modifiers.PokemonHeldItemModifier | undefined {
  const items = getConsumedHeldItems(pokemon);
  const data = items[index];
  if (!data || !canRestoreConsumedHeldItem(pokemon, data)) {
    return;
  }
  const item = createBattleHeldItem(pokemon, data)!;
  const playerIndex = pokemon.isPlayer() ? globalScene.getPlayerIndexForPokemon(pokemon) : undefined;
  if (!globalScene.addRecoveredHeldItem(item, pokemon)) {
    return;
  }
  pokemon.battleData.consumedHeldItems = items.filter((_, i) => i !== index);
  if (item instanceof Modifiers.BerryModifier) {
    const berryIndex = pokemon.battleData.berriesEaten.indexOf(item.berryType);
    if (berryIndex >= 0) {
      pokemon.battleData.berriesEaten.splice(berryIndex, 1);
    }
  }
  globalScene.updateModifiers(pokemon.isPlayer(), true, playerIndex);
  return item;
}

/** Removal and consumption deliberately use separate histories. */
export function removeHeldItemForBattle(pokemon: Pokemon, item: Modifiers.PokemonHeldItemModifier): boolean {
  if (item.stackCount <= 0 || !pokemon.getHeldItems().includes(item)) {
    return false;
  }
  const originalOwner = item.recoverableBattleTransfer
    ? globalScene.getPokemonById(item.recoverableBattleTransfer.pokemonId)
    : undefined;
  const owner = originalOwner ?? pokemon;
  const data = snapshotItem(owner, item);
  if (!pokemon.loseHeldItem(item)) {
    return false;
  }
  owner.battleData.removedHeldItems.push(data);
  globalScene.updateModifiers(
    pokemon.isPlayer(),
    true,
    pokemon.isPlayer() ? globalScene.getPlayerIndexForPokemon(pokemon) : undefined,
  );
  return true;
}

export function restoreBattleRemovedHeldItems(pokemon: Pokemon): void {
  const items = pokemon.battleData.removedHeldItems;
  if (items.length === 0) {
    return;
  }
  // Release reserved capacity before restoring the exact units that were removed.
  pokemon.battleData.removedHeldItems = [];
  const playerIndex = pokemon.isPlayer() ? globalScene.getPlayerIndexForPokemon(pokemon) : undefined;
  let restored = false;
  for (const data of items) {
    const item = createBattleHeldItem(pokemon, data);
    if (item && globalScene.addRecoveredHeldItem(item, pokemon)) {
      restored = true;
    } else {
      pokemon.battleData.removedHeldItems.push(data);
    }
  }
  globalScene.updateModifiers(pokemon.isPlayer(), true, playerIndex);
  if (restored && pokemon.isPlayer()) {
    globalScene.phaseManager.queueMessage(
      i18next.t("modifier:recoverBattleTransferredItems", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      }),
    );
  }
}

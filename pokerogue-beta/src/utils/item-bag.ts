import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { tmPoolTiers } from "#balance/tm-pool-tiers";
import { getCooldownHeldItemId, isCooldownHeldItem, isLegacyCooldownHeldItem } from "#data/cooldown-held-items";
import { LearnMoveType } from "#enums/learn-move-type";
import type { PlayerPokemon } from "#field/pokemon";
// biome-ignore lint/performance/noNamespaceImport: Save records resolve modifier constructors by class name, as in GameData.
import * as Modifiers from "#modifiers/modifier";
import {
  getModifierTypeFuncById,
  type ModifierType,
  PartnerPokemonReviveModifierType,
  PokemonAllMovePpRestoreModifierType,
  PokemonHeldItemModifierType,
  PokemonHpRestoreModifierType,
  PokemonModifierType,
  PokemonPpRestoreModifierType,
  PokemonStatusHealModifierType,
  TmModifierType,
} from "#modifiers/modifier-type";
import { ModifierData } from "#system/modifier-data";
import type { BagMedicineData, BagTmData } from "#types/save-data";
import { canReceiveThread, canStoreThread, isDestinyKnot } from "#utils/soul-bond";

export function isBagMedicineType(type: ModifierType): boolean {
  return (
    !(type instanceof PartnerPokemonReviveModifierType)
    && (type instanceof PokemonHpRestoreModifierType
      || type instanceof PokemonStatusHealModifierType
      || type instanceof PokemonPpRestoreModifierType
      || type instanceof PokemonAllMovePpRestoreModifierType)
  );
}

export function getBagMedicineType(item: BagMedicineData): PokemonModifierType | undefined {
  const type = getModifierTypeFuncById(item.typeId)?.();
  if (type instanceof PokemonModifierType && isBagMedicineType(type)) {
    type.id = item.typeId;
    return type;
  }
}

export const BAG_MEDICINE_STACK_LIMIT = 2;

function canStoreMedicine(playerIndex: PlayerIndex, typeId: string): boolean {
  const stack = globalScene.getPlayerBagMedicines(playerIndex).find(item => item.typeId === typeId);
  return (stack?.quantity ?? 0) < BAG_MEDICINE_STACK_LIMIT;
}

export function canBagRewardType(type: PokemonModifierType, playerIndex: PlayerIndex): boolean {
  if (isBagMedicineType(type)) {
    return canStoreMedicine(playerIndex, type.id);
  }
  if (type instanceof TmModifierType) {
    return true;
  }
  const pokemon = globalScene.getPlayerParty(playerIndex)[0];
  const item = pokemon && type instanceof PokemonHeldItemModifierType ? type.newModifier(pokemon) : null;
  return item instanceof Modifiers.PersistentModifier && isBagStorable(item);
}

/** Acquire without applying to a placeholder holder or bypassing player-wide ownership limits. */
export function storeRewardInBag(playerIndex: PlayerIndex, type: PokemonModifierType): boolean {
  if (!globalScene.getActivePlayerIndexes().includes(playerIndex)) {
    return false;
  }
  if (type instanceof TmModifierType) {
    if (!getBagTmType({ moveId: type.moveId, quantity: 1 })) {
      return false;
    }
    const tms = globalScene.getPlayerBagTms(playerIndex);
    const existing = tms.find(item => item.moveId === type.moveId);
    if (existing) {
      if (!Number.isSafeInteger(existing.quantity + 1)) {
        return false;
      }
      existing.quantity++;
    } else {
      tms.push({ moveId: type.moveId, quantity: 1 });
    }
    return true;
  }
  if (isBagMedicineType(type)) {
    if (!canStoreMedicine(playerIndex, type.id) || !getBagMedicineType({ typeId: type.id, quantity: 1 })) {
      return false;
    }
    const medicines = globalScene.getPlayerBagMedicines(playerIndex);
    const existing = medicines.find(item => item.typeId === type.id);
    if (existing) {
      if (!Number.isSafeInteger(existing.quantity + 1)) {
        return false;
      }
      existing.quantity++;
    } else {
      medicines.push({ typeId: type.id, quantity: 1 });
    }
    return true;
  }
  const pokemon = globalScene.getPlayerParty(playerIndex)[0];
  const item = pokemon && type instanceof PokemonHeldItemModifierType ? type.newModifier(pokemon) : null;
  if (!(item instanceof Modifiers.PersistentModifier) || !isBagStorable(item)) {
    return false;
  }
  if (isCooldownHeldItem(item) && !globalScene.canReceiveCooldownHeldItem(getCooldownHeldItemId(item), playerIndex)) {
    return false;
  }
  if (isDestinyKnot(item) && !canStoreThread(playerIndex, item.color)) {
    return false;
  }
  storeItem(playerIndex, item, item.stackCount);
  return true;
}

export function canUseBagMedicine(
  playerIndex: PlayerIndex,
  pokemon: PlayerPokemon,
  item: BagMedicineData,
  moveIndex?: number,
): boolean {
  if (
    !globalScene.getPlayerParty(playerIndex).includes(pokemon)
    || !globalScene.getPlayerBagMedicines(playerIndex).includes(item)
    || item.quantity < 1
  ) {
    return false;
  }
  const type = getBagMedicineType(item);
  if (!type || type.selectFilter?.(pokemon)) {
    return false;
  }
  if (type instanceof PokemonPpRestoreModifierType) {
    const moves = pokemon.getMoveset();
    if (moveIndex === undefined) {
      return moves.some(move => !type.moveSelectFilter?.(move));
    }
    return Number.isInteger(moveIndex) && !!moves[moveIndex] && !type.moveSelectFilter?.(moves[moveIndex]);
  }
  return true;
}

export function useBagMedicine(
  playerIndex: PlayerIndex,
  pokemon: PlayerPokemon,
  item: BagMedicineData,
  moveIndex?: number,
): boolean {
  if (!canUseBagMedicine(playerIndex, pokemon, item, moveIndex)) {
    return false;
  }
  const type = getBagMedicineType(item)!;
  if (type instanceof PokemonPpRestoreModifierType && moveIndex === undefined) {
    return false;
  }
  const modifier = type.newModifier(pokemon, moveIndex);
  if (!globalScene.addModifier(modifier, false, true, false, true, undefined, playerIndex)) {
    return false;
  }
  const medicines = globalScene.getPlayerBagMedicines(playerIndex);
  if (--item.quantity === 0) {
    medicines.splice(medicines.indexOf(item), 1);
  }
  globalScene.dismissEonFluteGuestIfOwnerRevived(playerIndex);
  globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("bag-medicine-used");
  return true;
}

export function restoreBagMedicines(data: readonly BagMedicineData[] = []): BagMedicineData[] {
  const items: BagMedicineData[] = [];
  for (const saved of data) {
    if (!Number.isSafeInteger(saved?.quantity) || saved.quantity < 1 || !getBagMedicineType(saved)) {
      continue;
    }
    const existing = items.find(item => item.typeId === saved.typeId);
    if (existing) {
      if (Number.isSafeInteger(existing.quantity + saved.quantity)) {
        existing.quantity += saved.quantity;
      }
    } else {
      items.push({ typeId: saved.typeId, quantity: saved.quantity });
    }
  }
  return items;
}

export function getBagTmType(item: BagTmData): TmModifierType | undefined {
  if (Number.isInteger(item.moveId) && Object.hasOwn(tmPoolTiers, item.moveId)) {
    return new TmModifierType(item.moveId);
  }
}

export function canUseBagTm(playerIndex: PlayerIndex, pokemon: PlayerPokemon, item: BagTmData): boolean {
  return (
    globalScene.getPlayerParty(playerIndex).includes(pokemon)
    && globalScene.getPlayerBagTms(playerIndex).includes(item)
    && item.quantity > 0
    && !!getBagTmType(item)
    && pokemon.isTmCompatible(item.moveId, true)
  );
}

/** Run learning modally, preserving the reward phase and spending nothing on cancellation. */
export function useBagTm(
  playerIndex: PlayerIndex,
  pokemon: PlayerPokemon,
  item: BagTmData,
  onComplete: () => void,
): boolean {
  if (!canUseBagTm(playerIndex, pokemon, item)) {
    return false;
  }
  const phase = globalScene.phaseManager.create(
    "LearnMovePhase",
    globalScene.getPlayerParty(playerIndex).indexOf(pokemon),
    item.moveId,
    LearnMoveType.BAG_TM,
    -1,
    playerIndex,
    learned => {
      if (learned) {
        const tms = globalScene.getPlayerBagTms(playerIndex);
        if (--item.quantity === 0) {
          tms.splice(tms.indexOf(item), 1);
        }
        globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("bag-tm-used");
      }
      onComplete();
    },
  );
  return globalScene.phaseManager.overridePhase(phase);
}

export function restoreBagTms(data: readonly BagTmData[] = []): BagTmData[] {
  const items: BagTmData[] = [];
  for (const saved of data) {
    if (!Number.isSafeInteger(saved?.quantity) || saved.quantity < 1 || !getBagTmType(saved)) {
      continue;
    }
    const existing = items.find(item => item.moveId === saved.moveId);
    if (existing) {
      if (Number.isSafeInteger(existing.quantity + saved.quantity)) {
        existing.quantity += saved.quantity;
      }
    } else {
      items.push({ moveId: saved.moveId, quantity: saved.quantity });
    }
  }
  return items;
}

export function isBagStorable(item: Modifiers.PersistentModifier): item is Modifiers.PokemonHeldItemModifier {
  return item instanceof Modifiers.PokemonHeldItemModifier && item.isTransferable && !item.eonFluteGuestItem;
}

function storeItem(playerIndex: PlayerIndex, item: Modifiers.PokemonHeldItemModifier, quantity: number): void {
  const bag = globalScene.getPlayerBag(playerIndex);
  // Keep stateful equipment (such as Berry Pots with different timers) in separate stacks.
  const args = JSON.stringify(item.getArgs().slice(1));
  const existing = bag.find(other => other.matchType(item) && JSON.stringify(other.getArgs().slice(1)) === args);
  if (existing) {
    existing.stackCount += quantity;
  } else {
    const stored = item.clone() as Modifiers.PokemonHeldItemModifier;
    stored.pokemonId = -1;
    stored.stackCount = quantity;
    stored.virtualStackCount = 0;
    stored.recoverableBattleTransfer = undefined;
    bag.push(stored);
  }
}

export function depositBagItem(
  playerIndex: PlayerIndex,
  pokemon: PlayerPokemon,
  item: Modifiers.PokemonHeldItemModifier,
  quantity: number,
): boolean {
  const inventory = globalScene.getPlayerModifiers(playerIndex);
  if (
    !globalScene.getPlayerParty(playerIndex).includes(pokemon)
    || !inventory.includes(item)
    || item.pokemonId !== pokemon.id
    || !isBagStorable(item)
    || item.recoverableBattleTransfer
    || !Number.isSafeInteger(quantity)
    || quantity < 1
    || quantity > item.stackCount
  ) {
    return false;
  }
  storeItem(playerIndex, item, quantity);
  item.stackCount -= quantity;
  if (!item.stackCount) {
    inventory.splice(inventory.indexOf(item), 1);
  }
  globalScene.updateModifiers(true, true, playerIndex);
  return true;
}

/** Capacity is checked against the actual recipient, including space reserved for returning battle items. */
export function getBagWithdrawCapacity(
  playerIndex: PlayerIndex,
  pokemon: PlayerPokemon,
  item: Modifiers.PokemonHeldItemModifier,
): number {
  if (
    !globalScene.getPlayerParty(playerIndex).includes(pokemon)
    || !globalScene.getPlayerBag(playerIndex).includes(item)
    || !isBagStorable(item)
  ) {
    return 0;
  }
  const species = item.getSpecies();
  if (species != null && !pokemon.hasSpecies(species)) {
    return 0;
  }
  if (isCooldownHeldItem(item)) {
    if (!globalScene.canReceiveCooldownHeldItem(getCooldownHeldItemId(item), playerIndex, item)) {
      return 0;
    }
  } else if (isDestinyKnot(item)) {
    if (!canReceiveThread(pokemon, item.color, item)) {
      return 0;
    }
  } else if (item.type instanceof PokemonHeldItemModifierType && item.type.selectFilter?.(pokemon)) {
    return 0;
  }
  const equipped = item.clone() as Modifiers.PokemonHeldItemModifier;
  equipped.pokemonId = pokemon.id;
  const held = globalScene.getPlayerModifiers(playerIndex).find(other => equipped.match(other));
  return Math.max(0, Math.min(item.stackCount, equipped.getMaxStackCount() - (held?.getStackCount() ?? 0)));
}

export function withdrawBagItem(
  playerIndex: PlayerIndex,
  pokemon: PlayerPokemon,
  item: Modifiers.PokemonHeldItemModifier,
  quantity: number,
): boolean {
  if (
    !Number.isSafeInteger(quantity)
    || quantity < 1
    || quantity > getBagWithdrawCapacity(playerIndex, pokemon, item)
  ) {
    return false;
  }
  const bag = globalScene.getPlayerBag(playerIndex);
  const index = bag.indexOf(item);
  const equipped = item.clone() as Modifiers.PokemonHeldItemModifier;
  equipped.pokemonId = pokemon.id;
  equipped.stackCount = quantity;
  equipped.recoverableBattleTransfer = undefined;
  item.stackCount -= quantity;
  if (!item.stackCount) {
    bag.splice(index, 1);
  }
  // Remove the bag quantity before the acquisition guards count owned equipment again.
  const added = isLegacyCooldownHeldItem(equipped)
    ? globalScene.addRecoveredHeldItem(equipped, pokemon)
    : globalScene.addModifier(equipped, true, false, false, true, undefined, playerIndex);
  if (!added) {
    if (!bag.includes(item)) {
      bag.splice(index, 0, item);
    }
    item.stackCount += quantity;
    return false;
  }
  globalScene.updateModifiers(true, true, playerIndex);
  return true;
}

/** Called only for release/replacement, never for fusion's post-transfer cleanup. */
export function rescueReleasedHeldItems(playerIndex: PlayerIndex, pokemonId: number): void {
  for (const item of globalScene.getPlayerModifiers(playerIndex)) {
    if (!isBagStorable(item) || item.pokemonId !== pokemonId || item.stackCount < 1) {
      continue;
    }
    const owner = item.recoverableBattleTransfer?.playerIndex ?? playerIndex;
    if (globalScene.getActivePlayerIndexes().includes(owner as PlayerIndex)) {
      storeItem(owner as PlayerIndex, item, item.stackCount);
    }
  }
}

export function restoreBagItems(data: readonly ModifierData[] = []): Modifiers.PokemonHeldItemModifier[] {
  const items: Modifiers.PokemonHeldItemModifier[] = [];
  for (const saved of data) {
    if (!Number.isSafeInteger(saved.stackCount) || saved.stackCount < 1) {
      continue;
    }
    const record = new ModifierData(saved, true);
    const item = record.toModifier(Modifiers[record.className as keyof typeof Modifiers], false);
    if (item && isBagStorable(item)) {
      item.pokemonId = -1;
      item.recoverableBattleTransfer = undefined;
      items.push(item);
    }
  }
  return items;
}

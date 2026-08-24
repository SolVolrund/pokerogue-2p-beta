import { ModifierTier } from "#enums/modifier-tier";
import type { PersistentModifier } from "#modifiers/modifier";
import {
  getModifierTypeFuncById,
  ModifierTypeOption,
  type ModifierType,
  type ModifierTypeKeys,
} from "#modifiers/modifier-type";

export type VsEnemyTokenKey =
  | "damage"
  | "protection"
  | "recovery"
  | "full_heal"
  | "endure"
  | "paralyze"
  | "poison"
  | "burn"
  | "fusion";

export interface VsEnemyTokenDefinition {
  key: VsEnemyTokenKey;
  modifierTypeId: ModifierTypeKeys;
  tier: ModifierTier;
  maxStacks: number;
}

export const VS_ENEMY_TOKEN_DEFINITIONS: readonly VsEnemyTokenDefinition[] = [
  {
    key: "damage",
    modifierTypeId: "ENEMY_DAMAGE_BOOSTER",
    tier: ModifierTier.COMMON,
    maxStacks: 999,
  },
  {
    key: "protection",
    modifierTypeId: "ENEMY_DAMAGE_REDUCTION",
    tier: ModifierTier.COMMON,
    maxStacks: 999,
  },
  {
    key: "paralyze",
    modifierTypeId: "ENEMY_ATTACK_PARALYZE_CHANCE",
    tier: ModifierTier.ROGUE,
    maxStacks: 10,
  },
  {
    key: "poison",
    modifierTypeId: "ENEMY_ATTACK_POISON_CHANCE",
    tier: ModifierTier.ULTRA,
    maxStacks: 10,
  },
  {
    key: "burn",
    modifierTypeId: "ENEMY_ATTACK_BURN_CHANCE",
    tier: ModifierTier.ROGUE,
    maxStacks: 10,
  },
  {
    key: "full_heal",
    modifierTypeId: "ENEMY_STATUS_EFFECT_HEAL_CHANCE",
    tier: ModifierTier.ULTRA,
    maxStacks: 10,
  },
  {
    key: "endure",
    modifierTypeId: "ENEMY_ENDURE_CHANCE",
    tier: ModifierTier.GREAT,
    maxStacks: 10,
  },
  {
    key: "fusion",
    modifierTypeId: "ENEMY_FUSED_CHANCE",
    tier: ModifierTier.MASTER,
    maxStacks: 10,
  },
  {
    key: "recovery",
    modifierTypeId: "ENEMY_HEAL",
    tier: ModifierTier.GREAT,
    maxStacks: 10,
  },
];

export const VS_ENEMY_TOKEN_TIER_WAVE_UNLOCKS: readonly [ModifierTier, number][] = [
  [ModifierTier.COMMON, 21],
  [ModifierTier.GREAT, 51],
  [ModifierTier.ULTRA, 81],
  [ModifierTier.ROGUE, 111],
  [ModifierTier.MASTER, 141],
];

const VS_ENEMY_TOKEN_TIER_COST_MULTIPLIERS = new Map<ModifierTier, number>([
  [ModifierTier.COMMON, 1],
  [ModifierTier.GREAT, 1.5],
  [ModifierTier.ULTRA, 2.25],
  [ModifierTier.ROGUE, 3.5],
  [ModifierTier.MASTER, 5],
]);

export function getVsEnemyTokenDefinitionsForTier(tier: ModifierTier): readonly VsEnemyTokenDefinition[] {
  return VS_ENEMY_TOKEN_DEFINITIONS.filter(definition => definition.tier === tier);
}

export function getVsEnemyTokenDefinition(key: VsEnemyTokenKey): VsEnemyTokenDefinition | undefined {
  return VS_ENEMY_TOKEN_DEFINITIONS.find(definition => definition.key === key);
}

export function getUnlockedVsEnemyTokenTiersForWave(waveIndex: number): ModifierTier[] {
  return VS_ENEMY_TOKEN_TIER_WAVE_UNLOCKS.filter(([, unlockWave]) => waveIndex >= unlockWave).map(([tier]) => tier);
}

export function getVsEnemyTokenModifierTypeOptionsForWave(
  waveIndex: number,
  baseCost: number,
  existingModifiers: readonly PersistentModifier[] = [],
): ModifierTypeOption[] {
  const unlockedTiers = new Set(getUnlockedVsEnemyTokenTiersForWave(waveIndex));
  if (unlockedTiers.size === 0) {
    return [];
  }

  return VS_ENEMY_TOKEN_DEFINITIONS.flatMap(definition => {
    if (!unlockedTiers.has(definition.tier)) {
      return [];
    }

    const modifierTypeFunc = getModifierTypeFuncById(definition.modifierTypeId);
    const modifierType = modifierTypeFunc().withIdFromFunc(modifierTypeFunc);
    modifierType.setTier(definition.tier);

    const modifier = modifierType.newModifier() as PersistentModifier | null;
    if (!modifier) {
      return [];
    }

    const existingModifier = existingModifiers.find(existing => existing.match(modifier));
    if (
      existingModifier
      && existingModifier.getStackCount() >= Math.min(existingModifier.getMaxStackCount(), definition.maxStacks)
    ) {
      return [];
    }

    const costMultiplier = VS_ENEMY_TOKEN_TIER_COST_MULTIPLIERS.get(definition.tier) ?? 1;
    return [new ModifierTypeOption(modifierType, 0, Math.max(baseCost * costMultiplier, 1))];
  });
}

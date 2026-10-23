import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { getHealingSupportMoveCapabilities } from "#utils/computer-partner-healing-support";

export const JOY_SUPPORT_PREFERENCES = { team: 0.2, learning: 0.2, battle: 0.15 } as const;

const SUPPORT_ABILITIES = new Set<AbilityId>([
  AbilityId.TRIAGE,
  AbilityId.FRIEND_GUARD,
  AbilityId.HEALER,
  AbilityId.HOSPITALITY,
  AbilityId.SYMBIOSIS,
  AbilityId.HONEY_GATHER,
  AbilityId.PICKUP,
  AbilityId.FLOWER_VEIL,
  AbilityId.SWEET_VEIL,
  AbilityId.AROMA_VEIL,
  AbilityId.PASTEL_VEIL,
  AbilityId.CURIOUS_MEDICINE,
  AbilityId.BATTERY,
  AbilityId.POWER_SPOT,
  AbilityId.STEELY_SPIRIT,
  AbilityId.VICTORY_STAR,
  AbilityId.DAZZLING,
  AbilityId.QUEENLY_MAJESTY,
  AbilityId.ARMOR_TAIL,
]);

const TEAM_SUPPORT_MOVES = new Set<MoveId>([
  MoveId.HELPING_HAND,
  MoveId.LIGHT_SCREEN,
  MoveId.REFLECT,
  MoveId.AURORA_VEIL,
  MoveId.TAILWIND,
  MoveId.SAFEGUARD,
  MoveId.MIST,
  MoveId.WIDE_GUARD,
  MoveId.QUICK_GUARD,
  MoveId.CRAFTY_SHIELD,
  MoveId.MAT_BLOCK,
  MoveId.FOLLOW_ME,
  MoveId.RAGE_POWDER,
  MoveId.COACHING,
  MoveId.LIFE_DEW,
  MoveId.JUNGLE_HEALING,
  MoveId.LUNAR_BLESSING,
]);

export function isTeamSupportMove(move: Move): boolean {
  return (
    !move.name.endsWith(" (N)")
    && (getHealingSupportMoveCapabilities(move).healsPartner
      || move.hasAttr("PartyStatusCureAttr")
      || TEAM_SUPPORT_MOVES.has(move.id))
  );
}

export function hasSpeciesSupportPotential(species: PokemonSpecies): boolean {
  const abilities = [
    species.ability1,
    species.ability2,
    species.abilityHidden,
    species.getPassiveAbility(0, 0),
    species.getPassiveAbility(0, 1),
  ];
  if (abilities.some(ability => SUPPORT_ABILITIES.has(ability))) {
    return true;
  }
  // Natural access identifies a support specialist; generic TM access alone does not.
  return species.getLevelMoves().some(([, id]) => allMoves[id] && isTeamSupportMove(allMoves[id]));
}

export function hasPokemonSupportTools(pokemon: Pokemon): boolean {
  return (
    SUPPORT_ABILITIES.has(pokemon.getAbility().id)
    || (pokemon.hasPassive() && SUPPORT_ABILITIES.has(pokemon.getPassiveAbility().id))
    || pokemon.getMoveset().some(move => isTeamSupportMove(move.getMove()))
  );
}

export function isJoyComputerPartner(pokemon: Pokemon): boolean {
  if (!pokemon.isPlayer()) {
    return false;
  }
  const owner = globalScene.getPlayerIndexForPokemon(pokemon);
  return (
    owner !== undefined
    && globalScene.isComputerPartnerPlayer(owner)
    && globalScene.getComputerPartnerKey(owner) === "joy"
  );
}

/** A preference only: callers provide positive support value, excluding damage and penalties. */
export function getJoyBattleSupportBonus(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  supportValue: number,
  urgentHeal = false,
): number {
  if (!isJoyComputerPartner(user) || user.isOpponent(target) || supportValue <= 0 || !isTeamSupportMove(move)) {
    return 0;
  }
  if (move.category !== MoveCategory.STATUS && !move.hasAttr("HealOnAllyAttr")) {
    return 0;
  }
  if (move.hasAttr("HealAttr")) {
    const usefulCure =
      !!target.status && move.getAttrs("HealStatusEffectAttr").some(attr => attr.isOfEffect(target.status!.effect));
    if (
      !usefulCure
      && (target.getTag(BattlerTagType.HEAL_BLOCK)
        || target.hp <= 0
        || target.hp >= target.getMaxHp()
        || (!urgentHeal && target.getHpRatio() > 0.85))
    ) {
      return 0;
    }
  }
  return supportValue * JOY_SUPPORT_PREFERENCES.battle;
}

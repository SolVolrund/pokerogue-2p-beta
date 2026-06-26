import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Move } from "#moves/move";

export interface HealingSupportMoveCapabilities {
  healsSelf: boolean;
  healsPartner: boolean;
  healsAllAllies: boolean;
}

const SELF_HEAL_TAG_MOVES = new Set<MoveId>([MoveId.AQUA_RING, MoveId.INGRAIN]);
const SELF_HEAL_EFFECT_MOVES = new Set<MoveId>([MoveId.WISH]);
const PARTNER_HEAL_MOVES = new Set<MoveId>([MoveId.HEAL_PULSE, MoveId.FLORAL_HEALING]);
const ALLIED_HEAL_TARGETS = new Set<MoveTarget>([MoveTarget.USER_AND_ALLIES, MoveTarget.USER_SIDE]);
const SELF_HEAL_TARGETS = new Set<MoveTarget>([MoveTarget.USER, MoveTarget.USER_AND_ALLIES, MoveTarget.USER_SIDE]);
const PARTNER_HEAL_TARGETS = new Set<MoveTarget>([
  MoveTarget.ALLY,
  MoveTarget.NEAR_ALLY,
  MoveTarget.USER_OR_NEAR_ALLY,
  MoveTarget.USER_AND_ALLIES,
  MoveTarget.USER_SIDE,
]);

export function getHealingSupportMoveCapabilities(move: Move): HealingSupportMoveCapabilities {
  const hasDirectHeal =
    move.hasAttr("HealAttr")
    || move.hasAttr("WeatherHealAttr")
    || move.hasAttr("PlantHealAttr")
    || move.hasAttr("SandHealAttr")
    || move.hasAttr("BoostHealAttr")
    || move.hasAttr("SwallowHealAttr");
  const healsAllAllies = hasDirectHeal && ALLIED_HEAL_TARGETS.has(move.moveTarget);
  const healsPartner =
    healsAllAllies
    || PARTNER_HEAL_MOVES.has(move.id)
    || move.hasAttr("HealOnAllyAttr")
    || (hasDirectHeal && PARTNER_HEAL_TARGETS.has(move.moveTarget) && !SELF_HEAL_TARGETS.has(move.moveTarget));
  const healsSelf =
    healsAllAllies
    || SELF_HEAL_TAG_MOVES.has(move.id)
    || SELF_HEAL_EFFECT_MOVES.has(move.id)
    || move.hasAttr("HitHealAttr")
    || (hasDirectHeal && SELF_HEAL_TARGETS.has(move.moveTarget));

  return { healsSelf, healsPartner, healsAllAllies };
}

export function isHealingSupportMove(move: Move): boolean {
  const capabilities = getHealingSupportMoveCapabilities(move);
  return capabilities.healsSelf || capabilities.healsPartner;
}

export function getSpeciesHealingSupportAccessScore(species: PokemonSpecies): number {
  const learnableMoveIds = new Set<MoveId>([
    ...species.getLevelMoves().map(([, moveId]) => moveId),
    ...species.getTms(),
  ]);
  let score = 0;

  for (const moveId of learnableMoveIds) {
    const move = allMoves[moveId];
    if (!move) {
      continue;
    }

    const capabilities = getHealingSupportMoveCapabilities(move);
    if (capabilities.healsAllAllies) {
      score = Math.max(score, 18);
      continue;
    }
    if (capabilities.healsPartner) {
      score = Math.max(score, 14);
    }
    if (capabilities.healsSelf) {
      score = Math.max(score, 10);
    }
  }

  return score;
}

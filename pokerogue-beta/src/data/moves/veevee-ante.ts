import { getTypeDamageMultiplier } from "#data/type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";

export const VEEVEE_ANTE_SIGNATURES = [
  { type: PokemonType.WATER, move: MoveId.BOUNCY_BUBBLE },
  { type: PokemonType.ELECTRIC, move: MoveId.BUZZY_BUZZ },
  { type: PokemonType.FIRE, move: MoveId.SIZZLY_SLIDE },
  { type: PokemonType.PSYCHIC, move: MoveId.GLITZY_GLOW },
  { type: PokemonType.DARK, move: MoveId.BADDY_BAD },
  { type: PokemonType.GRASS, move: MoveId.SAPPY_SEED },
  { type: PokemonType.ICE, move: MoveId.FREEZY_FROST },
  { type: PokemonType.FAIRY, move: MoveId.SPARKLY_SWIRL },
] as const;

export interface VeeveeAnteBucket {
  kind: "offensive" | "defensive" | "random" | "eevee";
  moves: readonly MoveId[];
}

/** Categories, not individual candidates, receive equal odds. This does not consume RNG. */
export function getVeeveeAnteBuckets(targetTypes: readonly PokemonType[]): VeeveeAnteBucket[] {
  const types = targetTypes.filter(type => type !== PokemonType.UNKNOWN);
  const ranked = VEEVEE_ANTE_SIGNATURES.map(signature => {
    const defenses = types.map(type => getTypeDamageMultiplier(type, signature.type));
    return {
      ...signature,
      offense: types.reduce((score, type) => score * getTypeDamageMultiplier(signature.type, type), 1),
      worstDefense: defenses.length ? Math.max(...defenses) : 1,
      bestDefense: Math.min(1, ...defenses),
      defenseTotal: defenses.reduce<number>((total, score) => total + score, 0),
    };
  });
  const buckets: VeeveeAnteBucket[] = [];
  const bestOffense = Math.max(...ranked.map(entry => entry.offense));
  if (bestOffense > 1) {
    buckets.push({
      kind: "offensive",
      moves: ranked.filter(entry => entry.offense === bestOffense).map(entry => entry.move),
    });
  }

  // Prefer resisting both STAB types, then a resistance without a compensating weakness.
  const defensive = ranked
    .filter(entry => entry.bestDefense < 1)
    .sort((a, b) => a.worstDefense - b.worstDefense || a.defenseTotal - b.defenseTotal);
  const best = defensive[0];
  if (best) {
    buckets.push({
      kind: "defensive",
      moves: defensive
        .filter(entry => entry.worstDefense === best.worstDefense && entry.defenseTotal === best.defenseTotal)
        .map(entry => entry.move),
    });
  }
  buckets.push({ kind: "random", moves: VEEVEE_ANTE_SIGNATURES.map(entry => entry.move) });
  buckets.push({ kind: "eevee", moves: [MoveId.VEEVEE_VOLLEY] });
  return buckets;
}

export function getVeeveeAnteOutcomes(targetTypes: readonly PokemonType[]): { move: MoveId; probability: number }[] {
  const buckets = getVeeveeAnteBuckets(targetTypes);
  const probabilities = new Map<MoveId, number>();
  for (const bucket of buckets) {
    for (const move of bucket.moves) {
      probabilities.set(move, (probabilities.get(move) ?? 0) + 1 / buckets.length / bucket.moves.length);
    }
  }
  return [...probabilities].map(([move, probability]) => ({ move, probability }));
}

export function rollVeeveeAnte(user: Pokemon, target: Pokemon): MoveId {
  const buckets = getVeeveeAnteBuckets(target.getTypes({ returnOriginalTypesIfStellar: true, useIllusion: true }));
  const bucket = buckets[user.randBattleSeedInt(buckets.length)];
  return bucket.moves[user.randBattleSeedInt(bucket.moves.length)];
}

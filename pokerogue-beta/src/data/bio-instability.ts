import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";

export const BIO_INSTABILITY_VARIANT = "bio-instability-eevee";
export const BIO_EEVEE_FORM_KEY = "bio-eevee";

export const BIO_INSTABILITY_FORMS = [
  {
    key: BIO_EEVEE_FORM_KEY,
    species: SpeciesId.EEVEE,
    type: PokemonType.NORMAL,
    passive: AbilityId.MOODY,
    stats: [55, 55, 50, 45, 65, 55],
    height: 0.3,
    weight: 6.5,
    moves: [MoveId.VEEVEE_VOLLEY, MoveId.LAST_RESORT, MoveId.PROTECT, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-vaporeon",
    species: SpeciesId.VAPOREON,
    type: PokemonType.WATER,
    passive: AbilityId.DRIZZLE,
    stats: [130, 65, 60, 110, 95, 65],
    height: 1,
    weight: 29,
    moves: [MoveId.BOUNCY_BUBBLE, MoveId.AQUA_RING, MoveId.MUDDY_WATER, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-jolteon",
    species: SpeciesId.JOLTEON,
    type: PokemonType.ELECTRIC,
    passive: AbilityId.ELECTRIC_SURGE,
    stats: [65, 65, 60, 110, 95, 130],
    height: 0.8,
    weight: 24.5,
    moves: [MoveId.BUZZY_BUZZ, MoveId.ELECTRO_BALL, MoveId.ELECTROWEB, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-flareon",
    species: SpeciesId.FLAREON,
    type: PokemonType.FIRE,
    passive: AbilityId.DROUGHT,
    stats: [65, 130, 60, 95, 110, 65],
    height: 0.9,
    weight: 25,
    moves: [MoveId.SIZZLY_SLIDE, MoveId.MAGMA_STORM, MoveId.FLARE_BLITZ, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-umbreon",
    species: SpeciesId.UMBREON,
    type: PokemonType.DARK,
    passive: AbilityId.DARK_AURA,
    stats: [95, 65, 110, 60, 130, 65],
    height: 1,
    weight: 27,
    moves: [MoveId.BADDY_BAD, MoveId.POWER_TRIP, MoveId.HONE_CLAWS, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-espeon",
    species: SpeciesId.ESPEON,
    type: PokemonType.PSYCHIC,
    passive: AbilityId.PSYCHIC_SURGE,
    stats: [65, 65, 60, 130, 95, 110],
    height: 0.9,
    weight: 26.5,
    moves: [MoveId.GLITZY_GLOW, MoveId.STORED_POWER, MoveId.CALM_MIND, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-glaceon",
    species: SpeciesId.GLACEON,
    type: PokemonType.ICE,
    passive: AbilityId.SNOW_WARNING,
    stats: [65, 60, 110, 130, 95, 65],
    height: 0.8,
    weight: 25.9,
    moves: [MoveId.FREEZY_FROST, MoveId.SHEER_COLD, MoveId.BLIZZARD, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-leafeon",
    species: SpeciesId.LEAFEON,
    type: PokemonType.GRASS,
    passive: AbilityId.GRASSY_SURGE,
    stats: [65, 110, 130, 60, 65, 95],
    height: 1,
    weight: 25.5,
    moves: [MoveId.SAPPY_SEED, MoveId.INGRAIN, MoveId.LEAF_BLADE, MoveId.VEEVEE_ANTE],
  },
  {
    key: "bio-sylveon",
    species: SpeciesId.SYLVEON,
    type: PokemonType.FAIRY,
    passive: AbilityId.MISTY_SURGE,
    stats: [95, 65, 65, 110, 130, 60],
    height: 1,
    weight: 23.5,
    moves: [MoveId.SPARKLY_SWIRL, MoveId.FLORAL_HEALING, MoveId.DAZZLING_GLEAM, MoveId.VEEVEE_ANTE],
  },
] as const;

export function getBioInstabilityForm(species: SpeciesId, formKey: string) {
  return species === SpeciesId.EEVEE ? BIO_INSTABILITY_FORMS.find(form => form.key === formKey) : undefined;
}

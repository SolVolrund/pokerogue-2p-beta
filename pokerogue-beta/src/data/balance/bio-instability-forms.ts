import { BIO_INSTABILITY_FORMS } from "#data/bio-instability";
import { PokemonForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";

export function createBioInstabilityForms(): PokemonForm[] {
  return BIO_INSTABILITY_FORMS.map(form => new PokemonForm({
    formName: `Bio ${form.key.slice(4)}`,
    formKey: form.key,
    type1: form.type,
    type2: null,
    height: form.height,
    weight: form.weight,
    ability1: AbilityId.BIO_INSTABILITY,
    ability2: AbilityId.NONE,
    abilityHidden: AbilityId.NONE,
    baseTotal: form.stats.reduce((total: number, stat) => total + stat, 0),
    baseHp: form.stats[0],
    baseAtk: form.stats[1],
    baseDef: form.stats[2],
    baseSpatk: form.stats[3],
    baseSpdef: form.stats[4],
    baseSpd: form.stats[5],
    catchRate: 45,
    baseFriendship: 0,
    baseExp: 65,
    isStarterSelectable: false,
    isUnobtainable: true,
  }));
}

// Append after Eevee's existing normal, partner and G-Max forms to preserve saves.
export const bioInstabilityPassives = Object.fromEntries(
  BIO_INSTABILITY_FORMS.map((form, index) => [index + 3, [form.passive, form.passive]]),
);

import { COSPLAY_PIKACHU_BASE_FORM_KEY, COSPLAY_PIKACHU_SCARF_FORMS } from "#data/cosplay-pikachu";
import { ROTOM_APPLIANCE_FORMS, ROTOM_BASE_FORM_KEY } from "#data/rotom";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";

interface FormSelectionItem {
  item: FormChangeItem;
  species: SpeciesId;
  formKeys?: readonly string[];
  replaces?: readonly FormChangeItem[];
}

export const FORM_SELECTION_ITEMS: readonly FormSelectionItem[] = [
  { item: FormChangeItem.FASHION_CASE, species: SpeciesId.FURFROU },
  {
    item: FormChangeItem.BIG_METEOR, species: SpeciesId.DEOXYS,
    formKeys: ["normal", "attack", "defense", "speed"],
    replaces: [FormChangeItem.SHARP_METEORITE, FormChangeItem.HARD_METEORITE, FormChangeItem.SMOOTH_METEORITE],
  },
  {
    item: FormChangeItem.PROP_CASE, species: SpeciesId.PIKACHU,
    formKeys: [COSPLAY_PIKACHU_BASE_FORM_KEY, ...COSPLAY_PIKACHU_SCARF_FORMS.map(f => f.formKey)],
    replaces: COSPLAY_PIKACHU_SCARF_FORMS.map(f => f.item),
  },
  {
    item: FormChangeItem.ROTOM_CATALOGUE, species: SpeciesId.ROTOM,
    formKeys: [ROTOM_BASE_FORM_KEY, ...ROTOM_APPLIANCE_FORMS.map(f => f.formKey)],
    replaces: ROTOM_APPLIANCE_FORMS.map(f => f.item),
  },
  { item: FormChangeItem.NECTAR_CASE, species: SpeciesId.ORICORIO, formKeys: ["baile", "pompom", "pau", "sensu"] },
];

const selectionByItem = new Map(FORM_SELECTION_ITEMS.map(def => [def.item, def]));
const replacementByItem = new Map(FORM_SELECTION_ITEMS.flatMap(def => (def.replaces ?? []).map(old => [old, def.item] as const)));

export function isFormSelectionItem(item: FormChangeItem): boolean {
  return selectionByItem.has(item);
}

export function getReplacementFormItem(item: FormChangeItem): FormChangeItem | undefined {
  return replacementByItem.get(item);
}

function holdsFormItem(pokemon: Pokemon, item: FormChangeItem): boolean {
  return pokemon.getHeldItems().some(m => m.is("PokemonFormChangeItemModifier") && m.formChangeItem === item);
}

export function isLegacyFormItemSuperseded(pokemon: Pokemon, item: FormChangeItem): boolean {
  const replacement = getReplacementFormItem(item);
  return replacement !== undefined && holdsFormItem(pokemon, replacement);
}

function getSelectionComponent(pokemon: Pokemon, item: FormChangeItem) {
  const def = selectionByItem.get(item);
  if (!def || !pokemon.hasSpecies(def.species)) {
    return;
  }
  // Match the component the ordinary form-change phase will actually change.
  const donor = pokemon.fusionSpecies?.speciesId === def.species;
  const species = donor ? pokemon.fusionSpecies! : pokemon.species;
  const index = donor ? pokemon.fusionFormIndex : pokemon.formIndex;
  const form = species.forms[index];
  if (form && (!def.formKeys || def.formKeys.includes(form.formKey))) {
    return { species, index, formKeys: def.formKeys };
  }
}

export function canReceiveFormSelectionItem(pokemon: Pokemon, item: FormChangeItem): boolean {
  return !!getSelectionComponent(pokemon, item) && !holdsFormItem(pokemon, item);
}

export function getFormSelectionTarget(pokemon: Pokemon, item: FormChangeItem) {
  const target = getSelectionComponent(pokemon, item);
  if (target && holdsFormItem(pokemon, item)) {
    return target;
  }
}

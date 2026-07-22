import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";

export const COSPLAY_PIKACHU_BASE_FORM_KEY = "cosplay";

export const COSPLAY_PIKACHU_SCARF_FORMS = [
  { formKey: "cool-cosplay", item: FormChangeItem.COSPLAY_RED_SCARF },
  { formKey: "beauty-cosplay", item: FormChangeItem.COSPLAY_BLUE_SCARF },
  { formKey: "cute-cosplay", item: FormChangeItem.COSPLAY_PINK_SCARF },
  { formKey: "smart-cosplay", item: FormChangeItem.COSPLAY_GREEN_SCARF },
  { formKey: "tough-cosplay", item: FormChangeItem.COSPLAY_YELLOW_SCARF },
] as const;

export const COSPLAY_PIKACHU_FORM_MOVES: Partial<Record<string, MoveId>> = {
  [COSPLAY_PIKACHU_BASE_FORM_KEY]: MoveId.THUNDER_SHOCK,
  "cool-cosplay": MoveId.METEOR_MASH,
  "beauty-cosplay": MoveId.ICICLE_CRASH,
  "cute-cosplay": MoveId.DRAINING_KISS,
  "smart-cosplay": MoveId.PSYCHIC,
  "tough-cosplay": MoveId.FLYING_PRESS,
};

export const COSPLAY_PIKACHU_MOVE_IDS = new Set<MoveId>(
  Object.values(COSPLAY_PIKACHU_FORM_MOVES).filter((moveId): moveId is MoveId => moveId != null),
);

export function isCosplayPikachuScarfItem(formChangeItem: FormChangeItem): boolean {
  return COSPLAY_PIKACHU_SCARF_FORMS.some(form => form.item === formChangeItem);
}

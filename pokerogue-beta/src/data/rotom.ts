import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";

export const ROTOM_BASE_FORM_KEY = "";

export const ROTOM_APPLIANCE_FORMS = [
  { formKey: "heat", item: FormChangeItem.ROTOM_OVEN },
  { formKey: "wash", item: FormChangeItem.ROTOM_WASHER },
  { formKey: "frost", item: FormChangeItem.ROTOM_FRIDGE },
  { formKey: "fan", item: FormChangeItem.ROTOM_FAN },
  { formKey: "mow", item: FormChangeItem.ROTOM_MOWER },
] as const;

export const ROTOM_FORM_MOVES: Partial<Record<string, MoveId>> = {
  [ROTOM_BASE_FORM_KEY]: MoveId.THUNDER_SHOCK,
  heat: MoveId.OVERHEAT,
  wash: MoveId.HYDRO_PUMP,
  frost: MoveId.BLIZZARD,
  fan: MoveId.AIR_SLASH,
  mow: MoveId.LEAF_STORM,
};

export const ROTOM_MOVE_IDS = new Set<MoveId>(
  Object.values(ROTOM_FORM_MOVES).filter((moveId): moveId is MoveId => moveId != null),
);

export function isRotomApplianceItem(formChangeItem: FormChangeItem): boolean {
  return ROTOM_APPLIANCE_FORMS.some(form => form.item === formChangeItem);
}

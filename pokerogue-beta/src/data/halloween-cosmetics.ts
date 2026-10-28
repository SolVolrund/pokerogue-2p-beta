import { TrainerType } from "#enums/trainer-type";
import type { EventSpriteOptions } from "#types/events";

/** Annual October cosmetics, independent of the dated event's gameplay bonuses. */
export const halloweenSprites: EventSpriteOptions = {
  pokemonReplacements: [],
  trainerReplacements: [
    [TrainerType.RIVAL, "halloween_rival"],
    [TrainerType.RIVAL_2, "halloween_rival"],
    [TrainerType.RIVAL_3, "halloween_rival"],
    [TrainerType.RIVAL_4, "halloween_rival"],
    [TrainerType.RIVAL_5, "halloween_rival"],
    [TrainerType.RIVAL_6, "halloween_rival"],
  ],
  imageReplacements: [
    ["logo", "logo_halloween"],
    ["pkmn__sub", "subcharx"],
    ["pkmn__back__sub", "subcharxback"],
    ["training_session_gear", "training_session_gearcharx"],
    ["c_rival_m", "halloween_rival_m"],
    ["c_rival_f", "halloween_rival_f"],
  ],
};

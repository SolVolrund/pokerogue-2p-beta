import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Setting } from "#system/settings";
import { SettingType } from "#system/settings";
import i18next from "i18next";

const EVENT_SETTING_PREFIX = "MYSTERY_ENCOUNTER_";

const EVENT_SETTING_OPTIONS = [
  {
    value: "Off",
    label: i18next.t("settings:off"),
  },
  {
    value: "On",
    label: i18next.t("settings:on"),
  },
];

const EVENT_TITLE_KEYS: Record<MysteryEncounterType, string> = {
  [MysteryEncounterType.MYSTERIOUS_CHALLENGERS]: "mysteryEncounters/mysteriousChallengers:title",
  [MysteryEncounterType.MYSTERIOUS_CHEST]: "mysteryEncounters/mysteriousChest:title",
  [MysteryEncounterType.DARK_DEAL]: "mysteryEncounters/darkDeal:title",
  [MysteryEncounterType.FIGHT_OR_FLIGHT]: "mysteryEncounters/fightOrFlight:title",
  [MysteryEncounterType.SLUMBERING_SNORLAX]: "mysteryEncounters/slumberingSnorlax:title",
  [MysteryEncounterType.TRAINING_SESSION]: "mysteryEncounters/trainingSession:title",
  [MysteryEncounterType.DEPARTMENT_STORE_SALE]: "mysteryEncounters/departmentStoreSale:title",
  [MysteryEncounterType.SHADY_VITAMIN_DEALER]: "mysteryEncounters/shadyVitaminDealer:title",
  [MysteryEncounterType.FIELD_TRIP]: "mysteryEncounters/fieldTrip:title",
  [MysteryEncounterType.SAFARI_ZONE]: "mysteryEncounters/safariZone:title",
  [MysteryEncounterType.LOST_AT_SEA]: "mysteryEncounters/lostAtSea:title",
  [MysteryEncounterType.FIERY_FALLOUT]: "mysteryEncounters/fieryFallout:title",
  [MysteryEncounterType.THE_STRONG_STUFF]: "mysteryEncounters/theStrongStuff:title",
  [MysteryEncounterType.THE_POKEMON_SALESMAN]: "mysteryEncounters/thePokemonSalesman:title",
  [MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE]: "mysteryEncounters/anOfferYouCantRefuse:title",
  [MysteryEncounterType.DELIBIRDY]: "mysteryEncounters/delibirdy:title",
  [MysteryEncounterType.ABSOLUTE_AVARICE]: "mysteryEncounters/absoluteAvarice:title",
  [MysteryEncounterType.A_TRAINERS_TEST]: "mysteryEncounters/aTrainersTest:title",
  [MysteryEncounterType.TRASH_TO_TREASURE]: "mysteryEncounters/trashToTreasure:title",
  [MysteryEncounterType.BERRIES_ABOUND]: "mysteryEncounters/berriesAbound:title",
  [MysteryEncounterType.CLOWNING_AROUND]: "mysteryEncounters/clowningAround:title",
  [MysteryEncounterType.PART_TIMER]: "mysteryEncounters/partTimer:title",
  [MysteryEncounterType.DANCING_LESSONS]: "mysteryEncounters/dancingLessons:title",
  [MysteryEncounterType.WEIRD_DREAM]: "mysteryEncounters/weirdDream:title",
  [MysteryEncounterType.THE_WINSTRATE_CHALLENGE]: "mysteryEncounters/theWinstrateChallenge:title",
  [MysteryEncounterType.TELEPORTING_HIJINKS]: "mysteryEncounters/teleportingHijinks:title",
  [MysteryEncounterType.BUG_TYPE_SUPERFAN]: "mysteryEncounters/bugTypeSuperfan:title",
  [MysteryEncounterType.FUN_AND_GAMES]: "mysteryEncounters/funAndGames:title",
  [MysteryEncounterType.UNCOMMON_BREED]: "mysteryEncounters/uncommonBreed:title",
  [MysteryEncounterType.GLOBAL_TRADE_SYSTEM]: "mysteryEncounters/globalTradeSystem:title",
  [MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER]: "mysteryEncounters/theExpertPokemonBreeder:title",
};

export function getMysteryEncounterSettingKey(encounterType: MysteryEncounterType): string {
  return `${EVENT_SETTING_PREFIX}${MysteryEncounterType[encounterType]}`;
}

export function getMysteryEncounterEventSettings(): Setting[] {
  return Object.values(MysteryEncounterType)
    .filter((value): value is MysteryEncounterType => typeof value === "number")
    .map(encounterType => ({
      key: getMysteryEncounterSettingKey(encounterType),
      label: encounterType === MysteryEncounterType.SLUMBERING_SNORLAX
        ? "Slumbering Snorlax"
        : i18next.t(EVENT_TITLE_KEYS[encounterType]),
      options: EVENT_SETTING_OPTIONS,
      default: 1,
      type: SettingType.EVENTS,
    }));
}

export function isMysteryEncounterEnabledBySettings(encounterType: MysteryEncounterType): boolean {
  const savedSettings = localStorage.getItem("settings");
  if (savedSettings == null) {
    return true;
  }

  try {
    const settings = JSON.parse(savedSettings);
    const key = getMysteryEncounterSettingKey(encounterType);
    return !Object.hasOwn(settings, key) || settings[key] !== 0;
  } catch {
    return true;
  }
}

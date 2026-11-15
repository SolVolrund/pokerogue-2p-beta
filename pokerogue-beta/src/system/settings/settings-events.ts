import { WEIGHT_INCREMENT_ON_SPAWN_MISS } from "#app/constants";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { canReserveEncounter, isReservableEncounter } from "#mystery-encounters/encounter-reservation";
import { normalizeMysteryEncounterFrequency } from "#mystery-encounters/mystery-encounter-save-data";
import type { Setting } from "#system/settings";
import { SettingType } from "#system/settings";
import i18next from "i18next";

const EVENT_SETTING_PREFIX = "MYSTERY_ENCOUNTER_";
export const MYSTERY_ENCOUNTER_FREQUENCY_SETTING = "MYSTERY_ENCOUNTER_FREQUENCY";

export function getMysteryEncounterFrequencySetting(): number {
  try {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
    return normalizeMysteryEncounterFrequency(settings?.[MYSTERY_ENCOUNTER_FREQUENCY_SETTING]);
  } catch {
    return WEIGHT_INCREMENT_ON_SPAWN_MISS;
  }
}

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
  [MysteryEncounterType.CAPTURE_CUSTOMIZER]: "mysteryEncounters/captureCustomizer:title",
  [MysteryEncounterType.SPOOKY_INVITATION]: "mysteryEncounters/spookyInvitation:title",
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
  [MysteryEncounterType.GTS_MALFUNCTION]: "mysteryEncounters/gtsMalfunction:title",
  [MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER]: "mysteryEncounters/theExpertPokemonBreeder:title",
  [MysteryEncounterType.SHINY_BADGE]: "mysteryEncounters/shinyBadge:title",
  [MysteryEncounterType.IT_IS_DANGEROUS_TO_GO_ALONE]: "mysteryEncounters/itIsDangerousToGoAlone:title",
  [MysteryEncounterType.LEGENDARY_CONFLICT]: "mysteryEncounters/legendaryConflict:title",
  [MysteryEncounterType.POKE_POACHERS]: "mysteryEncounters/pokePoachers:title",
  [MysteryEncounterType.CHEFS_ON_VACATION]: "mysteryEncounters/chefsOnVacation:title",
  [MysteryEncounterType.FARAWAY_ISLAND_TREASURE]: "mysteryEncounters/farawayIslandTreasure:title",
  [MysteryEncounterType.CONTEST_HALL]: "mysteryEncounters/contestHall:title",
  [MysteryEncounterType.DEJA_VU]: "mysteryEncounters/dejaVu:title",
  [MysteryEncounterType.MINING]: "mysteryEncounters/mining:title",
  [MysteryEncounterType.LIFE_IS_WONDERFUL]: "mysteryEncounters/lifeIsWonderful:title",
  [MysteryEncounterType.PALLET_EXHIBITION]: "mysteryEncounters/palletExhibition:title",
  [MysteryEncounterType.GAME_CORNER]: "mysteryEncounters/gameCorner:title",
};

export function getMysteryEncounterSettingKey(encounterType: MysteryEncounterType): string {
  return `${EVENT_SETTING_PREFIX}${MysteryEncounterType[encounterType]}`;
}

const eventTypes = Object.values(MysteryEncounterType).filter((v): v is MysteryEncounterType => typeof v === "number");
const typeByKey = new Map(eventTypes.map(type => [getMysteryEncounterSettingKey(type), type]));
export const getEventTypeForSetting = (key: string) => typeByKey.get(key);
export const SCHEDULED_OPTION = 2;

export function getScheduledEncounterSetting(unlocks: Parameters<typeof canReserveEncounter>[1]): MysteryEncounterType | null {
  try {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
    return eventTypes.find(type => settings?.[getMysteryEncounterSettingKey(type)] === SCHEDULED_OPTION
      && canReserveEncounter(type, unlocks)) ?? null;
  } catch {
    return null;
  }
}

export function demoteOtherScheduledEvents(settings: Record<string, unknown>, selectedKey: string): void {
  if (!isReservableEncounter(typeByKey.get(selectedKey))) {
    return;
  }
  for (const key of typeByKey.keys()) {
    if (key !== selectedKey && settings[key] === SCHEDULED_OPTION) {
      settings[key] = 1;
    }
  }
}

export function getMysteryEncounterEventSettings(): Setting[] {
  const eventSettings = eventTypes
    .map(encounterType => ({
      key: getMysteryEncounterSettingKey(encounterType),
      label:
        encounterType === MysteryEncounterType.SLUMBERING_SNORLAX
          ? "Slumbering Snorlax"
          : i18next.t(EVENT_TITLE_KEYS[encounterType]),
      options: isReservableEncounter(encounterType)
        ? [...EVENT_SETTING_OPTIONS, { value: "Scheduled", label: i18next.t("settings:scheduled") }]
        : EVENT_SETTING_OPTIONS,
      default: 1,
      type: SettingType.EVENTS,
    }));
  return [
    {
      key: MYSTERY_ENCOUNTER_FREQUENCY_SETTING,
      label: "Frequency (New Runs)",
      options: Array.from({ length: 7 }, (_, value) => ({ value: String(value), label: String(value) })),
      default: WEIGHT_INCREMENT_ON_SPAWN_MISS,
      type: SettingType.EVENTS,
    },
    ...eventSettings,
  ];
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

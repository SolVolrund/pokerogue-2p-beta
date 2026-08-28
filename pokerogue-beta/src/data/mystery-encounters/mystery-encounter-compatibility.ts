import { MysteryEncounterType } from "#enums/mystery-encounter-type";

export type MysteryEncounterCompatibilityMode =
  | "single-player"
  | "two-player-full-coop"
  | "three-player-full-coop"
  | "two-player-limited-coop"
  | "three-player-limited-coop"
  | "two-player-vs";

export interface MysteryEncounterCompatibilityContext {
  twoPlayerMode: boolean;
  twoPlayerVsMode: boolean;
  multiplayerPlayerCount: 1 | 2 | 3;
  twoPlayerPartySize: 3 | 6;
}

export type MysteryEncounterBattleGroup =
  | "trainer-battle"
  | "wild-battle"
  | "boss-battle"
  | "multi-boss-battle"
  | "special-battle"
  | "non-battle";

export const TRAINER_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
  MysteryEncounterType.A_TRAINERS_TEST,
  MysteryEncounterType.WEIRD_DREAM,
  MysteryEncounterType.THE_WINSTRATE_CHALLENGE,
  MysteryEncounterType.BUG_TYPE_SUPERFAN,
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
  MysteryEncounterType.DEJA_VU,
  MysteryEncounterType.CHEFS_ON_VACATION,
];

export const WILD_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.SAFARI_ZONE,
  MysteryEncounterType.FIERY_FALLOUT,
  MysteryEncounterType.FUN_AND_GAMES,
  MysteryEncounterType.UNCOMMON_BREED,
  MysteryEncounterType.GTS_MALFUNCTION,
];

export const BOSS_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.TRASH_TO_TREASURE,
  MysteryEncounterType.BERRIES_ABOUND,
];

export const MULTI_BOSS_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHEST,
  MysteryEncounterType.DARK_DEAL,
  MysteryEncounterType.FIGHT_OR_FLIGHT,
  MysteryEncounterType.SLUMBERING_SNORLAX,
  MysteryEncounterType.TRAINING_SESSION,
  MysteryEncounterType.THE_STRONG_STUFF,
  MysteryEncounterType.ABSOLUTE_AVARICE,
  MysteryEncounterType.CLOWNING_AROUND,
  MysteryEncounterType.DANCING_LESSONS,
  MysteryEncounterType.TELEPORTING_HIJINKS,
];

// These battles use special field ownership or mixed-alliance targeting rules.
export const SPECIAL_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.SHINY_BADGE,
  MysteryEncounterType.LEGENDARY_CONFLICT,
  MysteryEncounterType.POKE_POACHERS,
];

export const NON_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.DEPARTMENT_STORE_SALE,
  MysteryEncounterType.SHADY_VITAMIN_DEALER,
  MysteryEncounterType.FIELD_TRIP,
  MysteryEncounterType.LOST_AT_SEA,
  MysteryEncounterType.THE_POKEMON_SALESMAN,
  MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE,
  MysteryEncounterType.DELIBIRDY,
  MysteryEncounterType.PART_TIMER,
  MysteryEncounterType.GLOBAL_TRADE_SYSTEM,
  MysteryEncounterType.IT_IS_DANGEROUS_TO_GO_ALONE,
  MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
  MysteryEncounterType.CONTEST_HALL,
  MysteryEncounterType.MINING,
];

export const MYSTERY_ENCOUNTER_BATTLE_GROUPS = {
  "trainer-battle": TRAINER_BATTLE_MYSTERY_ENCOUNTERS,
  "wild-battle": WILD_BATTLE_MYSTERY_ENCOUNTERS,
  "boss-battle": BOSS_BATTLE_MYSTERY_ENCOUNTERS,
  "multi-boss-battle": MULTI_BOSS_BATTLE_MYSTERY_ENCOUNTERS,
  "special-battle": SPECIAL_BATTLE_MYSTERY_ENCOUNTERS,
  "non-battle": NON_BATTLE_MYSTERY_ENCOUNTERS,
} as const satisfies Record<MysteryEncounterBattleGroup, readonly MysteryEncounterType[]>;

const MYSTERY_ENCOUNTER_BATTLE_GROUP_BY_TYPE = new Map<MysteryEncounterType, MysteryEncounterBattleGroup>();
for (const [group, encounterTypes] of Object.entries(MYSTERY_ENCOUNTER_BATTLE_GROUPS) as [
  MysteryEncounterBattleGroup,
  readonly MysteryEncounterType[],
][]) {
  for (const encounterType of encounterTypes) {
    MYSTERY_ENCOUNTER_BATTLE_GROUP_BY_TYPE.set(encounterType, group);
  }
}

export const TWO_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST: readonly MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHEST,
  MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
  MysteryEncounterType.DARK_DEAL,
  MysteryEncounterType.FIGHT_OR_FLIGHT,
  MysteryEncounterType.SLUMBERING_SNORLAX,
  MysteryEncounterType.TRAINING_SESSION,
  MysteryEncounterType.DEPARTMENT_STORE_SALE,
  MysteryEncounterType.SHADY_VITAMIN_DEALER,
  MysteryEncounterType.SAFARI_ZONE,
  MysteryEncounterType.LOST_AT_SEA,
  MysteryEncounterType.FIERY_FALLOUT,
  MysteryEncounterType.THE_STRONG_STUFF,
  MysteryEncounterType.THE_POKEMON_SALESMAN,
  MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE,
  MysteryEncounterType.DELIBIRDY,
  MysteryEncounterType.ABSOLUTE_AVARICE,
  MysteryEncounterType.A_TRAINERS_TEST,
  MysteryEncounterType.TRASH_TO_TREASURE,
  MysteryEncounterType.BERRIES_ABOUND,
  MysteryEncounterType.CLOWNING_AROUND,
  MysteryEncounterType.PART_TIMER,
  MysteryEncounterType.DANCING_LESSONS,
  MysteryEncounterType.WEIRD_DREAM,
  MysteryEncounterType.THE_WINSTRATE_CHALLENGE,
  MysteryEncounterType.TELEPORTING_HIJINKS,
  MysteryEncounterType.BUG_TYPE_SUPERFAN,
  MysteryEncounterType.FUN_AND_GAMES,
  MysteryEncounterType.UNCOMMON_BREED,
  MysteryEncounterType.GLOBAL_TRADE_SYSTEM,
  MysteryEncounterType.GTS_MALFUNCTION,
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
  MysteryEncounterType.SHINY_BADGE,
  MysteryEncounterType.LEGENDARY_CONFLICT,
  MysteryEncounterType.POKE_POACHERS,
  MysteryEncounterType.CHEFS_ON_VACATION,
  MysteryEncounterType.IT_IS_DANGEROUS_TO_GO_ALONE,
  MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
  MysteryEncounterType.CONTEST_HALL,
  MysteryEncounterType.DEJA_VU,
  MysteryEncounterType.MINING,
];

export const THREE_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST: readonly MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHEST,
  MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
  MysteryEncounterType.DARK_DEAL,
  MysteryEncounterType.FIGHT_OR_FLIGHT,
  MysteryEncounterType.SLUMBERING_SNORLAX,
  MysteryEncounterType.TRAINING_SESSION,
  MysteryEncounterType.DEPARTMENT_STORE_SALE,
  MysteryEncounterType.SHADY_VITAMIN_DEALER,
  MysteryEncounterType.SAFARI_ZONE,
  MysteryEncounterType.LOST_AT_SEA,
  MysteryEncounterType.FIERY_FALLOUT,
  MysteryEncounterType.THE_STRONG_STUFF,
  MysteryEncounterType.THE_POKEMON_SALESMAN,
  MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE,
  MysteryEncounterType.ABSOLUTE_AVARICE,
  MysteryEncounterType.A_TRAINERS_TEST,
  MysteryEncounterType.DELIBIRDY,
  MysteryEncounterType.TRASH_TO_TREASURE,
  MysteryEncounterType.BERRIES_ABOUND,
  MysteryEncounterType.CLOWNING_AROUND,
  MysteryEncounterType.PART_TIMER,
  MysteryEncounterType.DANCING_LESSONS,
  MysteryEncounterType.WEIRD_DREAM,
  MysteryEncounterType.THE_WINSTRATE_CHALLENGE,
  MysteryEncounterType.TELEPORTING_HIJINKS,
  MysteryEncounterType.BUG_TYPE_SUPERFAN,
  MysteryEncounterType.GLOBAL_TRADE_SYSTEM,
  MysteryEncounterType.GTS_MALFUNCTION,
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
  MysteryEncounterType.SHINY_BADGE,
  MysteryEncounterType.LEGENDARY_CONFLICT,
  MysteryEncounterType.POKE_POACHERS,
  MysteryEncounterType.CHEFS_ON_VACATION,
  MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
  MysteryEncounterType.CONTEST_HALL,
  MysteryEncounterType.DEJA_VU,
  MysteryEncounterType.MINING,
];

// Limited-party and Vs allowlists intentionally start by mirroring full co-op.
// Future balance passes can narrow these without disturbing full co-op behavior.
export const TWO_PLAYER_LIMITED_COOP_MYSTERY_ENCOUNTER_ALLOWLIST: readonly MysteryEncounterType[] =
  TWO_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;
export const THREE_PLAYER_LIMITED_COOP_MYSTERY_ENCOUNTER_ALLOWLIST: readonly MysteryEncounterType[] =
  THREE_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;
export const TWO_PLAYER_VS_MYSTERY_ENCOUNTER_ALLOWLIST: readonly MysteryEncounterType[] =
  TWO_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;

export function getMysteryEncounterCompatibilityMode(
  context: MysteryEncounterCompatibilityContext,
): MysteryEncounterCompatibilityMode {
  if (!context.twoPlayerMode) {
    return "single-player";
  }

  if (context.twoPlayerVsMode) {
    return "two-player-vs";
  }

  const isLimitedParty = context.twoPlayerPartySize === 3;
  if (context.multiplayerPlayerCount >= 3) {
    return isLimitedParty ? "three-player-limited-coop" : "three-player-full-coop";
  }

  return isLimitedParty ? "two-player-limited-coop" : "two-player-full-coop";
}

export function getMysteryEncounterCompatibilityAllowlist(
  context: MysteryEncounterCompatibilityContext,
): readonly MysteryEncounterType[] {
  switch (getMysteryEncounterCompatibilityMode(context)) {
    case "single-player":
      return [];
    case "two-player-full-coop":
      return TWO_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;
    case "three-player-full-coop":
      return THREE_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;
    case "two-player-limited-coop":
      return TWO_PLAYER_LIMITED_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;
    case "three-player-limited-coop":
      return THREE_PLAYER_LIMITED_COOP_MYSTERY_ENCOUNTER_ALLOWLIST;
    case "two-player-vs":
      return TWO_PLAYER_VS_MYSTERY_ENCOUNTER_ALLOWLIST;
  }
}

export function isLimitedPartyMysteryEncounterCompatibilityMode(
  mode: MysteryEncounterCompatibilityMode,
): boolean {
  return mode === "two-player-limited-coop" || mode === "three-player-limited-coop";
}

export function getMysteryEncounterBattleGroup(
  encounterType: MysteryEncounterType,
): MysteryEncounterBattleGroup | undefined {
  return MYSTERY_ENCOUNTER_BATTLE_GROUP_BY_TYPE.get(encounterType);
}

export function getMysteryEncounterTypesByBattleGroup(
  group: MysteryEncounterBattleGroup,
): readonly MysteryEncounterType[] {
  return MYSTERY_ENCOUNTER_BATTLE_GROUPS[group];
}

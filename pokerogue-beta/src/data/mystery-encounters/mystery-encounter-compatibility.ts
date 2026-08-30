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

export type MysteryEncounterVsVariant =
  | "disabled"
  | "owner-scoped-non-battle"
  | "native-lane-trainer-battle"
  | "solo-sequence-trainer-battle"
  | "split-pve-battle"
  | "competitive-shared"
  | "special-scripted";

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

export const VS_DISABLED_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.FIELD_TRIP,
  MysteryEncounterType.GTS_MALFUNCTION,
  MysteryEncounterType.SAFARI_ZONE,
  MysteryEncounterType.CHEFS_ON_VACATION,
  MysteryEncounterType.IT_IS_DANGEROUS_TO_GO_ALONE,
];

export const VS_OWNER_SCOPED_NON_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.DEPARTMENT_STORE_SALE,
  MysteryEncounterType.SHADY_VITAMIN_DEALER,
  MysteryEncounterType.LOST_AT_SEA,
  MysteryEncounterType.THE_POKEMON_SALESMAN,
  MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE,
  MysteryEncounterType.DELIBIRDY,
  MysteryEncounterType.PART_TIMER,
  MysteryEncounterType.GLOBAL_TRADE_SYSTEM,
  MysteryEncounterType.MINING,
];

export const VS_NATIVE_LANE_TRAINER_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
  MysteryEncounterType.A_TRAINERS_TEST,
  MysteryEncounterType.BUG_TYPE_SUPERFAN,
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
];

export const VS_SOLO_SEQUENCE_TRAINER_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.THE_WINSTRATE_CHALLENGE,
];

export const VS_SPLIT_PVE_BATTLE_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.FIGHT_OR_FLIGHT,
  MysteryEncounterType.SLUMBERING_SNORLAX,
  MysteryEncounterType.TRAINING_SESSION,
  MysteryEncounterType.FIERY_FALLOUT,
  MysteryEncounterType.THE_STRONG_STUFF,
  MysteryEncounterType.TRASH_TO_TREASURE,
  MysteryEncounterType.BERRIES_ABOUND,
  MysteryEncounterType.CLOWNING_AROUND,
  MysteryEncounterType.DANCING_LESSONS,
  MysteryEncounterType.UNCOMMON_BREED,
];

export const VS_COMPETITIVE_SHARED_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.MYSTERIOUS_CHEST,
  MysteryEncounterType.ABSOLUTE_AVARICE,
  MysteryEncounterType.FUN_AND_GAMES,
  MysteryEncounterType.TELEPORTING_HIJINKS,
  MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
];

export const VS_SPECIAL_SCRIPTED_MYSTERY_ENCOUNTERS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.DARK_DEAL,
  MysteryEncounterType.WEIRD_DREAM,
  MysteryEncounterType.DEJA_VU,
  MysteryEncounterType.SHINY_BADGE,
  MysteryEncounterType.LEGENDARY_CONFLICT,
  MysteryEncounterType.POKE_POACHERS,
  MysteryEncounterType.CONTEST_HALL,
];

export const MYSTERY_ENCOUNTER_VS_VARIANTS = {
  disabled: VS_DISABLED_MYSTERY_ENCOUNTERS,
  "owner-scoped-non-battle": VS_OWNER_SCOPED_NON_BATTLE_MYSTERY_ENCOUNTERS,
  "native-lane-trainer-battle": VS_NATIVE_LANE_TRAINER_BATTLE_MYSTERY_ENCOUNTERS,
  "solo-sequence-trainer-battle": VS_SOLO_SEQUENCE_TRAINER_BATTLE_MYSTERY_ENCOUNTERS,
  "split-pve-battle": VS_SPLIT_PVE_BATTLE_MYSTERY_ENCOUNTERS,
  "competitive-shared": VS_COMPETITIVE_SHARED_MYSTERY_ENCOUNTERS,
  "special-scripted": VS_SPECIAL_SCRIPTED_MYSTERY_ENCOUNTERS,
} as const satisfies Record<MysteryEncounterVsVariant, readonly MysteryEncounterType[]>;

const MYSTERY_ENCOUNTER_VS_VARIANT_BY_TYPE = new Map<MysteryEncounterType, MysteryEncounterVsVariant>();
for (const [variant, encounterTypes] of Object.entries(MYSTERY_ENCOUNTER_VS_VARIANTS) as [
  MysteryEncounterVsVariant,
  readonly MysteryEncounterType[],
][]) {
  for (const encounterType of encounterTypes) {
    MYSTERY_ENCOUNTER_VS_VARIANT_BY_TYPE.set(encounterType, variant);
  }
}

export function getMysteryEncounterVsVariantForType(
  encounterType: MysteryEncounterType,
): MysteryEncounterVsVariant | undefined {
  return MYSTERY_ENCOUNTER_VS_VARIANT_BY_TYPE.get(encounterType);
}

export function isMysteryEncounterAllowedInVsMode(encounterType: MysteryEncounterType): boolean {
  const variant = getMysteryEncounterVsVariantForType(encounterType);
  return variant != null && variant !== "disabled";
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
  TWO_PLAYER_FULL_COOP_MYSTERY_ENCOUNTER_ALLOWLIST.filter(isMysteryEncounterAllowedInVsMode);

const LIMITED_PARTY_TRAINER_CAP_EXEMPTIONS: readonly MysteryEncounterType[] = [
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
];

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

export function getLimitedPartyMysteryEncounterTrainerPokemonLimit(
  context: MysteryEncounterCompatibilityContext,
  encounterType?: MysteryEncounterType,
): number | undefined {
  if (
    encounterType == null
    || getMysteryEncounterBattleGroup(encounterType) !== "trainer-battle"
    || LIMITED_PARTY_TRAINER_CAP_EXEMPTIONS.includes(encounterType)
  ) {
    return undefined;
  }

  switch (getMysteryEncounterCompatibilityMode(context)) {
    case "two-player-limited-coop":
      return 3;
    case "three-player-limited-coop":
      return 2;
    default:
      return undefined;
  }
}

export function getMysteryEncounterVsVariant(
  context: MysteryEncounterCompatibilityContext,
  encounterType?: MysteryEncounterType,
): MysteryEncounterVsVariant | undefined {
  if (encounterType == null || getMysteryEncounterCompatibilityMode(context) !== "two-player-vs") {
    return undefined;
  }

  return getMysteryEncounterVsVariantForType(encounterType);
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

export function getMysteryEncounterTypesByVsVariant(
  variant: MysteryEncounterVsVariant,
): readonly MysteryEncounterType[] {
  return MYSTERY_ENCOUNTER_VS_VARIANTS[variant];
}

import { PlayerGender } from "#enums/player-gender";

export enum PlayerTrainerSprite {
  BASE_BOY,
  BASE_GIRL,
  BUCK,
  CHERYL,
  DAWN_DP,
  DAWN_PT,
  DAWN_ZORUA,
  ETHAN,
  LUCAS_DP,
  LUCAS_PT,
  LYRA,
  MARLEY,
  MIRA,
  RILEY,
  SILVER,
}

export interface PlayerTrainerSpriteOption {
  sprite: PlayerTrainerSprite;
  label: string;
  atlasKey: string;
  gender: PlayerGender;
  yOffset: number;
}

export const PLAYER_TRAINER_SPRITE_OPTIONS: PlayerTrainerSpriteOption[] = [
  {
    sprite: PlayerTrainerSprite.BASE_BOY,
    label: "Boy",
    atlasKey: "trainer_m_back",
    gender: PlayerGender.MALE,
    yOffset: 0,
  },
  {
    sprite: PlayerTrainerSprite.BASE_GIRL,
    label: "Girl",
    atlasKey: "trainer_f_back",
    gender: PlayerGender.FEMALE,
    yOffset: 0,
  },
  { sprite: PlayerTrainerSprite.BUCK, label: "Buck", atlasKey: "buck_back", gender: PlayerGender.MALE, yOffset: -54 },
  {
    sprite: PlayerTrainerSprite.CHERYL,
    label: "Cheryl",
    atlasKey: "cheryl_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DAWN_DP,
    label: "Dawn (DP)",
    atlasKey: "dawn_dp_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DAWN_PT,
    label: "Dawn (Pt)",
    atlasKey: "dawn_pt_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DAWN_ZORUA,
    label: "Dawn?",
    atlasKey: "dawn_zorua_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.ETHAN,
    label: "Ethan",
    atlasKey: "ethan_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.LUCAS_DP,
    label: "Lucas (DP)",
    atlasKey: "lucas_dp_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.LUCAS_PT,
    label: "Lucas (Pt)",
    atlasKey: "lucas_pt_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  { sprite: PlayerTrainerSprite.LYRA, label: "Lyra", atlasKey: "lyra_back", gender: PlayerGender.FEMALE, yOffset: -54 },
  {
    sprite: PlayerTrainerSprite.MARLEY,
    label: "Marley",
    atlasKey: "marley_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  { sprite: PlayerTrainerSprite.MIRA, label: "Mira", atlasKey: "mira_back", gender: PlayerGender.FEMALE, yOffset: -54 },
  {
    sprite: PlayerTrainerSprite.RILEY,
    label: "Riley",
    atlasKey: "riley_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.SILVER,
    label: "Silver",
    atlasKey: "silver_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
];

export const PLAYER_BOY_TRAINER_SPRITES: PlayerTrainerSprite[] = [
  PlayerTrainerSprite.BASE_BOY,
  PlayerTrainerSprite.LUCAS_DP,
  PlayerTrainerSprite.LUCAS_PT,
  PlayerTrainerSprite.BUCK,
  PlayerTrainerSprite.RILEY,
  PlayerTrainerSprite.ETHAN,
  PlayerTrainerSprite.SILVER,
];

export const PLAYER_GIRL_TRAINER_SPRITES: PlayerTrainerSprite[] = [
  PlayerTrainerSprite.BASE_GIRL,
  PlayerTrainerSprite.DAWN_DP,
  PlayerTrainerSprite.DAWN_PT,
  PlayerTrainerSprite.DAWN_ZORUA,
  PlayerTrainerSprite.CHERYL,
  PlayerTrainerSprite.LYRA,
  PlayerTrainerSprite.MARLEY,
  PlayerTrainerSprite.MIRA,
];

const PLAYER_TRAINER_FRONT_SPRITE_KEYS: Record<PlayerTrainerSprite, string> = {
  [PlayerTrainerSprite.BASE_BOY]: "unknown_m",
  [PlayerTrainerSprite.BASE_GIRL]: "unknown_f",
  [PlayerTrainerSprite.BUCK]: "buck",
  [PlayerTrainerSprite.CHERYL]: "cheryl",
  [PlayerTrainerSprite.DAWN_DP]: "dawn_dp",
  [PlayerTrainerSprite.DAWN_PT]: "dawn_pt",
  [PlayerTrainerSprite.DAWN_ZORUA]: "dawn_zorua",
  [PlayerTrainerSprite.ETHAN]: "ethan",
  [PlayerTrainerSprite.LUCAS_DP]: "lucas_dp",
  [PlayerTrainerSprite.LUCAS_PT]: "lucas_pt",
  [PlayerTrainerSprite.LYRA]: "lyra",
  [PlayerTrainerSprite.MARLEY]: "marley",
  [PlayerTrainerSprite.MIRA]: "mira",
  [PlayerTrainerSprite.RILEY]: "riley",
  [PlayerTrainerSprite.SILVER]: "silver",
};

export function getPlayerTrainerSpriteOption(sprite: PlayerTrainerSprite): PlayerTrainerSpriteOption {
  return PLAYER_TRAINER_SPRITE_OPTIONS[sprite] ?? PLAYER_TRAINER_SPRITE_OPTIONS[PlayerTrainerSprite.BASE_BOY];
}

export function getPlayerTrainerSpriteName(sprite: PlayerTrainerSprite): string {
  if (isBasePlayerTrainerSprite(sprite)) {
    return "Alex";
  }

  return getPlayerTrainerSpriteOption(sprite).label.replace(/\s+\(.+\)$/, "");
}

export function getPlayerTrainerSpriteBackTextureKey(sprite: PlayerTrainerSprite, pokeball = false): string {
  const atlasKey = getPlayerTrainerSpriteOption(sprite).atlasKey;
  return `${atlasKey}${pokeball ? "_pb" : ""}`;
}

export function getPlayerTrainerSpriteFrontTextureKey(sprite: PlayerTrainerSprite): string {
  return PLAYER_TRAINER_FRONT_SPRITE_KEYS[sprite] ?? PLAYER_TRAINER_FRONT_SPRITE_KEYS[PlayerTrainerSprite.BASE_BOY];
}

export function getPlayerTrainerSpriteYOffset(sprite: PlayerTrainerSprite): number {
  return getPlayerTrainerSpriteOption(sprite).yOffset;
}

export function getDefaultPlayerTrainerSpriteForGender(gender: PlayerGender): PlayerTrainerSprite {
  return gender === PlayerGender.FEMALE ? PlayerTrainerSprite.BASE_GIRL : PlayerTrainerSprite.BASE_BOY;
}

export function isBasePlayerTrainerSprite(sprite: PlayerTrainerSprite): boolean {
  return sprite === PlayerTrainerSprite.BASE_BOY || sprite === PlayerTrainerSprite.BASE_GIRL;
}

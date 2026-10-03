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
  BIANCA_LATIAS,
  DUPLICA_DITTO,
  MOLLY_HALE,
  WHITNEY,
  SABRINA,
  BIANCA,
  DUPLICA,
  AMBER_TWO,
}

export interface PlayerTrainerSpriteOption {
  sprite: PlayerTrainerSprite;
  label: string;
  atlasKey: string;
  backAtlasFile?: string;
  pokeballAtlasFile?: string;
  gender: PlayerGender;
  yOffset: number;
  scale?: number;
  source?: string;
  artist?: string;
}

export const PLAYER_TRAINER_SPRITE_OPTIONS: PlayerTrainerSpriteOption[] = [
  {
    sprite: PlayerTrainerSprite.BASE_BOY,
    label: "Kyle",
    artist: "PKRogue",
    atlasKey: "trainer_m_back",
    gender: PlayerGender.MALE,
    yOffset: 0,
  },
  {
    sprite: PlayerTrainerSprite.BASE_GIRL,
    label: "Amber",
    artist: "PKRogue",
    atlasKey: "trainer_f_back",
    gender: PlayerGender.FEMALE,
    yOffset: 0,
  },
  {
    sprite: PlayerTrainerSprite.BUCK,
    label: "Buck",
    artist: "Ken Sugimori",
    atlasKey: "buck_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.CHERYL,
    label: "Cheryl",
    artist: "Ken Sugimori",
    atlasKey: "cheryl_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DAWN_DP,
    label: "Dawn (DP)",
    artist: "Ken Sugimori",
    atlasKey: "dawn_dp_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DAWN_PT,
    label: "Dawn (Pt)",
    artist: "Ken Sugimori",
    atlasKey: "dawn_pt_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DAWN_ZORUA,
    label: "Dawn?",
    artist: "Bio(E)",
    atlasKey: "dawn_zorua_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.ETHAN,
    label: "Ethan",
    artist: "Ken Sugimori",
    atlasKey: "ethan_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.LUCAS_DP,
    label: "Lucas (DP)",
    artist: "Ken Sugimori",
    atlasKey: "lucas_dp_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.LUCAS_PT,
    label: "Lucas (Pt)",
    artist: "Ken Sugimori",
    atlasKey: "lucas_pt_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.LYRA,
    label: "Lyra",
    artist: "Takao Unno",
    atlasKey: "lyra_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.MARLEY,
    label: "Marley",
    artist: "Ken Sugimori",
    atlasKey: "marley_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.MIRA,
    label: "Mira",
    artist: "Ken Sugimori",
    atlasKey: "mira_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.RILEY,
    label: "Riley",
    artist: "Ken Sugimori",
    atlasKey: "riley_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.SILVER,
    label: "Silver",
    artist: "Ken Sugimori",
    atlasKey: "silver_back",
    gender: PlayerGender.MALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.BIANCA_LATIAS,
    label: "Bianca?",
    artist: "Ejay",
    atlasKey: "bianca_latias_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DUPLICA_DITTO,
    label: "Duplica?",
    artist: "Bio(E)",
    atlasKey: "duplica_ditto_back_mid117",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.MOLLY_HALE,
    label: "Molly",
    artist: "Gopokenohito/Bio",
    atlasKey: "molly_hale_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.WHITNEY,
    label: "Whitney",
    artist: "mid117",
    atlasKey: "whitney_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
    scale: 0.5,
  },
  {
    sprite: PlayerTrainerSprite.SABRINA,
    label: "Sabrina",
    artist: "Mid117",
    atlasKey: "sabrina_back",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
    scale: 0.5,
  },
  {
    sprite: PlayerTrainerSprite.BIANCA,
    label: "Bianca",
    artist: "Ejay",
    atlasKey: "bianca_back",
    backAtlasFile: "bianca_pb",
    pokeballAtlasFile: "bianca_pb",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.DUPLICA,
    label: "Duplica",
    artist: "Bio(E)",
    atlasKey: "duplica_back_mid117",
    gender: PlayerGender.FEMALE,
    yOffset: -54,
  },
  {
    sprite: PlayerTrainerSprite.AMBER_TWO,
    label: "AmberTwo",
    artist: "Bio",
    atlasKey: "amber_two_back",
    backAtlasFile: "amber_two_back_pb",
    gender: PlayerGender.FEMALE,
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
  PlayerTrainerSprite.BIANCA_LATIAS,
  PlayerTrainerSprite.DUPLICA_DITTO,
  PlayerTrainerSprite.CHERYL,
  PlayerTrainerSprite.LYRA,
  PlayerTrainerSprite.MARLEY,
  PlayerTrainerSprite.MIRA,
  PlayerTrainerSprite.MOLLY_HALE,
  PlayerTrainerSprite.WHITNEY,
  PlayerTrainerSprite.SABRINA,
  PlayerTrainerSprite.BIANCA,
  PlayerTrainerSprite.DUPLICA,
  PlayerTrainerSprite.AMBER_TWO,
];

const PLAYER_TRAINER_FRONT_SPRITE_KEYS: Record<PlayerTrainerSprite, string> = {
  [PlayerTrainerSprite.BASE_BOY]: "player_m",
  [PlayerTrainerSprite.BASE_GIRL]: "player_f",
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
  [PlayerTrainerSprite.BIANCA_LATIAS]: "bianca_latias",
  [PlayerTrainerSprite.DUPLICA_DITTO]: "duplica_ditto",
  [PlayerTrainerSprite.MOLLY_HALE]: "molly_hale",
  [PlayerTrainerSprite.WHITNEY]: "whitney",
  [PlayerTrainerSprite.SABRINA]: "sabrina",
  [PlayerTrainerSprite.BIANCA]: "bianca",
  [PlayerTrainerSprite.DUPLICA]: "duplica",
  [PlayerTrainerSprite.AMBER_TWO]: "amber_two",
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

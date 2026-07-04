export interface ContestEffectData {
  id: number;
  appeal: number;
  jam: number;
  effect: string;
  flavorText: string;
}

export interface SuperContestEffectData {
  id: number;
  appeal: number;
  flavorText: string;
}

export const contestEffects = {
  1: {
    id: 1,
    appeal: 4,
    jam: 0,
    effect: "Gives a high number of appeal points with no other effects.",
    flavorText: "A highly appealing move.",
  },
  2: {
    id: 2,
    appeal: 3,
    jam: 0,
    effect:
      "If the Pokemon that appealed before the user earned less than three appeal points, user earns six; if three, user earns three; if more than three, user earns none.",
    flavorText: "Affected by how well the appeal in front goes.",
  },
  3: {
    id: 3,
    appeal: 6,
    jam: 0,
    effect: "If the user is jammed this turn after using this move, it will receive twice as many jam points.",
    flavorText: "After this move, the user is more easily startled.",
  },
  4: {
    id: 4,
    appeal: 1,
    jam: 4,
    effect: "Attempts to jam the Pokemon that appealed before the user.",
    flavorText: "Badly startles the Pokemon in front.",
  },
  5: {
    id: 5,
    appeal: 1,
    jam: 3,
    effect: "Attempts to jam all Pokemon that have appealed this turn.",
    flavorText: "Badly startles those that have made appeals.",
  },
  6: {
    id: 6,
    appeal: 4,
    jam: 4,
    effect:
      "Attempts to jam the other Pokemon.  The user cannot make an appeal on the next turn, but it cannot be jammed either.",
    flavorText: "Jams the others, and misses one turn of appeals.",
  },
  7: {
    id: 7,
    appeal: 8,
    jam: 0,
    effect: "User cannot make any more appeals for the remainder of the contest.",
    flavorText: "Makes a great appeal, but allows no more to the end.",
  },
  8: {
    id: 8,
    appeal: 2,
    jam: 2,
    effect: "Attempts to jam all Pokemon that have appealed this turn.",
    flavorText: "Startles all Pokemon that have done their appeals.",
  },
  9: {
    id: 9,
    appeal: 2,
    jam: 3,
    effect: "Attempts to jam the Pokemon that appealed before the user.",
    flavorText: "Startles the Pokemon that appealed before the user.",
  },
  10: {
    id: 10,
    appeal: 2,
    jam: 1,
    effect:
      "Attempts to jam all Pokemon that have appealed this turn.  If a Pokemon is in combo standby status, it is jammed 5 points instead of 1.",
    flavorText: "Startles the Pokemon that has the judge's attention.",
  },
  11: {
    id: 11,
    appeal: 1,
    jam: 0,
    effect:
      "If the Applause meter is empty or at one, earns one point; if two, earns three points; if three, earns four points; if four, earns six points.",
    flavorText: "The appeal works best the more the crowd is excited.",
  },
  12: {
    id: 12,
    appeal: 2,
    jam: 0,
    effect: "If the last Pokemon's appeal is the same type as this move, user earns six points instead of two.",
    flavorText: "Works well if it's the same type as the one before.",
  },
  13: {
    id: 13,
    appeal: 1,
    jam: 0,
    effect:
      "Always adds a point to the applause meter, regardless of whether the move matches the contest, and can likewise gain the applause bonus.",
    flavorText: "An appeal that excites the audience in any contest.",
  },
  14: {
    id: 14,
    appeal: 2,
    jam: 1,
    effect: "Attempts to jam all Pokemon that have appealed this turn for half their appeal points (minimum 1).",
    flavorText: "Badly startles all Pokemon that made good appeals.",
  },
  15: {
    id: 15,
    appeal: 1,
    jam: 0,
    effect: "Prevents jamming for the rest of this turn.",
    flavorText: "Can avoid being startled by others.",
  },
  16: {
    id: 16,
    appeal: 2,
    jam: 0,
    effect: "Prevents the next jam on this turn.",
    flavorText: "Can avoid being startled by others once.",
  },
  17: {
    id: 17,
    appeal: 3,
    jam: 0,
    effect: "Repeated use does not incur a penalty.",
    flavorText: "Can be repeatedly used without boring the judge.",
  },
  18: {
    id: 18,
    appeal: 2,
    jam: 0,
    effect: "Attempts to make all following Pokemon nervous (and thus unable to appeal).",
    flavorText: "Makes all Pokemon after the user nervous.",
  },
  19: {
    id: 19,
    appeal: 1,
    jam: 0,
    effect: "User earns appeal points equal to the points the previous Pokemon earned plus one.",
    flavorText: "Makes the appeal as good as the one before it.",
  },
  20: {
    id: 20,
    appeal: 1,
    jam: 0,
    effect: "User earns appeal points equal to half the points ALL the previous Pokemon earned plus one.",
    flavorText: "Makes the appeal as good as those before it.",
  },
  21: {
    id: 21,
    appeal: 3,
    jam: 0,
    effect: "Shuffles the next turn's turn order.",
    flavorText: "Scrambles up the order of appeals on the next turn.",
  },
  22: {
    id: 22,
    appeal: 3,
    jam: 0,
    effect: "Cancels combo standby status for all Pokemon that have appealed this turn.",
    flavorText: "Shifts the judge's attention from others.",
  },
  23: {
    id: 23,
    appeal: 2,
    jam: 1,
    effect:
      "Attempts to jam all Pokemon that have appealed this turn.  If a Pokemon used the same type move as this one, it is jammed for 4 points instead of 1.",
    flavorText: "Startles Pokemon that made a same-type appeal.",
  },
  24: {
    id: 24,
    appeal: 3,
    jam: 0,
    effect: "Prevents the Applause Meter from rising for the rest of the turn.",
    flavorText: "Temporarily stops the crowd from getting excited.",
  },
  25: {
    id: 25,
    appeal: 1,
    jam: 0,
    effect: "Randomly earns one, two, four, or eight points.",
    flavorText: "The appeal's quality depends on its timing.",
  },
  26: {
    id: 26,
    appeal: 1,
    jam: 0,
    effect:
      "If user appeals first this turn, earns one point; if second, two points; if third, four points; if last, six points.",
    flavorText: "The appeal works better the later it is performed.",
  },
  27: {
    id: 27,
    appeal: 2,
    jam: 0,
    effect: "If user appeals first this turn, earns six points instead of two.",
    flavorText: "The appeal works great if performed first.",
  },
  28: {
    id: 28,
    appeal: 2,
    jam: 0,
    effect: "If user appeals last this turn, earns six points instead of two.",
    flavorText: "The appeal works great if performed last.",
  },
  29: {
    id: 29,
    appeal: 1,
    jam: 0,
    effect:
      "If user has no stars, earns one point; if one, three points; if two, five points; if three, seven points.  This does not include the appeal point bonus the stars give.",
    flavorText: "The appeal works well if the user's condition is good.",
  },
  30: {
    id: 30,
    appeal: 3,
    jam: 0,
    effect: "User will go first next turn.",
    flavorText: "The next appeal can be made earlier next turn.",
  },
  31: {
    id: 31,
    appeal: 3,
    jam: 0,
    effect: "User will go last next turn.",
    flavorText: "The next appeal can be made later next turn.",
  },
  32: {
    id: 32,
    appeal: 1,
    jam: 0,
    effect: "User gains one star.",
    flavorText: "Ups the user's condition.  Helps prevent nervousness.",
  },
  33: {
    id: 33,
    appeal: 3,
    jam: 0,
    effect: "Removes all stars from all Pokemon that have appealed this turn.",
    flavorText: "Worsens the condition of those that made appeals.",
  },
} as const satisfies Record<number, ContestEffectData>;

export const superContestEffects = {
  1: {
    id: 1,
    appeal: 2,
    flavorText: "Enables the user to perform first in the next turn.",
  },
  2: {
    id: 2,
    appeal: 2,
    flavorText: "Enables the user to perform last in the next turn.",
  },
  4: {
    id: 4,
    appeal: 2,
    flavorText: "Earn +2 if the Judge's Voltage goes up.",
  },
  5: {
    id: 5,
    appeal: 3,
    flavorText: "A basic performance using a move known by the Pokemon.",
  },
  6: {
    id: 6,
    appeal: 1,
    flavorText: "Earn +3 if no other Pokemon has chosen the same Judge.",
  },
  7: {
    id: 7,
    appeal: 2,
    flavorText: "Allows performance of the same move twice in a row.",
  },
  8: {
    id: 8,
    appeal: 0,
    flavorText: "Increased Voltage is added to the performance score.",
  },
  9: {
    id: 9,
    appeal: 0,
    flavorText: "Earn +15 if all the Pokemon choose the same Judge.",
  },
  10: {
    id: 10,
    appeal: 2,
    flavorText: "Lowers the Voltage of all Judges by one each.",
  },
  11: {
    id: 11,
    appeal: 0,
    flavorText: "Earn double the score in the next turn.",
  },
  12: {
    id: 12,
    appeal: 0,
    flavorText: "Steals the Voltage of the Pokemon that just went.",
  },
  13: {
    id: 13,
    appeal: 2,
    flavorText: "Prevents the Voltage from going up in the same turn.",
  },
  14: {
    id: 14,
    appeal: 2,
    flavorText: "Makes the order of contestants random in the next turn.",
  },
  15: {
    id: 15,
    appeal: 2,
    flavorText: "Earns double the score on the final performance.",
  },
  16: {
    id: 16,
    appeal: 0,
    flavorText: "Raises the score if the Voltage is low.",
  },
  17: {
    id: 17,
    appeal: 2,
    flavorText: "Earn +2 if the Pokemon performs first in the turn.",
  },
  18: {
    id: 18,
    appeal: 2,
    flavorText: "Earn +2 if the Pokemon performs last in the turn.",
  },
  19: {
    id: 19,
    appeal: 2,
    flavorText: "Prevents the Voltage from going down in the same turn.",
  },
  20: {
    id: 20,
    appeal: 1,
    flavorText: "Earn +3 if two Pokemon raise the Voltage in a row.",
  },
  21: {
    id: 21,
    appeal: 0,
    flavorText: "Earn a higher score the later the Pokemon performs.",
  },
  22: {
    id: 22,
    appeal: 2,
    flavorText: "Earn +3 if the Pokemon that just went hit max Voltage.",
  },
  23: {
    id: 23,
    appeal: 1,
    flavorText: "Earn +3 if the Pokemon gets the lowest score.",
  },
} as const satisfies Record<number, SuperContestEffectData>;

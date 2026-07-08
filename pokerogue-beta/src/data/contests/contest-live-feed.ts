//{CHAT_NAME}, {trainer}, {pokemon}, {contestType}, 
// {round}, {leader}, {score}, {leaderTrainer}, 
// {leaderScore}, {last}, {lastPokemon}, {lastTrainer}, 
// {lastScore}, {applause}

export const CONTEST_CHAT_NAMES = [
  "Prof. Oak","Blue","Daisy. Oak","Amber2","Brock","Misty","Lt.Surge","Erika","Koga","Sabrina","Old man","Jessie","James","Meowth","AJ","Nurse_Joy_Pewter",
  "Nurse_Joy_Lavender","Nurse_Joy_Viridian","Teala_2F_Attendant","Duplica","Mr. Fuji","Reina","Todd_Snap","Karen","Witney","Bill","Jasmine","Joey","Randy",
  "Carrie","Roxanne","Capn_Stern","Kiri","Trick_Master","Gabby&Ty","Wes","Rui","Gonzap","Mirror.B","Eagun","Celio","Lostelle","Selphy","Gideon","Walda",
  "Brandon","Anabel","Scott","Michael","Acri","Gorigan","Lunick","Solana","Aria","Genesis","Barry","Mr. Backlot","Eldritch","Rad_Rickshaw","Roseanne",
  "Mr. Goods","Lizabeth","Dusky","Terrell","Taylor","Marina","AATTVVV","Oichi","Hideyoshi","Magoichi","Okuni","Ranmaru","Turo","Sada","Bianca","Lana","Eve",
  "pokefan22","routewalker","berrypicker","tallgrasskid","potionpocket","pokemartregular","badgecase","repelrunner100","pcboxfull","daycarehelper3","nursejoyfan",
  "pokecenterwifi","quickballer37","greatballguy","grasspatch","youngsterjoeyish","trainercard","bikepathrider","mysteryegg","contestrookie37","safarizonefan",
  "pokeblockmixer","ribbonhunter3","gymguide","starterpal53","fishingrodpro","poketchuser","trainerjournal","tmcollector","hikerboots","routehopper",
  "battletentfan","pokebreeder69","contestgoer98","expseeker","pokecamper","friendshipmax","rarecandyfan","oldrodangler","bugcatcherlife11","pokeballstash",
  "berryblender","secretbasefinder","bikevoucher999999","townmapuser47","elitehopeful","everstonekeeper","fieldresearcher","wildencounter","adventurepack",
  "AA-j","AIIIIIIRRR", "AAAAAAAAAA","aaabaaajss","Solaire"


] as const;

export const CONTEST_CHAT_MESSAGES = [
  "[{CHAT_NAME}]: This is a test of the emergency broadcast system", //This is the start of the normal block
  "[{CHAT_NAME}]: {trainer}'s {pokemon} is giving the crowd {contestType} energy.",
  "[{CHAT_NAME}]: Round {round} watch: {leader} is sitting at {score} points.",
  "[Marina]: Cmon! I wanna see Kyogre win a contest one of these days!",
  "[Terrell]: dont listen to her, Marina is dumb, groudon is better",
  "[Taylor]: Dragon slayer here! go {lastTrainer}! Underdogs rule!",
  "[Todd_Snap]:This stream needs a better camera angle, i can hardly see anything",
  "[Rad_Rickshaw]: yes, this actually is my name",
  "[M.Hale]: Papa? where did you go? ... oh its you again!",
  "[Bianca]: has anyone seen my friend... err, twin? she looks just like me? I think she got lost",
  "[pokebreeder69]: I swear I didnt know the number was a joke when i picked it as a kid, please dont ban -USER-BANNED-",
  "[DNF#]:01001001 01101101 00100000 01010111 01100001 01101001 01110100 01101001 01101110 01100111",
  "[Gabby&Ty]: Oh! I think i smell a scoop Ty... its too bad we arent actually there to record anything",
  "[{CHAT_NAME}]: {leader} is definitely gonna win this\n[{CHAT_NAME_2}]: You never know, {lastPokemon} could still win this",
  "[N]: Well, I suppose it IS less violent than pokemon battles",//this is the start of the specific characters block
  "[Amber2]: has anyone seen my friend lately? hes 6'7 and super grouchy. I think I last heard him cackling wildly?",
  "[Nurse Joy]: You know when we say that we hope to see you again, we really mean dont die out there.",
  "[pcboxfull]:Why cant i hold all these pokemon!",
  "[Duplica]: shoot, one of my Dittos went missing again",
  "[Mirror.B]: Fuhohoho! This is perking up my spirit and body! Oh, I feel like dancing!",
  "[Prof.Oak]: This really isnt the time to use that",
  "[Solaire]: If only I could be so Grossly Incandescent",
  "[{CHAT_NAME}]: cmon {lastPokemon} what the heck are you doing\n[Haru Urara] Their doin their best!",//This is the start of the Urara block
  "[Haru Urara]: keep going {lastPokemon} your doing great out there!",
  "[{CHAT_NAME}]: Acquire the Sire!", //This is the start of the memes block
  "[VapLv]: Hey guys did you know that in terms of -USER-BANNED-",
  "[{CHAT_NAME}]: I wanna be, the very best\n[{CHAT_NAME_3}]:Like no-one ever was\n[{CHAT_NAME_2}]: Like no-one ever was\n[{CHAT_NAME}]: you ruined it. okay guys take it from the top.",
  "[{CHAT_NAME}]: I wanna be, the very best\n[{CHAT_NAME_2}]:Like no-one ever was\n[{CHAT_NAME_3}]: Like no-one ever was\n[{CHAT_NAME}]: to catch them is my real test\n[{CHAT_NAME_4}]: to train them is my cause!",
  "[{CHAT_NAME}]: I Will travel Across the land\n[{CHAT_NAME_2}]: Searching far and wide\n[{CHAT_NAME_3}]: Teach pokemon to understand \n[{CHAT_NAME_4}]: The power thats inside!\n[{CHAT_NAME_2}]: Pokemon! \n [{CHAT_NAME}]: Gotta catch em all!",
  "[{CHAT_NAME}]: I Will travel Across the land\n[{CHAT_NAME_2}]: Searching far and wide\n[{CHAT_NAME_4}]: Searching far and wide\n [{CHAT_NAME_3}]: SO CLOSE, DANGIT. ONE MORE TIME!",
  "[{CHAT_NAME}]: Id be doing a much better job than {lastTrainer} if I were out there.\n[{CHAT_NAME_2}]: Your just upset you didnt even qualify.",
  "[{CHAT_NAME}]: {leader} is my favorite, and im not just saying that because they are winning!",
  "[{CHAT_NAME}]: {contestType}'s are my favorite kind!",
  "[{CHAT_NAME}]: Don't Fuckle with {leader}",
  "[{CHAT_NAME}]: Don't Fuckle with Shuckle",
  "[{CHAT_NAME}]: LETS GO {leader}",
  "[{CHAT_NAME}]: LETS GO {lastPokemon}",
  "[{CHAT_NAME}]: {leaderScore} to {lastScore} I wonder who will win",
  "[{CHAT_NAME}]: go away or I shall taunt you a second time!",
  "[{CHAT_NAME}]: Hey did anyone else see that talking meowth at the consession stand?",
  "[{CHAT_NAME}]: I AM THE ONE AND ONLY!",
  "[{CHAT_NAME}]: Im just here for the half time show",
  "[{CHAT_NAME}]: hey guys how do i turn off the chat window?",
  "[{CHAT_NAME}]: Whats with this retro theme?",
  "[{CHAT_NAME}]: {leader} is cooking!",
  "[{CHAT_NAME}]: Everyone knows pokemon battles are staged.",
  "[{CHAT_NAME}]: Is this the rare BGM?",
  "[{CHAT_NAME}]: Why did they cut this out of future games?"


] as const;

export const CONTEST_AD_REEL_MESSAGES = [
  "Pokeblock Kit: feed condition, fuel ambition.",
  "Ribbon Polish: shine like you already won.",
  "Altru Inc: We keep the lights on.",
  "The Pokemon League: We keep your world turning",
  "Duff: Eda will you marry me?",
  "Eda: Of course I will Duff!",
  "Baker Detective Agency: Gotta find em all!",
  "Devon Co.: For all your living needs, we make it all",
  "Silph Co.: were there for you when failure is not an option.",
  "Pokemon Rangers: Only you can prevent wild pokemon raids.",
  "S.S.Anne: Set your cares aside and enjoy the open seas",
  "The Poketch Company: Does anyone really have to ask what we make?",
  "Rotom Phones: ... We dont need to sell it to you, you already have it",
  "The Moon: Still Haunted",
  "Digimon Uranium Version: Come play the hit new monster catching RPG!",
  "GTA7: Now open for beta testing",
  "Half Life 2.9: Almost there!",
  "Pewter Cutlery: Brock Approved!",
  "Orange Islands: Now league accredited!",
  "PokeFlute Co.: For waking even the most stubborn roadblocks",



] as const;

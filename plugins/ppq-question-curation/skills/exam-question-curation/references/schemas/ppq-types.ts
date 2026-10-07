export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Extensible { [key: string]: unknown }
export interface BankContributor extends Extensible { name:string; model:string|null }
export interface BankProvenance extends Extensible { version:1; origin:'first-party'|'third-party'; verification:'unverified'|'source-verified'; creator:BankContributor; packagedBy:BankContributor; packagedAt:string }
export interface BankRecord extends Extensible { type:'bank'; schema:'ppq-base/1'; id:string; title:string; language:string; provenance?:BankProvenance }
export interface PaperVariant extends Extensible { code:string; region?:string }
export interface SourceRecord extends Extensible { type:'source'; id:string; board:'cie'|'edexcel'; subject:'Physics'|'Computer Science'|string; qualification:string; code:string; series:string; paper:string; variant?:PaperVariant; qp?:string; ms?:string }
export interface AssetRecord extends Extensible { type:'asset'; id:string; path:string; mediaType:string; sha256:string }
export interface MarkPoint extends Extensible { id:string; marks:number; label:string; all?:string[][]; requires?:string[]; reject?:string[]; manual?:boolean; notes?:string }
export interface MarkScheme extends Extensible { raw:string; version:string; points:MarkPoint[]; cap?:number; ignorePunctuation?:boolean }
export interface Option extends Extensible { id:string; text:string; points:string[]; group?:string }
export interface Blank extends Extensible { id:string; label:string; accepted:string[]; points:string[] }
export interface NumericAnswerSpec extends Extensible { accepted:number[]; absoluteTolerance?:number; relativeTolerance?:number; unit?:string; points:string[] }
export interface EssayRequirements extends Extensible { groups?:Record<string,number>; judgementLast?:boolean; pairedActions?:string[][]; pairCount?:number }
/** Sentence assembly checks are learning feedback; original examination marks remain manual. */
export interface EssayAnswerSpec extends Extensible { minimum:number; maximum:number; accepted:string[]; required?:string[]; modelOrder:string[]; chains?:string[][]; requirements?:EssayRequirements }
export type ModeKind='single'|'multi'|'cloze'|'short'|'numeric'|'essay';
export interface QuestionMode extends Extensible { id:string; kind:ModeKind; label:string; prompt?:string; options?:Option[]; correct?:string[]; maxSelections?:number; blanks?:Blank[]; template?:string; numeric?:NumericAnswerSpec; essay?:EssayAnswerSpec; /** Selected full-credit pathway for capped alternatives, only in cloze/single modes. */ pointScope?:string[] }
export interface SourceOccurrence extends Extensible { part:string; marks:number; location?:{qpPage:number;msPage:number}; markSchemeRaw:string }
export interface SourceDetails extends SourceOccurrence { location:{qpPage:number;msPage:number} }
export interface QuestionOrigin {bankId:string;questionId:string;revision:number;chapter?:string;original?:QuestionRecord;source?:SourceRecord;bankTitle?:string}
export interface QuestionScope {runtime:true;bankId:string;questionId:string;canonicalId:string;members:QuestionOrigin[];original:QuestionRecord}
export interface PaperColumn extends Extensible { label:string; align?:'left'|'center'|'right'; width?:number }
export interface PaperCell extends Extensible { text:string; span?:number; align?:'left'|'center'|'right'; rule?:'single'|'double' }
export interface PaperRow extends Extensible { cells:PaperCell[]; rule?:'single'|'double' }
export interface PaperTable extends Extensible { columns:PaperColumn[]; rows:PaperRow[]; blankRows?:number }
export type PaperBlock = ({kind:'stem'|'context'} & Extensible) | ({kind:'text';text:string} & Extensible) | ({kind:'table';title:string;table:PaperTable} & Extensible) | ({kind:'ledger';title:string;debit:PaperTable;credit:PaperTable;debitLabel?:string;creditLabel?:string} & Extensible);
export interface PaperLayout extends Extensible { version:1; blocks:PaperBlock[] }
export interface QuestionRecord extends Extensible { __scope?:QuestionScope; type:'question'; id:string; rev:number; source:string|string[]; sourceDetails?:Record<string,SourceDetails>; part:string; stem:string; context?:string; paperLayout?:PaperLayout; marks:number; chapter?:string; concept:string; difficulty?:{level:string;basis:string}; location?:{qpPage:number;msPage:number}; mark_scheme:MarkScheme; modes:QuestionMode[]; meta?:Record<string,unknown> }
export type BaseRecord=BankRecord|SourceRecord|AssetRecord|QuestionRecord;
export interface QuestionBank { records:BaseRecord[]; raw:string; assets:Map<string,Uint8Array>; unavailableAssets?:ReadonlySet<string>; /** Flat conflicting versions retained with original attachments for export or recovery. */ syncConflicts?:QuestionBank[] }
export type Answer = string | string[] | Record<string,string>;
export interface PointResult { id:string; awarded:number; possible:number; matched:string[]; missing:string[]; needsReview:boolean; reason?:string }
export interface Grade { score:number; max:number; points:PointResult[]; needsReview:boolean; method:'deterministic'|'keyword'|'self-review' }
export interface ScoreOverride { score:number; points?:Record<string,number>; note:string; at:string }
export interface AttemptXP { version:2; coefficient:number; modeMultiplier:number; maxXP:number; basis:'declared'|'estimated'; difficultyBasis:string }
export interface Attempt { id:string; questionId:string; questionRev:number; question:QuestionRecord; source:SourceRecord; modeId:string; answer:Answer; grade:Grade; submittedAt:string; firstSubmittedAt?:string; xp?:AttemptXP; overrides:ScoreOverride[]; override?:ScoreOverride; flagged:boolean }
export type PracticeDifficulty='confidence'|'balanced'|'challenging';
export type ScoreGroup='independent'|'guided';
export type PracticeSchedule='recommended'|'mixed'|'catch-up';
export interface LearningPreferences { retention:number; dailyLimit:number; newQuestionRatio:number }
export interface ReviewEvent { id:string; sessionId:string; attemptId:string; questionKey:string; contentKey:string; sourceKey:string; answerKey:string; occurredAt:string; scoreGroup:ScoreGroup; modeId:string; score:number|null; max:number; method:Grade['method']; version:1 }
export interface PracticeSelection { chapterKeys:string[]; count:number; shuffle:boolean; difficulty:PracticeDifficulty; schedule?:PracticeSchedule }
export interface PracticeChapter { bankId?:string;bankTitle?:string; bankIds:string[];bankTitles:string[];legacyKeys:string[]; key:string; courseKey:string; label:string; subject:string; board:SourceRecord['board']; code:string; qualification:string; questions:QuestionRecord[]; sources:SourceRecord[] }
export interface ChapterStatistics { total:number; practiced:number; unpracticed:number; graded:number; earned:number; possible:number; errorRate:number|null }
export interface Session { id:string; bankId?:string; bankIds?:string[]; resources?:QuestionBank; userId?:string; selection?:PracticeSelection; questions:QuestionRecord[]; sources:SourceRecord[]; attempts:Attempt[]; modeAttempts?:Attempt[]; drafts:Record<string,{modeId:string;answer:Answer}>; /** Concurrent versions retained for manual recovery without counting twice. */ syncConflicts?:{attempts:Attempt[];drafts:Record<string,{modeId:string;answer:Answer}[]>}; startedAt:string; completedAt?:string; bonusAwarded:boolean; purpose:'mixed'|'chapter'|'review'|'custom' }
export type ThemeName='default'|'sage'|'mist'|'apricot'|'lilac';
export type MotionPreference='off'|'subtle'|'expressive';
export interface Preferences { learning?:LearningPreferences; theme?:ThemeName; practiceFocus?:boolean; progressGlass?:boolean; seenGuidance?:ModeKind[]; paperStyle:'auto'|'cie'|'edexcel'; density:'paper'|'comfortable'; illustrations:'off'|'minimal'|'expressive'; operationSound:boolean; resultSound:boolean; volume:number; motion:MotionPreference; showSource:boolean; showChapter:boolean; showDifficulty:boolean }
export interface UserProfile { id:string; displayName:string; createdAt:string; timeZone:string }
export interface XPState { version:2; identityVersion?:1; preservedCredit?:number; openingFloors?:Record<string,number>; protectedOrigins?:string[]; aliasSnapshot?:Record<string,string>; legacyXP:number; legacyQuestionIds:string[]; legacyBonusSessionIds:string[]; rewards:Record<string,number> }
export interface AppData {
  selectedSubjects?:string[];
  subjectSelectionRevision?:string; version:1; statisticsResetAt?:string; reviewEvents?:ReviewEvent[]; activeBankIds?:string[]; collectionDefaultsVersion?:number; collectionAliases?:Record<string,string>; preferences:Preferences; sessions:Session[]; currentSessionId?:string; xp:number; rewardedQuestions:string[]; xpState?:XPState; profile?:UserProfile; practiceSetups?:Record<string,PracticeSelection> }

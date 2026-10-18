import type { SchoolLevel } from '../types'

export interface SubjectCatalogEntry {
  catalogKey: string
  name: string
  shortName: string
  color: string
  applicableSchoolLevels: readonly SchoolLevel[]
  aliases: readonly string[]
  zhuyinAliases: readonly string[]
}

const BOTH_LEVELS = ['junior-high', 'senior-high'] as const satisfies readonly SchoolLevel[]
const JUNIOR_HIGH = ['junior-high'] as const satisfies readonly SchoolLevel[]
const SENIOR_HIGH = ['senior-high'] as const satisfies readonly SchoolLevel[]

// 課綱以領域統整部分國中課程；Toki 依教師實際排課常用的科目粒度顯示。
// 例如自然科學領域分為生物、理化、地球科學，藝術領域分為音樂、視覺藝術、表演藝術。
export const DEFAULT_SUBJECT_CATALOG = [
  { catalogKey: 'core.chinese-language', name: '國語文', shortName: '國', color: '#A66D52', applicableSchoolLevels: BOTH_LEVELS, aliases: ['國文', '中文'], zhuyinAliases: ['ㄍㄨㄛˊㄩˇㄨㄣˊ', 'ㄍㄨㄛˊㄨㄣˊ'] },
  { catalogKey: 'core.english-language', name: '英語文', shortName: '英', color: '#7B8794', applicableSchoolLevels: BOTH_LEVELS, aliases: ['英文', '英語'], zhuyinAliases: ['ㄧㄥㄩˇㄨㄣˊ', 'ㄧㄥㄨㄣˊ'] },
  { catalogKey: 'core.mathematics', name: '數學', shortName: '數', color: '#647C88', applicableSchoolLevels: BOTH_LEVELS, aliases: ['數學科'], zhuyinAliases: ['ㄕㄨˋㄒㄩㄝˊ'] },
  { catalogKey: 'core.second-foreign-language', name: '第二外國語文', shortName: '二外', color: '#8A7390', applicableSchoolLevels: BOTH_LEVELS, aliases: ['第二外語', '二外'], zhuyinAliases: ['ㄉㄧˋㄦˋㄨㄞˋㄍㄨㄛˊㄩˇㄨㄣˊ', 'ㄦˋㄨㄞˋ'] },
  { catalogKey: 'core.biology', name: '生物', shortName: '生', color: '#718B6C', applicableSchoolLevels: BOTH_LEVELS, aliases: ['生物科'], zhuyinAliases: ['ㄕㄥㄨˋ'] },
  { catalogKey: 'core.physical-science', name: '理化', shortName: '理', color: '#6F8790', applicableSchoolLevels: JUNIOR_HIGH, aliases: ['理化科'], zhuyinAliases: ['ㄌㄧˇㄏㄨㄚˋ', 'ㄌㄧˇ'] },
  { catalogKey: 'core.physics', name: '物理', shortName: '物', color: '#667F98', applicableSchoolLevels: SENIOR_HIGH, aliases: ['物理科'], zhuyinAliases: ['ㄨˋㄌㄧˇ'] },
  { catalogKey: 'core.chemistry', name: '化學', shortName: '化', color: '#7B7896', applicableSchoolLevels: SENIOR_HIGH, aliases: ['化學科'], zhuyinAliases: ['ㄏㄨㄚˋㄒㄩㄝˊ'] },
  { catalogKey: 'core.earth-science', name: '地球科學', shortName: '地科', color: '#70877C', applicableSchoolLevels: BOTH_LEVELS, aliases: ['地科'], zhuyinAliases: ['ㄉㄧˋㄑㄧㄡˊㄎㄜㄒㄩㄝˊ', 'ㄉㄧˋㄎㄜ'] },
  { catalogKey: 'core.science-inquiry', name: '自然科學探究與實作', shortName: '探究', color: '#657F73', applicableSchoolLevels: SENIOR_HIGH, aliases: ['探究與實作', '自然探究'], zhuyinAliases: ['ㄊㄢˋㄐㄧㄡˋㄩˇㄕˊㄗㄨㄛˋ', 'ㄊㄢˋㄐㄧㄡˋ'] },
  { catalogKey: 'core.history', name: '歷史', shortName: '歷', color: '#8C765F', applicableSchoolLevels: BOTH_LEVELS, aliases: ['歷史科'], zhuyinAliases: ['ㄌㄧˋㄕˇ'] },
  { catalogKey: 'core.geography', name: '地理', shortName: '地', color: '#75856A', applicableSchoolLevels: BOTH_LEVELS, aliases: ['地理科'], zhuyinAliases: ['ㄉㄧˋㄌㄧˇ'] },
  { catalogKey: 'core.civics', name: '公民與社會', shortName: '公', color: '#6C8299', applicableSchoolLevels: BOTH_LEVELS, aliases: ['公民', '公民科'], zhuyinAliases: ['ㄍㄨㄥㄇㄧㄣˊㄩˇㄕㄜˋㄏㄨㄟˋ', 'ㄍㄨㄥㄇㄧㄣˊ'] },
  { catalogKey: 'core.health-education', name: '健康教育', shortName: '健教', color: '#8A8064', applicableSchoolLevels: JUNIOR_HIGH, aliases: ['健康'], zhuyinAliases: ['ㄐㄧㄢˋㄎㄤㄐㄧㄠˋㄩˋ', 'ㄐㄧㄢˋㄎㄤ'] },
  { catalogKey: 'core.health-and-nursing', name: '健康與護理', shortName: '健護', color: '#8B7B68', applicableSchoolLevels: SENIOR_HIGH, aliases: ['健康護理', '健護'], zhuyinAliases: ['ㄐㄧㄢˋㄎㄤㄩˇㄏㄨˋㄌㄧˇ', 'ㄐㄧㄢˋㄏㄨˋ'] },
  { catalogKey: 'core.physical-education', name: '體育', shortName: '體', color: '#8A6F62', applicableSchoolLevels: BOTH_LEVELS, aliases: ['體育科'], zhuyinAliases: ['ㄊㄧˇㄩˋ'] },
  { catalogKey: 'core.music', name: '音樂', shortName: '音', color: '#92758A', applicableSchoolLevels: BOTH_LEVELS, aliases: ['音樂科'], zhuyinAliases: ['ㄧㄣㄩㄝˋ'] },
  { catalogKey: 'core.visual-arts', name: '視覺藝術', shortName: '視', color: '#9A796F', applicableSchoolLevels: JUNIOR_HIGH, aliases: ['視藝'], zhuyinAliases: ['ㄕˋㄐㄩㄝˊㄧˋㄕㄨˋ', 'ㄕˋㄧˋ'] },
  { catalogKey: 'core.performing-arts', name: '表演藝術', shortName: '表', color: '#8E7484', applicableSchoolLevels: JUNIOR_HIGH, aliases: ['表藝'], zhuyinAliases: ['ㄅㄧㄠˇㄧㄢˇㄧˋㄕㄨˋ', 'ㄅㄧㄠˇㄧˋ'] },
  { catalogKey: 'core.fine-arts', name: '美術', shortName: '美', color: '#9B776C', applicableSchoolLevels: SENIOR_HIGH, aliases: ['美術科'], zhuyinAliases: ['ㄇㄟˇㄕㄨˋ'] },
  { catalogKey: 'core.arts-life', name: '藝術生活', shortName: '藝生', color: '#8B758F', applicableSchoolLevels: SENIOR_HIGH, aliases: ['藝生'], zhuyinAliases: ['ㄧˋㄕㄨˋㄕㄥㄏㄨㄛˊ', 'ㄧˋㄕㄥ'] },
  { catalogKey: 'core.information-technology', name: '資訊科技', shortName: '資', color: '#667F87', applicableSchoolLevels: BOTH_LEVELS, aliases: ['資訊', '資訊科'], zhuyinAliases: ['ㄗㄒㄩㄣˋㄎㄜㄐㄧˋ', 'ㄗㄒㄩㄣˋ'] },
  { catalogKey: 'core.living-technology', name: '生活科技', shortName: '生科', color: '#7D8066', applicableSchoolLevels: BOTH_LEVELS, aliases: ['生活科技科'], zhuyinAliases: ['ㄕㄥㄏㄨㄛˊㄎㄜㄐㄧˋ', 'ㄕㄥㄎㄜ'] },
  // 普通高中綜合活動領域包含生命教育、生涯規劃及家政；家政亦為國中正式科目。
  { catalogKey: 'core.home-economics', name: '家政', shortName: '家', color: '#9A806B', applicableSchoolLevels: BOTH_LEVELS, aliases: ['家政科'], zhuyinAliases: ['ㄐㄧㄚㄓㄥˋ'] },
  { catalogKey: 'core.scouting', name: '童軍', shortName: '童', color: '#718169', applicableSchoolLevels: JUNIOR_HIGH, aliases: ['童軍教育'], zhuyinAliases: ['ㄊㄨㄥˊㄐㄩㄣ'] },
  { catalogKey: 'core.guidance', name: '輔導', shortName: '輔', color: '#887A91', applicableSchoolLevels: JUNIOR_HIGH, aliases: ['輔導活動'], zhuyinAliases: ['ㄈㄨˇㄉㄠˇ'] },
  { catalogKey: 'core.life-education', name: '生命教育', shortName: '命', color: '#8A7C6B', applicableSchoolLevels: SENIOR_HIGH, aliases: ['生命'], zhuyinAliases: ['ㄕㄥㄇㄧㄥˋㄐㄧㄠˋㄩˋ', 'ㄕㄥㄇㄧㄥˋ'] },
  { catalogKey: 'core.career-planning', name: '生涯規劃', shortName: '涯', color: '#748393', applicableSchoolLevels: SENIOR_HIGH, aliases: ['生涯'], zhuyinAliases: ['ㄕㄥㄧㄚˊㄍㄨㄟㄏㄨㄚˋ', 'ㄕㄥㄧㄚˊ'] },
  { catalogKey: 'core.national-defense', name: '全民國防教育', shortName: '國防', color: '#737765', applicableSchoolLevels: SENIOR_HIGH, aliases: ['全民國防', '國防教育'], zhuyinAliases: ['ㄑㄩㄢˊㄇㄧㄣˊㄍㄨㄛˊㄈㄤˊㄐㄧㄠˋㄩˋ', 'ㄍㄨㄛˊㄈㄤˊ'] },
] as const satisfies readonly SubjectCatalogEntry[]

export const OPTIONAL_SUBJECT_CATALOG = [
  { catalogKey: 'optional.class-meeting', name: '班會', shortName: '班', color: '#8A8174', applicableSchoolLevels: BOTH_LEVELS, aliases: ['班級活動'], zhuyinAliases: ['ㄅㄢㄏㄨㄟˋ'] },
  { catalogKey: 'optional.club', name: '社團', shortName: '社', color: '#7B8874', applicableSchoolLevels: BOTH_LEVELS, aliases: ['社團活動'], zhuyinAliases: ['ㄕㄜˋㄊㄨㄢˊ'] },
  { catalogKey: 'optional.self-study', name: '自習', shortName: '自', color: '#7E8185', applicableSchoolLevels: BOTH_LEVELS, aliases: ['自修'], zhuyinAliases: ['ㄗˋㄒㄧˊ', 'ㄗˋㄒㄧㄡ'] },
  { catalogKey: 'optional.flexible-learning', name: '彈性學習', shortName: '彈', color: '#82788A', applicableSchoolLevels: BOTH_LEVELS, aliases: ['彈性課程'], zhuyinAliases: ['ㄊㄢˊㄒㄧㄥˋㄒㄩㄝˊㄒㄧˊ', 'ㄊㄢˊㄒㄧㄥˋ'] },
  { catalogKey: 'optional.school-developed', name: '校訂課程', shortName: '校', color: '#887766', applicableSchoolLevels: BOTH_LEVELS, aliases: ['校本課程'], zhuyinAliases: ['ㄒㄧㄠˋㄉㄧㄥˋㄎㄜˋㄔㄥˊ', 'ㄒㄧㄠˋㄅㄣˇㄎㄜˋㄔㄥˊ'] },
] as const satisfies readonly SubjectCatalogEntry[]


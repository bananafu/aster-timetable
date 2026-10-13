import type { ProjectClass, SchoolLevel } from '../types'

export const gradesForLevel = (level: SchoolLevel): number[] => level === 'junior-high'
  ? [7, 8, 9]
  : level === 'senior-high'
    ? [1, 2, 3]
    : []

export function isGradeValidForLevel(level: SchoolLevel, grade: number) {
  return gradesForLevel(level).includes(grade)
}

export function formatClassCode(grade: number, classNumber: number) {
  return `${grade}${String(classNumber).padStart(2, '0')}`
}

export function gradeLabel(level: SchoolLevel, grade: number) {
  const chinese = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][grade] ?? String(grade)
  return level === 'senior-high' ? `高中${chinese}年級` : `${chinese}年級`
}

export function classDisplayName(schoolClass: Pick<ProjectClass, 'name' | 'grade' | 'classNumber'>) {
  return schoolClass.grade !== undefined && schoolClass.classNumber !== undefined
    ? formatClassCode(schoolClass.grade, schoolClass.classNumber)
    : schoolClass.name
}

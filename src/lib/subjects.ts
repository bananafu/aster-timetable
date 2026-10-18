import { SCHOOL_LEVELS, type SchoolLevel, type Subject } from '../types'

export function subjectAppliesToLevel(subject: Subject, level: SchoolLevel): boolean {
  return (subject.applicableSchoolLevels ?? SCHOOL_LEVELS).includes(level)
}

export function subjectChoiceAllowed(
  subject: Subject | undefined,
  level: SchoolLevel,
  teachingUnitId: string,
  previous?: { subjectId: string; teachingUnitId: string },
): boolean {
  return Boolean(subject && (subjectAppliesToLevel(subject, level)
    || (previous?.subjectId === subject.id && previous.teachingUnitId === teachingUnitId)))
}

export function subjectsForLevel(subjects: readonly Subject[], level?: SchoolLevel): Subject[] {
  return level ? subjects.filter((subject) => subjectAppliesToLevel(subject, level)) : []
}

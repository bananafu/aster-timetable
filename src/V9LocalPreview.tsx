import { useMemo, useState } from 'react'
import { FormalV9Workspace } from './FormalV9Composition'
import { createV9LocalPreviewFixture, V9_LOCAL_PREVIEW_WEEK } from './data/v9LocalPreviewFixture'
import { reconcileFormalProjectTimetableV9Selection,
  type FormalProjectTimetableV9Selection } from './formalProjectTimetableV9'
import { fromDateKey } from './lib/date'

export function V9LocalPreview() {
  const data = useMemo(() => createV9LocalPreviewFixture(), [])
  const [selection, setSelection] = useState<FormalProjectTimetableV9Selection>(() =>
    reconcileFormalProjectTimetableV9Selection(data))
  return <FormalV9Workspace data={data} selection={selection} source={{ kind: 'preview' }}
    initialWeekStart={fromDateKey(V9_LOCAL_PREVIEW_WEEK)}
    onProjectChange={(projectId) => setSelection(reconcileFormalProjectTimetableV9Selection(data, { projectId }))}
    onTimetableChange={(timetableId) => setSelection((current) =>
      reconcileFormalProjectTimetableV9Selection(data, { ...current, timetableId }))} />
}

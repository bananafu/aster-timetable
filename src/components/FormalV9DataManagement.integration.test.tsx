// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProjectV9 } from '../data/managementV9'
import { createEmptyAppDataV9 } from '../data/storageV9'
import { parseV9JsonImportCandidate, summarizeAppDataV9,
  type PreparedV9JsonImport } from '../formalV9JsonTransfer'
import { FormalV9DataManagement } from './FormalV9DataManagement'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function prepared(fileName = 'import.json'): Promise<PreparedV9JsonImport> {
  const current = createEmptyProjectV9(createEmptyAppDataV9(), { name: '目前' }, 'current')
  const candidateDocument = createEmptyProjectV9(createEmptyProjectV9(createEmptyAppDataV9(),
    { name: '匯入甲' }, 'import-a'), { name: '匯入乙' }, 'import-b')
  const candidate = await parseV9JsonImportCandidate(fileName, JSON.stringify(candidateDocument))
  return { candidate, current: summarizeAppDataV9(current), baseline: {
    raw: JSON.stringify(current), revision: 2, digest: `sha256:${'0'.repeat(64)}`,
  } }
}

const selectFile = (input: HTMLInputElement, fileName = 'import.json') => {
  const file = new File(['{}'], fileName, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: vi.fn(async () => '{}') })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('Formal V9 data management settings content', () => {
  it('shows validation preview and requires the exact unchecked confirmation before import', async () => {
    const preview = await prepared()
    const transfer = { exportVerified: vi.fn(), prepareImport: vi.fn(async () => preview),
      confirmImport: vi.fn(async () => ({})) }
    const onImported = vi.fn()
    render(<FormalV9DataManagement transfer={transfer} disabled={false} onImported={onImported} />)
    const input = screen.getByLabelText('選擇 JSON 檔案') as HTMLInputElement
    selectFile(input)
    await screen.findByText('JSON schema version：9')
    expect(screen.getByText(/匯入會整份替換目前資料，不是合併或附加。/)).toBeTruthy()
    expect(screen.getByText('import.json')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('row', { name: 'Project 1 2' })).toBeTruthy()
    const checkbox = screen.getByRole('checkbox', { name: '我了解目前資料將被替換' })
    const confirm = screen.getByRole('button', { name: '確認匯入' })
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(transfer.confirmImport).not.toHaveBeenCalled()
    fireEvent.click(checkbox)
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(transfer.confirmImport).toHaveBeenCalledWith(preview,
      preview.candidate.identity, true))
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('resets confirmation on file change and Cancel performs no Host mutation', async () => {
    const first = await prepared('first.json')
    const second = await prepared('second.json')
    const transfer = { exportVerified: vi.fn(),
      prepareImport: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      confirmImport: vi.fn() }
    render(<FormalV9DataManagement transfer={transfer} disabled={false} onImported={vi.fn()} />)
    const input = screen.getByLabelText('選擇 JSON 檔案') as HTMLInputElement
    selectFile(input, 'first.json')
    await screen.findByText('first.json')
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解目前資料將被替換' }))
    selectFile(input, 'second.json')
    await screen.findByText('second.json')
    expect((screen.getByRole('checkbox', { name: '我了解目前資料將被替換' }) as HTMLInputElement).checked)
      .toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText('second.json')).toBeNull()
    expect(transfer.confirmImport).not.toHaveBeenCalled()
  })

  it('keeps preview and reports the error when confirmed import fails', async () => {
    const preview = await prepared()
    const transfer = { exportVerified: vi.fn(), prepareImport: vi.fn(async () => preview),
      confirmImport: vi.fn(async () => { throw new Error('stale-preview') }) }
    render(<FormalV9DataManagement transfer={transfer} disabled={false} onImported={vi.fn()} />)
    selectFile(screen.getByLabelText('選擇 JSON 檔案') as HTMLInputElement)
    await screen.findByText('import.json')
    fireEvent.click(screen.getByRole('checkbox', { name: '我了解目前資料將被替換' }))
    fireEvent.click(screen.getByRole('button', { name: '確認匯入' }))
    expect((await screen.findByRole('alert')).textContent).toContain('stale-preview')
    expect(screen.getByText('import.json')).toBeTruthy()
  })

  it('requests verified export and does not reserialize the returned raw', async () => {
    const raw = '{\n  "schemaVersion": 9\n}'
    const createObjectURL = vi.fn((blob: Blob) => { void blob; return 'blob:test' })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const transfer = { exportVerified: vi.fn(async () => ({ raw, revision: 3,
      digest: `sha256:${'0'.repeat(64)}` as const })), prepareImport: vi.fn(), confirmImport: vi.fn() }
    render(<FormalV9DataManagement transfer={transfer} disabled={false} onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '匯出 JSON' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce())
    expect(await (createObjectURL.mock.calls[0][0] as Blob).text()).toBe(raw)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })
})

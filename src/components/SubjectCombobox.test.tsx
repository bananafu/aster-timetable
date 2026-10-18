// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchoolLevel, Subject } from '../types'
import { SubjectCombobox } from './SubjectCombobox'

afterEach(cleanup)

const subjects: Subject[] = [
  { id: 'chemistry-id', name: '理化', shortName: '理', color: '#6F8790', applicableSchoolLevels: ['junior-high'] },
  { id: 'history-id', name: '歷史', shortName: '歷', color: '#8C765F', applicableSchoolLevels: ['junior-high'] },
  { id: 'physics-id', name: '物理', shortName: '物', color: '#667F98', applicableSchoolLevels: ['senior-high'] },
  { id: 'legacy-id', name: '舊科目', shortName: '舊', color: '#777777' },
]

function Harness({ initial = '', level = 'junior-high', onCreateRequest = vi.fn() }: { initial?: string; level?: SchoolLevel; onCreateRequest?: () => void }) {
  const [value, setValue] = useState(initial)
  return <SubjectCombobox subjects={subjects} schoolLevel={level} value={value} onChange={setValue} onCreateRequest={onCreateRequest} />
}

describe('SubjectCombobox', () => {
  it('starts empty, exposes the combobox/listbox relationship and selects with the keyboard', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: '課程科目' }) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('請選擇科目')
    expect(input.getAttribute('aria-expanded')).toBe('false')

    fireEvent.focus(input)
    const listbox = screen.getByRole('listbox', { name: '可選科目' })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByText('理化').closest('[role=option]')?.id)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByText('舊科目').closest('[role=option]')?.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByText('理化').closest('[role=option]')?.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByText('歷史').closest('[role=option]')?.id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('歷史')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(input)
  })

  it('supports Chinese, explicit zhuyin aliases and mouse selection while preserving Subject ID', () => {
    const onChange = vi.fn()
    render(<SubjectCombobox subjects={subjects} schoolLevel="junior-high" value="" onChange={onChange} onCreateRequest={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: '課程科目' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '理' } })
    expect(screen.getByText('理化')).toBeTruthy()
    expect(screen.queryByText('歷史')).toBeNull()

    fireEvent.change(input, { target: { value: 'ㄌㄧˇ' } })
    const option = screen.getByText('理化').closest('[role=option]')!
    fireEvent.mouseDown(option)
    fireEvent.click(option)
    expect(onChange).toHaveBeenCalledWith('chemistry-id')
    expect(document.activeElement).toBe(input)
  })

  it('does not filter or select on Enter until IME composition ends', () => {
    const onChange = vi.fn()
    render(<SubjectCombobox subjects={subjects} schoolLevel="junior-high" value="" onChange={onChange} onCreateRequest={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: '課程科目' })
    fireEvent.focus(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'ㄌㄧˇ' } })
    expect(screen.getByText('歷史')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-expanded')).toBe('true')

    fireEvent.compositionEnd(input, { data: 'ㄌㄧˇ', target: { value: 'ㄌㄧˇ' } })
    expect(screen.getByText('理化')).toBeTruthy()
    expect(screen.queryByText('歷史')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('chemistry-id')
  })

  it('closes on Escape without changing the value and reopens on the selected option', () => {
    render(<Harness initial="history-id" />)
    const input = screen.getByRole('combobox', { name: '課程科目' }) as HTMLInputElement
    expect(input.value).toBe('歷史')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('歷史')
    expect(input.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(input)
    const selectedOption = screen.getByText('歷史').closest('[role=option]')!
    expect(selectedOption.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(selectedOption.id)
  })

  it('shows no results, keeps the custom-subject action, and filters legacy applicability safely', () => {
    const onCreateRequest = vi.fn()
    render(<Harness onCreateRequest={onCreateRequest} />)
    const input = screen.getByRole('combobox', { name: '課程科目' })
    fireEvent.focus(input)
    expect(screen.getByText('舊科目')).toBeTruthy()
    expect(screen.queryByText('物理')).toBeNull()
    fireEvent.change(input, { target: { value: '不存在' } })
    expect(screen.getByRole('status').textContent).toBe('找不到符合的科目')
    fireEvent.click(screen.getByRole('button', { name: '新增自訂科目' }))
    expect(onCreateRequest).toHaveBeenCalledTimes(1)
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
})

import { ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type CompositionEvent, type KeyboardEvent } from 'react'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG } from '../data/defaultSubjects'
import { searchExistingSubjects } from '../lib/subjectSearch'
import type { SchoolLevel, Subject } from '../types'

const SEARCH_CATALOG = [...DEFAULT_SUBJECT_CATALOG, ...OPTIONAL_SUBJECT_CATALOG]

interface Props {
  subjects: readonly Subject[]
  schoolLevel: SchoolLevel
  value: string
  onChange: (subjectId: string) => void
  onCreateRequest: () => void
  createLabel?: string
  disabled?: boolean
}

export function SubjectCombobox({ subjects, schoolLevel, value, onChange, onCreateRequest, createLabel = '新增自訂科目', disabled = false }: Props) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const selected = subjects.find((subject) => subject.id === value)
  const results = useMemo(
    () => searchExistingSubjects(subjects, schoolLevel, searchQuery, SEARCH_CATALOG),
    [subjects, schoolLevel, searchQuery],
  )
  const listboxId = `${id}-listbox`
  const activeOptionId = open && activeIndex >= 0 && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined

  useEffect(() => {
    if (!open) setInputText(selected?.name ?? '')
  }, [open, selected?.name])

  useEffect(() => {
    if (!open) return
    setActiveIndex((current) => results.length === 0 ? -1 : Math.min(Math.max(current, 0), results.length - 1))
  }, [open, results])

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [])

  const openMenu = () => {
    if (disabled || open) return
    const available = searchExistingSubjects(subjects, schoolLevel, '', SEARCH_CATALOG)
    const selectedIndex = available.findIndex((subject) => subject.id === value)
    setInputText('')
    setSearchQuery('')
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : available.length ? 0 : -1)
    setOpen(true)
  }

  const closeMenu = () => {
    setOpen(false)
    setInputText(selected?.name ?? '')
    setSearchQuery('')
  }

  const choose = (subject: Subject) => {
    onChange(subject.id)
    setOpen(false)
    setInputText(subject.name)
    setSearchQuery('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      if (event.key === 'Enter') event.preventDefault()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { openMenu(); return }
      if (!results.length) return
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => current < 0
        ? (direction > 0 ? 0 : results.length - 1)
        : (current + direction + results.length) % results.length)
      return
    }
    if (event.key === 'Enter') {
      if (!open) { event.preventDefault(); openMenu(); return }
      event.preventDefault()
      if (activeIndex >= 0 && results[activeIndex]) choose(results[activeIndex])
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
    }
  }

  const finishComposition = (event: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false
    setInputText(event.currentTarget.value)
    setSearchQuery(event.currentTarget.value)
  }

  return <div className="subject-combobox-field" ref={rootRef} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu()
  }}>
    <label htmlFor={`${id}-input`}>科目</label>
    <div className={`subject-combobox-control${open ? ' open' : ''}`}>
      {selected && <i aria-hidden="true" style={{ background: selected.color }} />}
      <input
        ref={inputRef}
        id={`${id}-input`}
        role="combobox"
        aria-label="課程科目"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        disabled={disabled}
        placeholder={open ? '搜尋科目' : '請選擇科目'}
        value={inputText}
        onFocus={openMenu}
        onClick={openMenu}
        onChange={(event) => {
          setInputText(event.target.value)
          if (!composingRef.current && !(event.nativeEvent as InputEvent).isComposing) setSearchQuery(event.target.value)
        }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={finishComposition}
        onKeyDown={handleKeyDown}
      />
      <button type="button" aria-label="展開科目選單" aria-expanded={open} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (open) closeMenu(); else { openMenu(); inputRef.current?.focus() }
      }}><ChevronDown size={15} /></button>
    </div>
    {open && <div className="subject-combobox-popup">
      <div id={listboxId} role="listbox" aria-label="可選科目">
        {results.map((subject, index) => <div
          id={`${id}-option-${index}`}
          key={subject.id}
          role="option"
          aria-selected={subject.id === value}
          className={index === activeIndex ? 'active' : ''}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(subject)}
        ><i aria-hidden="true" style={{ background: subject.color }} /><span><strong>{subject.name}</strong><small>{subject.shortName}</small></span></div>)}
        {results.length === 0 && <p className="subject-combobox-empty" role="status">找不到符合的科目</p>}
      </div>
      <button type="button" className="subject-combobox-create" onMouseDown={(event) => event.preventDefault()} onClick={() => { closeMenu(); onCreateRequest() }}><Plus size={14} />{createLabel}</button>
    </div>}
  </div>
}

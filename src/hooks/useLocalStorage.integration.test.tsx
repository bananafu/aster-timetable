// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalStorage } from './useLocalStorage'

interface Value { count: number }
const validate = (value: unknown): value is Value => Boolean(value && typeof value === 'object' && typeof (value as {count?:unknown}).count === 'number')

function Harness() {
  const [value,setValue,status,controls]=useLocalStorage<Value>('hook-test',{count:0},{validate})
  return <div><output data-testid="value">{value.count}</output><output data-testid="status">{status}</output><button onClick={()=>setValue((current)=>({count:current.count+1}))}>local</button><button onClick={controls.acceptExternal}>accept</button><button onClick={controls.keepLocal}>keep</button></div>
}

function externalUpdate(raw: string) {
  localStorage.setItem('hook-test',raw)
  window.dispatchEvent(new StorageEvent('storage',{key:'hook-test',oldValue:null,newValue:raw,storageArea:localStorage}))
}

describe('useLocalStorage multi-tab integration',()=>{
  beforeEach(()=>{ vi.useFakeTimers(); localStorage.clear(); localStorage.setItem('hook-test','{"count":1}') })
  afterEach(()=>{ cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

  it('safely synchronizes an external update when there are no pending changes',()=>{
    render(<Harness />)
    act(()=>externalUpdate('{"count":2}'))
    expect(screen.getByTestId('value').textContent).toBe('2')
    expect(screen.getByTestId('status').textContent).toBe('saved')
  })

  it('enters conflict and does not overwrite external data while local changes are pending',()=>{
    const setItem=vi.spyOn(Storage.prototype,'setItem')
    render(<Harness />)
    fireEvent.click(screen.getByText('local'))
    setItem.mockClear()
    act(()=>externalUpdate('{"count":9}'))
    setItem.mockClear()
    act(()=>vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('value').textContent).toBe('2')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem('hook-test')).toBe('{"count":9}')
  })

  it('adopts the external version and keeps storage consistent',()=>{
    render(<Harness />)
    fireEvent.click(screen.getByText('local'))
    act(()=>externalUpdate('{"count":7}'))
    fireEvent.click(screen.getByText('accept'))
    expect(screen.getByTestId('value').textContent).toBe('7')
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(localStorage.getItem('hook-test')).toBe('{"count":7}')
  })

  it('writes the local version only after explicit keep confirmation',()=>{
    const setItem=vi.spyOn(Storage.prototype,'setItem')
    render(<Harness />)
    fireEvent.click(screen.getByText('local'))
    setItem.mockClear()
    act(()=>externalUpdate('{"count":8}'))
    setItem.mockClear()
    expect(setItem).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('keep'))
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('hook-test')).toBe('{"count":2}')
    expect(screen.getByTestId('status').textContent).toBe('saved')
  })
})

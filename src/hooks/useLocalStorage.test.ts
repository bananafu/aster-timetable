import { describe, expect, it, vi } from 'vitest'
import { getExternalUpdateDecision, loadStoredValue, readStoredValue, writeStoredValue } from './useLocalStorage'

describe('LocalStorage helpers', () => {
  it('writes and reads JSON data', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    writeStoredValue(storage, 'settings', { density: 'compact' })
    expect(readStoredValue(storage, 'settings', { density: 'comfortable' })).toEqual({ density: 'compact' })
  })

  it('surfaces write failures', () => {
    const storage = { setItem: vi.fn(() => { throw new Error('quota exceeded') }) }
    expect(() => writeStoredValue(storage, 'data', {})).toThrow('quota exceeded')
  })

  it('does not overwrite corrupted raw data while loading', () => {
    const storage = {
      getItem: vi.fn(() => '{broken-json'),
      setItem: vi.fn(),
    }
    const result = loadStoredValue(storage, 'data', { safe: true })
    expect(result.status).toBe('read-error')
    expect(result.raw).toBe('{broken-json')
    expect(result.shouldPersist).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('blocks structurally invalid JSON without writing over it', () => {
    const raw = '{"safe":"not-a-boolean"}'
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn() }
    const result = loadStoredValue(storage, 'data', { safe: true }, {
      validate: (value): value is { safe: boolean } => Boolean(value && typeof value === 'object' && typeof (value as { safe?: unknown }).safe === 'boolean'),
    })
    expect(result).toMatchObject({ status: 'read-error', raw, shouldPersist: false })
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('flags an external update as conflict while local changes are pending', () => {
    expect(getExternalUpdateDecision(true, '{"version":1}', '{"version":2}')).toBe('conflict')
    expect(getExternalUpdateDecision(false, '{"version":1}', '{"version":2}')).toBe('sync')
    expect(getExternalUpdateDecision(true, '{"version":2}', '{"version":2}')).toBe('ignore')
  })

  it('migrates only when v3 is absent and leaves the v1 raw value untouched', () => {
    const values = new Map([['v1', '{"version":1}']])
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn() }
    const result = loadStoredValue(storage, 'v3', { version: 3 }, {
      validate: (value): value is {version:number} => Boolean(value && typeof value === 'object' && (value as {version?:unknown}).version === 3),
      legacy: { key:'v1', validate:(value)=>Boolean(value && typeof value==='object' && (value as {version?:unknown}).version===1), migrate:()=>({version:3}) },
    })
    expect(result).toMatchObject({ status:'saved', value:{version:3}, shouldPersist:true })
    expect(values.get('v1')).toBe('{"version":1}')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('migration failure writes neither v1 nor v3 and existing invalid v3 is preserved', () => {
    const values = new Map([['v1','{"version":1}']])
    const storage = { getItem:(key:string)=>values.get(key)??null, setItem:vi.fn() }
    const failed=loadStoredValue(storage,'v3',{version:3},{ legacy:{key:'v1',validate:()=>true,migrate:()=>{throw new Error('failed')}} })
    expect(failed).toMatchObject({status:'read-error',shouldPersist:false,raw:'{"version":1}'})
    values.set('v3','{"broken":true}')
    const fallback=vi.fn(()=>({version:3}))
    const existing=loadStoredValue(storage,'v3',{version:3},{validate:(value):value is {version:number}=>Boolean(value && typeof value==='object' && (value as {version?:unknown}).version===3),legacy:{key:'v1',validate:()=>true,migrate:fallback}})
    expect(existing).toMatchObject({status:'read-error',raw:'{"broken":true}',shouldPersist:false})
    expect(fallback).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('always prefers a valid v3 value over different legacy v1 content', () => {
    const values=new Map([['v3','{"version":3,"owner":"v3"}'],['v1','{"version":1,"owner":"v1"}']])
    const fallback=vi.fn(()=>({version:3,owner:'migrated'}))
    const result=loadStoredValue({getItem:(key)=>values.get(key)??null},'v3',{version:3,owner:'initial'},{validate:(value):value is {version:number;owner:string}=>Boolean(value&&typeof value==='object'&&(value as {version?:unknown}).version===3),legacy:{key:'v1',validate:()=>true,migrate:fallback}})
    expect(result.value).toEqual({version:3,owner:'v3'})
    expect(fallback).not.toHaveBeenCalled()
  })
})

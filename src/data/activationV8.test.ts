import { describe, expect, it, vi } from 'vitest'
import { APP_DATA_V7_KEY } from './storageV7'
import {
  APP_DATA_V8_ACTIVATION_KEY,
  isV8ActivationMetadata,
  loadV8ActivationMetadata,
  type V8ActivationMetadata,
} from './activationV8'

const metadata = (): V8ActivationMetadata => ({
  metadataVersion: 1,
  sourceV7Fingerprint: `sha256:${'a'.repeat(64)}`,
  sourceV7Key: APP_DATA_V7_KEY,
  v8ActivationRevision: 1,
  activatedAt: '2026-10-22T01:02:03.000Z',
  status: 'active',
})

describe('V8 activation metadata contract', () => {
  it('accepts complete immutable cutover evidence', () => {
    expect(isV8ActivationMetadata(metadata())).toBe(true)
    expect(isV8ActivationMetadata({ ...metadata(), sourceV7Key: 'other-key' })).toBe(false)
    expect(isV8ActivationMetadata({ ...metadata(), sourceV7Fingerprint: 'sha256:short' })).toBe(false)
    expect(isV8ActivationMetadata({ ...metadata(), v8ActivationRevision: 0 })).toBe(false)
    expect(isV8ActivationMetadata({ ...metadata(), activatedAt: '2026-10-22' })).toBe(false)
  })

  it('only reads metadata and preserves the recorded V7 fingerprint', () => {
    const raw = JSON.stringify(metadata())
    const getItem = vi.fn((key: string) => key === APP_DATA_V8_ACTIVATION_KEY ? raw : null)
    const first = loadV8ActivationMetadata({ getItem })
    const second = loadV8ActivationMetadata({ getItem })

    expect(first).toEqual({ value: metadata(), raw, issue: 'none' })
    expect(second.value?.sourceV7Fingerprint).toBe(first.value?.sourceV7Fingerprint)
    expect(getItem).toHaveBeenCalledTimes(2)
  })

  it('reports corrupt and unreadable metadata without repairing it', () => {
    expect(loadV8ActivationMetadata({ getItem: () => '{broken' })).toMatchObject({ issue: 'corrupt', raw: '{broken' })
    expect(loadV8ActivationMetadata({ getItem: () => { throw new Error('denied') } })).toEqual({
      value: null, raw: null, issue: 'read-failure',
    })
  })
})

import { describe, it, expect } from 'vitest'
import { parseMetadata, metadataToR2, validateTusVersion, tusError, optionsResponse, TUS_VERSION, SUPPORTED_EXTENSIONS } from '../src/protocol.js'

describe('parseMetadata', () => {
  it('returns empty object for null', () => {
    expect(parseMetadata(null)).toEqual({})
  })

  it('decodes base64 values', () => {
    const header = `filename ${btoa('video.mp4')}, type ${btoa('video/mp4')}`
    expect(parseMetadata(header)).toEqual({ filename: 'video.mp4', type: 'video/mp4' })
  })

  it('handles key with no value', () => {
    expect(parseMetadata('novalue')).toEqual({ novalue: '' })
  })

  it('handles multiple entries', () => {
    const header = `a ${btoa('hello')}, b ${btoa('world')}`
    expect(parseMetadata(header)).toEqual({ a: 'hello', b: 'world' })
  })
})

describe('metadataToR2', () => {
  it('maps type to contentType', () => {
    const { httpMetadata } = metadataToR2({ type: 'image/png' })
    expect(httpMetadata.contentType).toBe('image/png')
  })

  it('maps filename to contentDisposition', () => {
    const { httpMetadata } = metadataToR2({ filename: 'photo.jpg' })
    expect(httpMetadata.contentDisposition).toBe('attachment; filename="photo.jpg"')
  })

  it('maps other keys to customMetadata', () => {
    const { customMetadata } = metadataToR2({ userId: '123' })
    expect(customMetadata.userId).toBe('123')
  })
})

describe('validateTusVersion', () => {
  it('returns null for correct version', () => {
    const req = new Request('http://x/', { headers: { 'Tus-Resumable': TUS_VERSION } })
    expect(validateTusVersion(req)).toBeNull()
  })

  it('returns 412 for missing header', () => {
    const req = new Request('http://x/')
    const res = validateTusVersion(req)
    expect(res.status).toBe(412)
  })

  it('returns 412 for wrong version', () => {
    const req = new Request('http://x/', { headers: { 'Tus-Resumable': '2.0.0' } })
    const res = validateTusVersion(req)
    expect(res.status).toBe(412)
  })
})

describe('optionsResponse', () => {
  it('returns 204 with required headers', () => {
    const res = optionsResponse()
    expect(res.status).toBe(204)
    expect(res.headers.get('Tus-Resumable')).toBe(TUS_VERSION)
    expect(res.headers.get('Tus-Version')).toBe(TUS_VERSION)
    expect(res.headers.get('Tus-Extension')).toBe(SUPPORTED_EXTENSIONS)
  })

  it('includes Tus-Max-Size when provided', () => {
    const res = optionsResponse(1024)
    expect(res.headers.get('Tus-Max-Size')).toBe('1024')
  })
})

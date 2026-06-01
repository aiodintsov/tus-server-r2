import { describe, it, expect, vi } from 'vitest'
import { createTusHandler } from '../src/index.js'
import { createMockBucket } from './mock-bucket.js'

const TUS_VERSION = '1.0.0'
const BASE = 'http://upload.example.com'

function makeCtx() {
  return { waitUntil: vi.fn((p) => p) }
}

function makeHandler(opts = {}) {
  const bucket = opts.bucket ?? createMockBucket()
  const tus = createTusHandler({ bucket, ...opts })
  return { tus, bucket }
}

function req(method, path, headers = {}, body = null) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'Tus-Resumable': TUS_VERSION, ...headers },
    body,
    duplex: 'half',
  })
}

// --- OPTIONS ---
describe('OPTIONS', () => {
  it('returns 204 with capabilities', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(req('OPTIONS', '/'), {}, makeCtx())
    expect(res.status).toBe(204)
    expect(res.headers.get('Tus-Extension')).toContain('creation')
    expect(res.headers.get('Tus-Extension')).toContain('termination')
  })

  it('includes Tus-Max-Size when configured', async () => {
    const { tus } = makeHandler({ maxSize: 5000 })
    const res = await tus.fetch(req('OPTIONS', '/'), {}, makeCtx())
    expect(res.headers.get('Tus-Max-Size')).toBe('5000')
  })
})

// --- CORS ---
describe('CORS', () => {
  it('returns * by default', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(req('OPTIONS', '/'), {}, makeCtx())
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('reflects matching origin from corsAllowOrigin list', async () => {
    const { tus } = makeHandler({ corsAllowOrigin: 'https://app.example.com,https://admin.example.com' })
    const r = new Request(`${BASE}/`, {
      method: 'OPTIONS',
      headers: { 'Tus-Resumable': TUS_VERSION, Origin: 'https://app.example.com' },
    })
    const res = await tus.fetch(r, {}, makeCtx())
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('returns first origin when request origin not in list', async () => {
    const { tus } = makeHandler({ corsAllowOrigin: 'https://app.example.com' })
    const r = new Request(`${BASE}/`, {
      method: 'OPTIONS',
      headers: { 'Tus-Resumable': TUS_VERSION, Origin: 'https://evil.com' },
    })
    const res = await tus.fetch(r, {}, makeCtx())
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('uses env.CORS_ALLOW_ORIGIN as fallback', async () => {
    const bucket = createMockBucket()
    const tus = createTusHandler()
    const r = new Request(`${BASE}/`, {
      method: 'OPTIONS',
      headers: { 'Tus-Resumable': TUS_VERSION, Origin: 'https://myapp.com' },
    })
    const res = await tus.fetch(r, { BUCKET: bucket, CORS_ALLOW_ORIGIN: 'https://myapp.com' }, makeCtx())
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://myapp.com')
  })

  it('includes CORS headers on all responses', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(req('POST', '/', { 'Upload-Length': '100' }), {}, makeCtx())
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Upload-Offset')
  })
})

// --- POST (create) ---
describe('POST', () => {
  it('returns 412 without Tus-Resumable', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(
      new Request(`${BASE}/`, { method: 'POST', headers: { 'Upload-Length': '100' } }),
      {}, makeCtx()
    )
    expect(res.status).toBe(412)
  })

  it('returns 400 when Upload-Length missing', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(req('POST', '/'), {}, makeCtx())
    expect(res.status).toBe(400)
  })

  it('creates upload and returns 201 with Location', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Length': '1000' }),
      {}, makeCtx()
    )
    expect(res.status).toBe(201)
    const location = res.headers.get('Location')
    expect(location).toBeTruthy()
    expect(location).toMatch(/^\/[0-9a-f-]{36}$/)
  })

  it('returns 413 when upload exceeds maxSize', async () => {
    const { tus } = makeHandler({ maxSize: 100 })
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Length': '1000' }),
      {}, makeCtx()
    )
    expect(res.status).toBe(413)
  })

  it('supports Upload-Defer-Length', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Defer-Length': '1' }),
      {}, makeCtx()
    )
    expect(res.status).toBe(201)
  })

  it('supports creation-with-upload', async () => {
    const { tus } = makeHandler()
    const body = 'hello world'
    const res = await tus.fetch(
      req('POST', '/', {
        'Upload-Length': String(body.length),
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(body.length),
      }, body),
      {}, makeCtx()
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('Upload-Offset')).toBe(String(body.length))
  })
})

// --- HEAD ---
describe('HEAD', () => {
  async function createUpload(tus, ctx, length = 1000) {
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Length': String(length) }),
      {}, ctx
    )
    const location = res.headers.get('Location')
    return location
  }

  it('returns 404 for unknown upload', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(req('HEAD', '/unknown-uuid'), {}, makeCtx())
    expect(res.status).toBe(404)
  })

  it('returns offset and length for existing upload', async () => {
    const { tus } = makeHandler()
    const ctx = makeCtx()
    const location = await createUpload(tus, ctx)
    const res = await tus.fetch(req('HEAD', location), {}, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('Upload-Offset')).toBe('0')
    expect(res.headers.get('Upload-Length')).toBe('1000')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

// --- PATCH ---
describe('PATCH', () => {
  async function createUpload(tus, ctx, length) {
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Length': String(length) }),
      {}, ctx
    )
    return res.headers.get('Location')
  }

  it('returns 415 for wrong Content-Type', async () => {
    const { tus } = makeHandler()
    const ctx = makeCtx()
    const location = await createUpload(tus, ctx, 100)
    const res = await tus.fetch(
      req('PATCH', location, { 'Upload-Offset': '0', 'Content-Type': 'application/json', 'Content-Length': '5' }, 'hello'),
      {}, ctx
    )
    expect(res.status).toBe(415)
  })

  it('returns 409 for offset mismatch', async () => {
    const { tus } = makeHandler()
    const ctx = makeCtx()
    const location = await createUpload(tus, ctx, 100)
    const res = await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': '50',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': '5',
      }, 'hello'),
      {}, ctx
    )
    expect(res.status).toBe(409)
  })

  it('uploads chunk and returns 204 with new offset', async () => {
    const { tus } = makeHandler()
    const ctx = makeCtx()
    const body = 'hello world'
    const location = await createUpload(tus, ctx, body.length)
    const res = await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(body.length),
      }, body),
      {}, ctx
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Upload-Offset')).toBe(String(body.length))
  })

  it('completes upload when final chunk received', async () => {
    const { tus, bucket } = makeHandler()
    const ctx = makeCtx()
    const body = 'hello world'
    const location = await createUpload(tus, ctx, body.length)
    const uuid = location.replace('/', '')

    await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(body.length),
      }, body),
      {}, ctx
    )

    // Final object should exist in uploads/
    const finalObj = await bucket.get(`uploads/${uuid}`)
    expect(finalObj).not.toBeNull()

    // State should be deleted
    const stateObj = await bucket.get(`__tus/${uuid}`)
    expect(stateObj).toBeNull()
  })

  it('fires onComplete when upload finishes', async () => {
    const onComplete = vi.fn()
    const { tus } = makeHandler({ onComplete })
    const ctx = makeCtx()
    const body = 'done'
    const location = await createUpload(tus, ctx, body.length)

    await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(body.length),
      }, body),
      {}, ctx
    )

    await ctx.waitUntil.mock.results[0]?.value
    expect(onComplete).toHaveBeenCalledWith(
      expect.stringContaining('uploads/'),
      expect.any(Object),
      expect.any(Object)
    )
  })

  it('uploads in multiple chunks', async () => {
    const { tus, bucket } = makeHandler()
    const ctx = makeCtx()
    const part1 = 'hello '
    const part2 = 'world'
    const total = part1.length + part2.length
    const location = await createUpload(tus, ctx, total)
    const uuid = location.replace('/', '')

    await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(part1.length),
      }, part1),
      {}, ctx
    )

    const res2 = await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': String(part1.length),
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(part2.length),
      }, part2),
      {}, ctx
    )

    expect(res2.status).toBe(204)
    expect(res2.headers.get('Upload-Offset')).toBe(String(total))

    const finalObj = await bucket.get(`uploads/${uuid}`)
    expect(finalObj).not.toBeNull()
    const text = await finalObj.text()
    expect(text).toBe('hello world')
  })
})

// --- DELETE ---
describe('DELETE', () => {
  it('returns 404 for unknown upload', async () => {
    const { tus } = makeHandler()
    const res = await tus.fetch(req('DELETE', '/no-such-id'), {}, makeCtx())
    expect(res.status).toBe(404)
  })

  it('terminates upload and returns 204', async () => {
    const { tus, bucket } = makeHandler()
    const ctx = makeCtx()
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Length': '1000' }),
      {}, ctx
    )
    const location = res.headers.get('Location')
    const uuid = location.replace('/', '')

    const del = await tus.fetch(req('DELETE', location), {}, ctx)
    expect(del.status).toBe(204)

    const stateObj = await bucket.get(`__tus/${uuid}`)
    expect(stateObj).toBeNull()
  })
})

// --- env fallbacks ---
describe('env fallbacks', () => {
  it('uses env.BUCKET when no bucket in options', async () => {
    const bucket = createMockBucket()
    const tus = createTusHandler()
    const res = await tus.fetch(
      req('POST', '/', { 'Upload-Length': '100' }),
      { BUCKET: bucket },
      makeCtx()
    )
    expect(res.status).toBe(201)
  })

  it('uses env.WEBHOOK_URL when no webhookUrl in options', async () => {
    const bucket = createMockBucket()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok'))
    const tus = createTusHandler()
    const ctx = makeCtx()

    const body = 'hi'
    const postRes = await tus.fetch(
      req('POST', '/', { 'Upload-Length': String(body.length) }),
      { BUCKET: bucket, WEBHOOK_URL: 'https://hook.example.com/webhook' },
      ctx
    )
    const location = postRes.headers.get('Location')

    await tus.fetch(
      req('PATCH', location, {
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(body.length),
      }, body),
      { BUCKET: bucket, WEBHOOK_URL: 'https://hook.example.com/webhook' },
      ctx
    )

    await ctx.waitUntil.mock.results[0]?.value
    expect(fetchSpy).toHaveBeenCalledWith('https://hook.example.com/webhook', expect.objectContaining({ method: 'POST' }))
    fetchSpy.mockRestore()
  })
})

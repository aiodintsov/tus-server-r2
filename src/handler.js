import { validateTusVersion, parseMetadata, tusHeaders, tusError, optionsResponse } from './protocol.js'
import { readState, writeState, deleteState } from './state.js'
import { createUpload, uploadPart, completeUpload, abortUpload } from './storage.js'

const DEFAULT_STATE_PREFIX = '__tus'
const DEFAULT_UPLOADS_PREFIX = 'uploads'
const DEFAULT_UPLOAD_TTL = 86400000 // 24h

export function createHandler(config) {
  const {
    bucket,
    statePrefix = DEFAULT_STATE_PREFIX,
    uploadsPrefix = DEFAULT_UPLOADS_PREFIX,
    maxSize,
    uploadTTL = DEFAULT_UPLOAD_TTL,
    webhookUrl,
    webhookBearerToken,
    onComplete,
  } = config

  return async function handle(request, ctx) {
    const url = new URL(request.url)
    const method = request.method

    // Strip basePath prefix if configured
    const basePath = (config.basePath || '').replace(/\/$/, '')
    const pathname = url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length)
      : url.pathname
    const segments = pathname.replace(/^\//, '').split('/').filter(Boolean)
    const uuid = segments[0] || null

    if (method === 'OPTIONS') {
      return optionsResponse(maxSize)
    }

    const versionError = validateTusVersion(request)
    if (versionError) return versionError

    if (method === 'POST' && !uuid) {
      return handleCreate(request, ctx, { bucket, statePrefix, uploadsPrefix, maxSize, uploadTTL, webhookUrl, webhookBearerToken, onComplete }, url, basePath)
    }

    if (!uuid) return tusError(404, 'Not found')

    if (method === 'HEAD') return handleHead(uuid, { bucket, statePrefix })
    if (method === 'PATCH') return handlePatch(request, uuid, ctx, { bucket, statePrefix, uploadTTL, webhookUrl, webhookBearerToken, onComplete })
    if (method === 'DELETE') return handleDelete(uuid, { bucket, statePrefix })

    return new Response('Method Not Allowed', { status: 405 })
  }
}

async function handleCreate(request, ctx, config, url, basePath) {
  const { bucket, statePrefix, uploadsPrefix, maxSize, uploadTTL, webhookUrl, webhookBearerToken, onComplete } = config

  const uploadLengthHeader = request.headers.get('Upload-Length')
  const uploadDeferLength = request.headers.get('Upload-Defer-Length') === '1'

  if (!uploadLengthHeader && !uploadDeferLength) {
    return tusError(400, 'Missing Upload-Length or Upload-Defer-Length')
  }

  const uploadLength = uploadLengthHeader ? parseInt(uploadLengthHeader, 10) : -1

  if (maxSize && uploadLength !== -1 && uploadLength > maxSize) {
    return tusError(413, 'Upload exceeds maximum allowed size')
  }

  const metadata = parseMetadata(request.headers.get('Upload-Metadata'))
  const uuid = crypto.randomUUID()
  const key = `${uploadsPrefix}/${uuid}`
  const now = Date.now()

  const multipart = await createUpload(bucket, key, metadata)

  const state = {
    uploadId: multipart.uploadId,
    key,
    uploadLength,
    offset: 0,
    partNumber: 1,
    parts: [],
    metadata,
    expires: now + uploadTTL,
    createdAt: now,
  }

  const location = `${basePath}/${uuid}`

  // creation-with-upload: POST body is the first chunk
  const isCreationWithUpload = request.headers.get('Content-Type') === 'application/offset+octet-stream'
  if (isCreationWithUpload && request.body) {
    const chunkResult = await processChunk(request, state, config, ctx)
    if (chunkResult instanceof Response) return chunkResult

    return new Response(null, {
      status: 201,
      headers: tusHeaders({
        Location: location,
        'Upload-Offset': String(state.offset),
        'Upload-Expires': new Date(state.expires).toUTCString(),
      }),
    })
  }

  await writeState(bucket, statePrefix, uuid, state)

  return new Response(null, {
    status: 201,
    headers: tusHeaders({
      Location: location,
      'Upload-Expires': new Date(state.expires).toUTCString(),
    }),
  })
}

async function handleHead(uuid, { bucket, statePrefix }) {
  const state = await readState(bucket, statePrefix, uuid)
  if (!state) return tusError(404, 'Upload not found')
  if (Date.now() > state.expires) return tusError(410, 'Upload expired')

  const headers = tusHeaders({
    'Upload-Offset': String(state.offset),
    'Cache-Control': 'no-store',
  })
  if (state.uploadLength !== -1) {
    headers['Upload-Length'] = String(state.uploadLength)
  }

  return new Response(null, { status: 200, headers })
}

async function handlePatch(request, uuid, ctx, config) {
  const { bucket, statePrefix, uploadTTL } = config

  if (request.headers.get('Content-Type') !== 'application/offset+octet-stream') {
    return tusError(415, 'Content-Type must be application/offset+octet-stream')
  }

  const state = await readState(bucket, statePrefix, uuid)
  if (!state) return tusError(404, 'Upload not found')
  if (Date.now() > state.expires) return tusError(410, 'Upload expired')

  const offsetHeader = request.headers.get('Upload-Offset')
  if (offsetHeader === null || parseInt(offsetHeader, 10) !== state.offset) {
    return tusError(409, 'Upload-Offset mismatch')
  }

  // Handle deferred length
  const uploadLengthHeader = request.headers.get('Upload-Length')
  if (state.uploadLength === -1 && uploadLengthHeader) {
    state.uploadLength = parseInt(uploadLengthHeader, 10)
  }

  const error = await processChunk(request, state, config, ctx)
  if (error instanceof Response) return error

  return new Response(null, {
    status: 204,
    headers: tusHeaders({
      'Upload-Offset': String(state.offset),
      'Upload-Expires': new Date(state.expires).toUTCString(),
    }),
  })
}

async function processChunk(request, state, config, ctx) {
  const { bucket, statePrefix, uploadTTL, webhookUrl, webhookBearerToken, onComplete } = config

  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10)

  const part = await uploadPart(bucket, state.key, state.uploadId, state.partNumber, request.body)
  state.parts.push(part)
  state.offset += contentLength
  state.partNumber++
  state.expires = Date.now() + uploadTTL

  const isComplete = state.uploadLength !== -1 && state.offset >= state.uploadLength

  if (isComplete) {
    await completeUpload(bucket, state.key, state.uploadId, state.parts)
    const uuid = state.key.split('/').pop()
    await deleteState(bucket, config.statePrefix, uuid)

    if (webhookUrl || onComplete) {
      ctx.waitUntil(fireComplete(state, webhookUrl, webhookBearerToken, onComplete, bucket))
    }
  } else {
    const uuid = state.key.split('/').pop()
    await writeState(bucket, config.statePrefix, uuid, state)
  }
}

async function handleDelete(uuid, { bucket, statePrefix }) {
  const state = await readState(bucket, statePrefix, uuid)
  if (!state) return tusError(404, 'Upload not found')

  await abortUpload(bucket, state.key, state.uploadId)
  await deleteState(bucket, statePrefix, uuid)

  return new Response(null, { status: 204, headers: tusHeaders() })
}

async function fireComplete(state, webhookUrl, webhookBearerToken, onComplete, bucket) {
  const promises = []

  if (webhookUrl) {
    const headers = { 'Content-Type': 'application/json' }
    if (webhookBearerToken) headers['Authorization'] = `Bearer ${webhookBearerToken}`
    promises.push(
      fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ key: state.key, metadata: state.metadata }),
      })
    )
  }

  if (onComplete) {
    promises.push(onComplete(state.key, state.metadata, bucket))
  }

  await Promise.all(promises)
}

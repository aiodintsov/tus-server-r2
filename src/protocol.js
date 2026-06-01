export const TUS_VERSION = '1.0.0'

export const SUPPORTED_EXTENSIONS = [
  'creation',
  'creation-with-upload',
  'creation-defer-length',
  'termination',
  'expiration',
].join(',')

export function tusHeaders(extra = {}) {
  return { 'Tus-Resumable': TUS_VERSION, ...extra }
}

export function tusError(status, message) {
  return new Response(message, {
    status,
    headers: tusHeaders({ 'Content-Type': 'text/plain' }),
  })
}

export function validateTusVersion(request) {
  const version = request.headers.get('Tus-Resumable')
  if (!version || version !== TUS_VERSION) {
    return tusError(412, `Tus-Resumable must be ${TUS_VERSION}`)
  }
  return null
}

export function parseMetadata(header) {
  if (!header) return {}
  const result = {}
  for (const pair of header.split(',')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx === -1) {
      result[trimmed] = ''
    } else {
      const key = trimmed.slice(0, spaceIdx)
      const value = trimmed.slice(spaceIdx + 1)
      try {
        result[key] = atob(value)
      } catch {
        result[key] = value
      }
    }
  }
  return result
}

export function metadataToR2(metadata) {
  const httpMetadata = {}
  const customMetadata = {}
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'type') httpMetadata.contentType = v
    else if (k === 'filename') httpMetadata.contentDisposition = `attachment; filename="${v}"`
    else customMetadata[k] = v
  }
  return { httpMetadata, customMetadata }
}

export function optionsResponse(maxSize) {
  const headers = tusHeaders({
    'Tus-Version': TUS_VERSION,
    'Tus-Extension': SUPPORTED_EXTENSIONS,
  })
  if (maxSize) headers['Tus-Max-Size'] = String(maxSize)
  return new Response(null, { status: 204, headers })
}

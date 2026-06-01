export function createMockBucket() {
  const objects = new Map()
  const multiparts = new Map()

  function makeMultipartHandle(uploadId) {
    return {
      get uploadId() { return uploadId },
      async uploadPart(partNumber, body) {
        const mp = multiparts.get(uploadId)
        if (!mp) throw new Error(`Unknown uploadId: ${uploadId}`)
        const text = body instanceof ReadableStream
          ? await new Response(body).text()
          : String(body)
        mp.parts.push({ partNumber, etag: `etag-${partNumber}`, body: text })
        return { partNumber, etag: `etag-${partNumber}` }
      },
      async complete(parts) {
        const mp = multiparts.get(uploadId)
        if (!mp) throw new Error(`Unknown uploadId: ${uploadId}`)
        const sorted = [...mp.parts].sort((a, b) => a.partNumber - b.partNumber)
        const body = sorted.map(p => p.body).join('')
        objects.set(mp.key, { body, httpMetadata: mp.httpMetadata, customMetadata: mp.customMetadata })
        multiparts.delete(uploadId)
        return { key: mp.key }
      },
      async abort() {
        multiparts.delete(uploadId)
      },
    }
  }

  return {
    async get(key) {
      const obj = objects.get(key)
      if (!obj) return null
      return {
        async text() { return obj.body },
        body: obj.body,
        httpMetadata: obj.httpMetadata ?? {},
        customMetadata: obj.customMetadata ?? {},
      }
    },

    async put(key, body, options = {}) {
      objects.set(key, {
        body: typeof body === 'string' ? body : body,
        httpMetadata: options.httpMetadata ?? {},
        customMetadata: options.customMetadata ?? {},
      })
    },

    async delete(key) {
      objects.delete(key)
    },

    async createMultipartUpload(key, options = {}) {
      const uploadId = `mock-upload-${Math.random().toString(36).slice(2)}`
      multiparts.set(uploadId, { key, parts: [], ...options })
      return makeMultipartHandle(uploadId)
    },

    resumeMultipartUpload(key, uploadId) {
      return makeMultipartHandle(uploadId)
    },

    _objects: objects,
    _multiparts: multiparts,
  }
}

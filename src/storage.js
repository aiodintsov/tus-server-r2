import { metadataToR2 } from './protocol.js'

export async function createUpload(bucket, key, metadata) {
  const { httpMetadata, customMetadata } = metadataToR2(metadata)
  return bucket.createMultipartUpload(key, { httpMetadata, customMetadata })
}

export async function uploadPart(bucket, key, uploadId, partNumber, body) {
  const upload = bucket.resumeMultipartUpload(key, uploadId)
  return upload.uploadPart(partNumber, body)
}

export async function completeUpload(bucket, key, uploadId, parts) {
  const upload = bucket.resumeMultipartUpload(key, uploadId)
  return upload.complete(parts)
}

export async function abortUpload(bucket, key, uploadId) {
  const upload = bucket.resumeMultipartUpload(key, uploadId)
  return upload.abort()
}

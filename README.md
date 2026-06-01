# tus-server-r2

[![npm](https://img.shields.io/npm/v/tus-server-r2)](https://www.npmjs.com/package/tus-server-r2)
[![license](https://img.shields.io/npm/l/tus-server-r2)](./LICENSE)

[TUS resumable upload protocol](https://tus.io) server for Cloudflare Workers + R2. Zero dependencies, no KV, no Durable Objects — just your R2 bucket.

**[Documentation & Setup Guide](https://aiodintsov.github.io/tus-server-r2/)** · **[Live Upload Example](https://aiodintsov.github.io/tus-server-r2/example.html)** · **[npm](https://www.npmjs.com/package/tus-server-r2)**

## Install

```bash
npm install tus-server-r2
```

## Quickstart

**`wrangler.toml`**
```toml
name = "my-uploader"
main = "src/index.js"
compatibility_date = "2025-01-01"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "my-uploads"
```

**`src/index.js`**
```js
import { createTusHandler } from 'tus-server-r2'

export default createTusHandler()
```

```bash
npx wrangler deploy
```

TUS endpoint: `https://my-uploader.<account>.workers.dev`

## Options

```js
createTusHandler({
  bucket,              // R2Bucket instance. Default: env.BUCKET
  statePrefix,         // R2 key prefix for upload state. Default: '__tus'
  uploadsPrefix,       // R2 key prefix for completed uploads. Default: 'uploads'
  maxSize,             // Max upload size in bytes. Default: unlimited
  uploadTTL,           // Incomplete upload TTL in ms. Default: 86400000 (24h)
  webhookUrl,          // POST to this URL on completion. Default: env.WEBHOOK_URL
  webhookBearerToken,  // Bearer token for webhook. Default: env.WEBHOOK_BEARER_TOKEN
  onComplete,          // async (key, metadata, bucket) => void
  basePath,            // URL prefix if TUS is mounted at a sub-path. Default: ''
})
```

All options are optional. Called with no arguments, `createTusHandler()` reads `env.BUCKET`, `env.WEBHOOK_URL`, and `env.WEBHOOK_BEARER_TOKEN` automatically.

## Storage Layout

```
__tus/{uuid}      — upload state JSON (deleted on completion or termination)
uploads/{uuid}    — completed file
```

Both prefixes are configurable via `statePrefix` and `uploadsPrefix`.

## TUS Metadata → R2 Metadata

`Upload-Metadata` sent by the client is decoded and mapped to R2 on completion:

| TUS key    | R2 field                                        |
|------------|-------------------------------------------------|
| `type`     | `httpMetadata.contentType`                      |
| `filename` | `httpMetadata.contentDisposition`               |
| other      | `customMetadata[key]`                           |

## Supported Extensions

| Extension               | Description                                      |
|-------------------------|--------------------------------------------------|
| `creation`              | POST to create upload before sending data        |
| `creation-with-upload`  | Send first chunk in the POST body                |
| `creation-defer-length` | Omit Upload-Length at creation, provide later    |
| `termination`           | DELETE to cancel upload and free resources       |
| `expiration`            | Incomplete uploads expire after `uploadTTL`      |

## Examples

### Minimal standalone Worker

```js
import { createTusHandler } from 'tus-server-r2'

export default createTusHandler()
```

### Custom bucket binding

```js
import { createTusHandler } from 'tus-server-r2'

export default createTusHandler({ bucket: env.MYUPLOADS })
```

### With webhook notification

`wrangler.toml`:
```toml
[vars]
WEBHOOK_URL = "https://api.example.com/upload-complete"
WEBHOOK_BEARER_TOKEN = "secret-token"
```

```js
import { createTusHandler } from 'tus-server-r2'

export default createTusHandler()
// webhook fires automatically on completion
```

Webhook payload:
```json
{
  "key": "uploads/550e8400-e29b-41d4-a716-446655440000",
  "metadata": {
    "filename": "video.mp4",
    "type": "video/mp4"
  }
}
```

### With onComplete hook

```js
import { createTusHandler } from 'tus-server-r2'

export default createTusHandler({
  onComplete: async (key, metadata, bucket) => {
    // key = "uploads/{uuid}"
    // metadata = decoded TUS Upload-Metadata
    // bucket = R2Bucket — move, delete, or read the file
    console.log('Upload complete:', key, metadata)
  }
})
```

### With auth

Authorization runs before TUS handling in the Worker fetch handler:

```js
import { createTusHandler } from 'tus-server-r2'

const tus = createTusHandler()

export default {
  async fetch(request, env, ctx) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token || token !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401 })
    }
    return tus.fetch(request, env, ctx)
  }
}
```

### Mounted at a sub-path (middleware)

```js
import { createTusHandler } from 'tus-server-r2'

const tus = createTusHandler({ basePath: '/files' })

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/files')) {
      return tus.fetch(request, env, ctx)
    }
    return new Response('Not found', { status: 404 })
  }
}
```

### With custom prefixes

```js
import { createTusHandler } from 'tus-server-r2'

export default createTusHandler({
  statePrefix: 'tus',
  uploadsPrefix: 'media',
})
// state at: tus/{uuid}
// files at: media/{uuid}
```

### Expired upload cleanup (cron)

Add to `wrangler.toml`:
```toml
[triggers]
crons = ["0 * * * *"]
```

```js
import { createTusHandler } from 'tus-server-r2'

const tus = createTusHandler()

export default {
  fetch: tus.fetch.bind(tus),

  async scheduled(event, env, ctx) {
    const bucket = env.BUCKET
    const list = await bucket.list({ prefix: '__tus/' })
    for (const obj of list.objects) {
      const state = JSON.parse(await (await bucket.get(obj.key)).text())
      if (Date.now() > state.expires) {
        bucket.resumeMultipartUpload(state.key, state.uploadId).abort()
        await bucket.delete(obj.key)
      }
    }
  }
}
```

## Client Setup (Uppy)

```js
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'

const uppy = new Uppy()
uppy.use(Tus, {
  endpoint: 'https://my-uploader.<account>.workers.dev',
  headers: {
    Authorization: 'Bearer my-token'
  }
})
```

## Error Responses

| Status | Condition                                      |
|--------|------------------------------------------------|
| 400    | Missing Upload-Length and Upload-Defer-Length  |
| 404    | Upload not found                               |
| 405    | Method not allowed                             |
| 409    | Upload-Offset mismatch                         |
| 410    | Upload expired                                 |
| 412    | Missing or wrong Tus-Resumable header          |
| 413    | Upload exceeds maxSize                         |
| 415    | Wrong Content-Type on PATCH                    |

## License

MIT

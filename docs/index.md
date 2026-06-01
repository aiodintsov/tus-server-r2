---
title: tus-server-r2
---

# tus-server-r2

TUS resumable upload protocol server for Cloudflare Workers + R2.

Zero dependencies. No KV. No Durable Objects. Just your R2 bucket.

## Install

```bash
npm install tus-server-r2
```

## Quickstart

Three files, two commands:

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
npm install tus-server-r2
npx wrangler deploy
```

Your TUS endpoint is live at `https://my-uploader.<account>.workers.dev`.

## Configuration

All options are optional:

| Option               | Default            | Description                                        |
|----------------------|--------------------|----------------------------------------------------|
| `bucket`             | `env.BUCKET`       | R2Bucket instance                                  |
| `statePrefix`        | `__tus`            | R2 key prefix for upload state objects             |
| `uploadsPrefix`      | `uploads`          | R2 key prefix for completed files                  |
| `maxSize`            | unlimited          | Maximum upload size in bytes                       |
| `uploadTTL`          | `86400000` (24h)   | Incomplete upload TTL in milliseconds              |
| `webhookUrl`         | `env.WEBHOOK_URL`  | URL to POST on upload completion                   |
| `webhookBearerToken` | `env.WEBHOOK_BEARER_TOKEN` | Bearer token for webhook Authorization header |
| `onComplete`         | —                  | `async (key, metadata, bucket) => void`            |
| `basePath`           | `''`               | URL prefix when TUS is at a sub-path               |

## Environment Variables

Configure via `wrangler.toml` `[vars]` — no code changes needed:

```toml
[vars]
WEBHOOK_URL = "https://api.example.com/upload-complete"
WEBHOOK_BEARER_TOKEN = "your-secret-token"
```

## Supported TUS Extensions

- `creation` — POST to create upload
- `creation-with-upload` — first chunk in POST body
- `creation-defer-length` — unknown size at creation
- `termination` — DELETE to cancel
- `expiration` — uploads expire after `uploadTTL`

## Storage

```
__tus/{uuid}    — in-progress state (JSON)
uploads/{uuid}  — completed file
```

Both prefixes are configurable. State is deleted automatically on completion or termination.

## Webhook

On upload completion, `tus-server-r2` POSTs:

```json
{
  "key": "uploads/550e8400-e29b-41d4-a716-446655440000",
  "metadata": {
    "filename": "video.mp4",
    "type": "video/mp4"
  }
}
```

With `Authorization: Bearer <token>` if `WEBHOOK_BEARER_TOKEN` or `webhookBearerToken` is set.

## Links

- [npm](https://www.npmjs.com/package/tus-server-r2)
- [GitHub](https://github.com/aiodintsov/tus-server-r2)
- [TUS protocol](https://tus.io/protocols/resumable-upload)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [llms.txt](./llms.txt)

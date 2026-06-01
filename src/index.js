import { createHandler } from './handler.js'

export function createTusHandler(options = {}) {
  return {
    // Standalone: export default createTusHandler()
    // env fallbacks applied per-request
    async fetch(request, env, ctx) {
      const config = {
        ...options,
        bucket: options.bucket ?? env?.BUCKET,
        webhookUrl: options.webhookUrl ?? env?.WEBHOOK_URL,
        webhookBearerToken: options.webhookBearerToken ?? env?.WEBHOOK_BEARER_TOKEN,
        corsAllowOrigin: options.corsAllowOrigin ?? env?.CORS_ALLOW_ORIGIN,
      }
      return createHandler(config)(request, ctx)
    },

    // Middleware: createTusHandler({ bucket: env.MYUPLOADS }).handle(request, ctx)
    handle(request, ctx) {
      if (!options.bucket) throw new Error('bucket is required in options when using handle()')
      return createHandler(options)(request, ctx)
    },
  }
}

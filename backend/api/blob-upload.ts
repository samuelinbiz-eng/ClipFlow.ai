import { head } from '@vercel/blob'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
]
const ALLOWED_SUFFIXES = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg'])

type UploadPayload = {
  uploadId: string
  pathname: string
}

function backendUrl(path: string): string {
  const host = process.env.VERCEL_URL
  if (!host) throw new Error('Le domaine de l’API Vercel n’est pas configuré.')
  return `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}${path}`
}

function parseUploadPayload(value: string | null): UploadPayload {
  if (!value) throw new Error('La réservation de téléversement est absente.')
  const parsed: unknown = JSON.parse(value)
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('uploadId' in parsed)
    || typeof parsed.uploadId !== 'string'
    || !('pathname' in parsed)
    || typeof parsed.pathname !== 'string'
  ) {
    throw new Error('La réservation de téléversement est invalide.')
  }
  return { uploadId: parsed.uploadId, pathname: parsed.pathname }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = parseUploadPayload(clientPayload)
        const filename = pathname.slice(pathname.lastIndexOf('/') + 1)
        const suffix = filename.slice(filename.lastIndexOf('.')).toLowerCase()
        if (
          pathname !== payload.pathname
          || !ALLOWED_SUFFIXES.has(suffix)
          || !/^uploads\/[^/]+\/[0-9a-f-]{36}\.[a-z0-9]+$/i.test(pathname)
        ) {
          throw new Error('Chemin de téléversement invalide.')
        }

        const authorization = request.headers.get('authorization')
        if (!authorization?.toLowerCase().startsWith('bearer ')) {
          throw new Error('Connectez-vous pour importer une vidéo.')
        }
        const reservation = await fetch(backendUrl('/api/blob-upload/reserve'), {
          method: 'POST',
          headers: {
            authorization,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            upload_id: payload.uploadId,
            pathname,
          }),
          cache: 'no-store',
        })
        if (!reservation.ok) {
          const result: unknown = await reservation.json().catch(() => null)
          const detail =
            typeof result === 'object' && result !== null && 'detail' in result
              && typeof result.detail === 'string'
              ? result.detail
              : 'Impossible de réserver le stockage pour cette vidéo.'
          throw new Error(detail)
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 45 * 60 * 1000,
          tokenPayload: JSON.stringify(payload),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseUploadPayload(tokenPayload ?? null)
        if (blob.pathname !== payload.pathname) {
          throw new Error('Le fichier reçu ne correspond pas à sa réservation.')
        }
        const metadata = await head(blob.url)
        if (metadata.pathname !== payload.pathname || metadata.size > MAX_UPLOAD_BYTES) {
          throw new Error('Le fichier reçu ne respecte pas les limites d’import.')
        }
        const workerSecret = process.env.GEMCLIP_WORKER_SECRET
        if (!workerSecret) throw new Error('Le secret du worker GemClip n’est pas configuré.')
        const completion = await fetch(backendUrl('/api/blob-upload/complete'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-gemclip-worker-secret': workerSecret,
          },
          body: JSON.stringify({
            upload_id: payload.uploadId,
            pathname: payload.pathname,
            blob_url: blob.url,
            size: metadata.size,
          }),
          cache: 'no-store',
        })
        if (!completion.ok) {
          throw new Error('Impossible de finaliser le téléversement privé.')
        }
      },
    })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Le téléversement a échoué.'
    return Response.json({ error: message }, { status: 400 })
  }
}

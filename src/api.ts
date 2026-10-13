const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (!path.startsWith('/')) {
    throw new Error('Les chemins de l’API doivent commencer par « / ».')
  }
  if (import.meta.env.PROD && !apiBaseUrl) {
    throw new Error('Le backend n’est pas configuré. Définissez VITE_API_BASE_URL dans Vercel.')
  }
  return `${apiBaseUrl}${path}`
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (!path.startsWith('/')) {
    throw new Error('Les chemins de l’API doivent commencer par « / ».')
  }
  return `${apiBaseUrl}${path}`
}

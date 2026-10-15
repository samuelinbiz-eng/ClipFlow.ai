export type GenerationProgress = {
  progress: number
  stage: string
}

export type ClipGenerationResult = {
  title: string
  caption: string
  durationSeconds: number
  hook?: string
  explanation?: string
  tags?: string[]
  provider?: string
  notice?: string
}

export type MockClipResult = ClipGenerationResult

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Création annulée.', 'AbortError'))
      return
    }
    const timeout = window.setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout)
        reject(new DOMException('Création annulée.', 'AbortError'))
      },
      { once: true },
    )
  })
}

export async function generateClipMock(
  source: string,
  onProgress: (update: GenerationProgress) => void,
  signal: AbortSignal,
  durationSeconds = 45,
  resolution: 720 | 1080 = 1080,
  style = 'Gras',
): Promise<ClipGenerationResult> {
  if (source.toLowerCase().includes('notfound')) {
    throw new Error('Réponse invalide du serveur (Not Found).')
  }

  // Étape 1 : Récupération
  onProgress({ progress: 20, stage: 'Récupération de la source vidéo…' })
  await wait(700, signal)

  // Étape 2 : Préparation
  onProgress({ progress: 40, stage: 'Extraction audio et transcription…' })
  await wait(600, signal)

  // Étape 3 : Appel Groq IA
  onProgress({ progress: 65, stage: 'Analyse Groq IA : sélection du moment fort…' })

  let groqResult: ClipGenerationResult | null = null
  try {
    const res = await fetch('/api/groq/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, duration: durationSeconds, resolution, style }),
      signal,
    })
    if (res.ok) {
      const json = await res.json()
      if (json.success && json.data) {
        groqResult = {
          title: json.data.title || 'Mon Short Viral',
          caption: json.data.caption || 'Les idées\nprennent vie',
          durationSeconds: json.data.durationSeconds || durationSeconds,
          hook: json.data.hook,
          explanation: json.data.explanation,
          tags: json.data.tags,
          provider: json.provider,
          notice: json.notice,
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    console.warn('Erreur appel /api/groq/analyze, bascule locale :', error)
  }

  // Étape 4 : Formatage et synchronisation
  onProgress({ progress: 85, stage: 'Synchronisation des sous-titres animés 9:16…' })
  await wait(600, signal)

  // Étape 5 : Finalisation
  onProgress({ progress: 100, stage: `Rendu vertical ${resolution}p prêt !` })

  return (
    groqResult || {
      title: 'Mon Short',
      caption: 'Les idées\nprennent vie.\nC’est là que tout commence.',
      durationSeconds,
      hook: 'Le moment clé à ne pas rater',
      explanation: 'Extrait sélectionné pour une rétention maximale',
      tags: ['#Shorts', '#Viral'],
    }
  )
}

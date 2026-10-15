export type GenerationProgress = {
  progress: number
  stage: string
}

export type MockClipResult = {
  title: string
  caption: string
  durationSeconds: number
}

const generationStages = [
  { progress: 20, stage: 'Vidéo récupérée' },
  { progress: 40, stage: 'Contenu analysé' },
  { progress: 60, stage: 'L’IA choisit le meilleur extrait' },
  { progress: 80, stage: 'Sous-titres animés' },
  { progress: 100, stage: 'Export MP4' },
]

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Création annulée.', 'AbortError'))
      return
    }
    const timeout = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      reject(new DOMException('Création annulée.', 'AbortError'))
    }, { once: true })
  })
}

export async function generateClipMock(
  source: string,
  onProgress: (update: GenerationProgress) => void,
  signal: AbortSignal,
  durationSeconds = 45,
  resolution: 720 | 1080 = 1080,
): Promise<MockClipResult> {
  // TODO: Remplacer cette simulation par l’appel au backend de génération vidéo.
  if (source.toLowerCase().includes('notfound')) {
    throw new Error('réponse invalide du serveur (Not Found).')
  }

  for (const [index, step] of generationStages.entries()) {
    await wait(850, signal)
    onProgress(index === generationStages.length - 1
      ? { ...step, stage: `Export MP4 ${resolution}p` }
      : step)
  }

  return {
    title: 'Mon Short',
    caption: 'Les idées\nprennent vie',
    durationSeconds,
  }
}

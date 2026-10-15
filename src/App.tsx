import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  AlertCircle,
  Captions,
  Check,
  Clapperboard,
  Download,
  FileVideo2,
  History,
  Link2,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import AuthPage from './AuthPage'
import StudioApp from './StudioApp'
import { firebaseConfigMessage, getFirebaseAuth } from './firebase'
import { apiUrl } from './api'
import {
  deleteShortFromFirestore,
  saveShortToFirestore,
  subscribeUserShorts,
  syncExistingEntriesToFirestore,
  syncUserProfile,
} from './firestoreHistory'
import type { ShortRecord } from './firestoreHistory'


type Task = {
  task_id: string
  status: 'queued' | 'processing' | 'review' | 'completed' | 'failed'
  progress: number
  stage: string
  error: string | null
  video_url: string | null
  titre: string | null
  explication: string | null
  source?: string
  duration_seconds?: number
  resolution?: number
  aspect_ratio?: string
  subtitles?: boolean
  subtitle_color?: string
  subtitle_size?: string
  subtitle_position?: string
  subtitle_font?: string
  credit_cost?: number
  selection_start?: number
  selection_end?: number
  source_duration?: number
  created_at?: string
  updated_at?: string
}

type HistoryEntry = ShortRecord

type CreditBalance = {
  plan: 'free' | 'plus'
  daily_allowance: number
  spent_today: number
  remaining: number
  resets_at: string
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const steps = ['Vidéo', 'Transcription', 'Analyse IA', 'Sous-titres', 'Montage']
const subtitlePreviewSizes: Record<string, number> = {
  xsmall: 11,
  small: 13,
  medium: 16,
  large: 19,
  xlarge: 22,
}
const subtitleSizeValues = ['xsmall', 'small', 'medium', 'large', 'xlarge'] as const
const subtitleColorSwatches = ['#93C5FD', '#FDE68A', '#F9A8D4', '#86EFAC'] as const
const maxUploadBytes = 250 * 1024 * 1024

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safeSeconds / 60).toString().padStart(2, '0')}:${(safeSeconds % 60).toString().padStart(2, '0')}`
}

function creditResetTime(value: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return 'à la prochaine réinitialisation quotidienne'
  return `à ${new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(timestamp)} UTC`
}

function HomePage() {
  return (
    <main className="app-shell landing-shell">
      <header className="topbar landing-nav">
        <a className="brand" href="/" aria-label="Accueil GemClip">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>GemClip</span>
        </a>
        <nav className="landing-nav-actions" aria-label="Navigation principale">
          <a className="landing-login" href="/login">Connexion</a>
          <a className="landing-signup" href="/register">Créer un compte <ArrowUpRight size={15} /></a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow"><Sparkles size={14} /> LE STUDIO SHORTS PROPULSÉ PAR L’IA</span>
          <h1>Une vidéo.<br /><span>Un Short.</span></h1>
          <p className="landing-description">
            Collez un lien YouTube ou importez une vidéo. L’IA choisit le meilleur extrait
            et GemClip ajoute des sous-titres prêts à partager.
          </p>
          <div className="landing-actions">
            <a className="landing-primary" href="/register">Créer mon premier Short <ArrowUpRight size={17} /></a>
            <span className="landing-free-note">[X] jetons offerts à l’inscription</span>
          </div>
          <div className="landing-points">
            <span><Check size={15} /> Sélection intelligente</span>
            <span><Check size={15} /> Sous-titres synchronisés</span>
            <span><Check size={15} /> Prêt à télécharger</span>
          </div>
        </div>

        <div className="landing-visual" aria-label="Aperçu d’un Short vertical généré">
          <div className="landing-orbit landing-orbit-one" />
          <div className="landing-orbit landing-orbit-two" />
          <div className="landing-preview">
            <div className="landing-preview-top"><span><span className="live-dot" /> APERÇU IA</span><span>9:16</span></div>
            <div className="landing-preview-scene">
              <span className="landing-scene-glow" />
              <span className="landing-play"><ArrowUpRight size={22} /></span>
              <span className="landing-caption">LE MOMENT<br /><strong>À RETENIR</strong></span>
              <span className="landing-subtitle">« C’est là que tout change. »</span>
            </div>
            <div className="landing-preview-bottom">
              <span>Clip sélectionné par l’IA</span>
              <span className="landing-progress"><span /></span>
            </div>
          </div>
          <div className="landing-float-card"><span className="landing-float-icon"><Check size={15} /></span><span><strong>Votre Short est prêt</strong><small>Sous-titres inclus</small></span></div>
        </div>
      </section>

      <section className="landing-platforms" aria-label="Formats de publication">
        <span>PRÊT À PUBLIER SUR</span>
        <strong>YouTube Shorts</strong>
        <strong>TikTok</strong>
        <strong>Instagram Reels</strong>
        <strong>Facebook Reels</strong>
      </section>

      <section className="landing-product-features" aria-labelledby="landing-features-title">
        <h2 id="landing-features-title">Tout ce qu’il faut, rien de plus.</h2>
        <div className="landing-features">
          <article><div><strong>Extrait choisi par l’IA</strong><p>GemClip analyse la vidéo et sélectionne un passage à transformer en Short.</p></div></article>
          <article><div><strong>Sous-titres configurables</strong><p>Activez les sous-titres et ajustez leur taille, leur police et leur couleur.</p></div></article>
          <article><div><strong>Export MP4</strong><p>Téléchargez la vidéo générée et partagez-la sur vos plateformes.</p></div></article>
        </div>
      </section>

      <section className="landing-pricing" aria-labelledby="landing-pricing-title">
        <h2 id="landing-pricing-title">Commencez gratuitement.</h2>
        <div className="landing-plan-grid">
          <article className="landing-plan-card">
            <span>Gratuit</span>
            <h3>[X] jetons pour essayer</h3>
            <p>Pour essayer GemClip et créer vos premiers Shorts.</p>
            <a href="/register">Créer un compte</a>
          </article>
          <article className="landing-plan-card featured">
            <span>Plus</span>
            <h3>100 jetons / jour</h3>
            <p>Un quota quotidien supérieur pour créer plus de vidéos.</p>
            <a href="/register">Découvrir GemClip</a>
          </article>
        </div>
      </section>
      <footer>GemClip <span>·</span> Le format court, simplement.</footer>
    </main>
  )
}

function SessionScreen({ loading, message }: { loading: boolean; message?: string }) {
  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="GemClip">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>GemClip</span>
        </a>
        <span className="local-badge"><span className="live-dot" /> Espace sécurisé</span>
      </header>
      <section className="auth-content">
        <article className="auth-card auth-state-card" role={loading ? 'status' : 'alert'}>
          {loading ? <LoaderCircle className="spin" size={24} /> : <ShieldCheck size={22} />}
          <h1>{loading ? 'Vérification de votre session' : 'Configuration requise'}</h1>
          <p className="auth-intro">{message}</p>
          {!loading && (
            <button className="auth-submit" type="button" onClick={() => window.location.reload()}>
              Réessayer
            </button>
          )}
        </article>
      </section>
      <footer>GemClip <span>·</span> Vos vidéos sont traitées par GemClip.</footer>
    </main>
  )
}

function UserAvatar({ user }: { user: User }) {
  const [imageFailed, setImageFailed] = useState(false)
  const initials = user.displayName
    ?.trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || user.email?.[0]?.toUpperCase() || '?'

  return (
    <span className="user-avatar" aria-label={user.displayName ?? user.email ?? 'Profil utilisateur'}>
      {user.photoURL && !imageFailed ? (
        <img src={user.photoURL} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      ) : initials}
    </span>
  )
}

function formatApiError(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (typeof item !== 'object' || item === null) return []

      const error = item as { loc?: unknown[]; msg?: unknown; message?: unknown }
      const message = typeof error.msg === 'string'
        ? error.msg
        : typeof error.message === 'string'
          ? error.message
          : ''
      if (!message) return []
      const fieldPath = error.loc?.filter((part): part is string | number =>
        typeof part === 'string' || typeof part === 'number',
      ).slice(1).join('.')
      const field = fieldPath ? ({
        duration_seconds: 'Durée',
        aspect_ratio: 'Format',
        resolution: 'Qualité',
        subtitles: 'Sous-titres',
        youtube_url: 'Lien YouTube',
        video: 'Fichier vidéo',
      }[fieldPath] ?? fieldPath) : ''
      return [field ? `${field} : ${message}` : message]
    })
    if (messages.length) return messages.join(' · ')
  }
  if (typeof detail === 'object' && detail !== null) {
    const error = detail as { msg?: unknown; message?: unknown }
    if (typeof error.msg === 'string') return error.msg
    if (typeof error.message === 'string') return error.message
  }
  return `Le serveur a répondu ${status}.`
}

async function authenticatedFetch(user: User, input: string, init: RequestInit = {}) {
  const token = await user.getIdToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(apiUrl(input), { ...init, headers })
}

async function fetchCredits(user: User): Promise<CreditBalance> {
  const controller = new AbortController()
  const timeoutMessage = 'Le solde met trop de temps à répondre. Vérifiez la connexion au serveur puis réessayez.'
  let timeout: number | undefined
  try {
    const response = await Promise.race([
      authenticatedFetch(user, '/api/credits', { signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          controller.abort()
          reject(new Error(timeoutMessage))
        }, 12_000)
      }),
    ])
    const result = await response.json()
    if (!response.ok) throw new ApiError(formatApiError(result.detail, response.status), response.status)
    return result as CreditBalance
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

async function fetchHistory(user: User): Promise<HistoryEntry[]> {
  const response = await authenticatedFetch(user, '/api/history')
  const result = await response.json()
  if (!response.ok) throw new ApiError(formatApiError(result.detail, response.status), response.status)
  return result as HistoryEntry[]
}

async function fetchTaskVideo(user: User, taskId: string): Promise<Blob> {
  const response = await authenticatedFetch(
    user,
    `/api/history/${encodeURIComponent(taskId)}/download`,
  )
  if (!response.ok) {
    const result = await response.json()
    throw new ApiError(formatApiError(result.detail, response.status), response.status)
  }
  return response.blob()
}

function ClipWorkspace({ user }: { user: User }) {
  const [sourceType, setSourceType] = useState<'youtube' | 'file'>('youtube')
  const [url, setUrl] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [duration, setDuration] = useState('45')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [resolution, setResolution] = useState('1080')
  const [subtitles, setSubtitles] = useState(true)
  const [subtitleColor, setSubtitleColor] = useState('#FFD400')
  const [subtitleSize, setSubtitleSize] = useState('medium')
  const [subtitlePosition, setSubtitlePosition] = useState('bottom')
  const [subtitleFont, setSubtitleFont] = useState('Arial')
  const [task, setTask] = useState<Task | null>(null)
  const [reviewStartTime, setReviewStartTime] = useState<number | null>(null)
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [videoRetry, setVideoRetry] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [formError, setFormError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(true)
  const [creditsError, setCreditsError] = useState('')
  const [creditsReload, setCreditsReload] = useState(0)
  const creditDay = useRef(new Date().toISOString().slice(0, 10))
  const fileInput = useRef<HTMLInputElement>(null)
  const sourceForm = useRef<HTMLFormElement>(null)

  useEffect(() => {
    let cancelled = false
    setCreditsLoading(true)
    setCreditsError('')
    void fetchCredits(user)
      .then((balance) => {
        if (!cancelled) {
          setCredits(balance)
          setCreditsError('')
        }
      })
      .catch(async (error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          await signOut(getFirebaseAuth())
          window.location.replace('/login')
          return
        }
        setCreditsError(error instanceof Error ? error.message : 'Impossible de charger vos jetons.')
      })
      .finally(() => {
        if (!cancelled) setCreditsLoading(false)
      })
    return () => { cancelled = true }
  }, [user, creditsReload])

  useEffect(() => {
    void syncUserProfile(user)
  }, [user])

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError('')

    // Abonnement temps réel à l'historique Firestore
    const unsubscribe = subscribeUserShorts(
      user.uid,
      (firestoreEntries) => {
        if (!cancelled) {
          setHistory(firestoreEntries)
          setHistoryLoading(false)
        }
      },
      async (error) => {
        if (cancelled) return
        console.warn('Erreur Firestore, bascule vers le backend :', error)
        try {
          const backendEntries = await fetchHistory(user)
          if (!cancelled) setHistory(backendEntries)
        } catch (fetchError) {
          if (!cancelled) {
            setHistoryError(fetchError instanceof Error ? fetchError.message : 'Impossible de charger l’historique.')
          }
        } finally {
          if (!cancelled) setHistoryLoading(false)
        }
      },
    )

    // Synchronisation automatique des créations existantes vers Firestore
    void fetchHistory(user)
      .then((backendEntries) => {
        if (!cancelled && backendEntries?.length) {
          void syncExistingEntriesToFirestore(user.uid, backendEntries)
        }
      })
      .catch(() => {
        // Ignorer si indisponible
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [user])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const today = new Date().toISOString().slice(0, 10)
      if (today === creditDay.current) return
      creditDay.current = today
      void fetchCredits(user)
        .then((balance) => {
          setCredits(balance)
          setCreditsError('')
        })
        .catch(async (error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            await signOut(getFirebaseAuth())
            window.location.replace('/login')
            return
          }
          setCreditsError(error instanceof Error ? error.message : 'Impossible de renouveler vos jetons.')
        })
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [user])

  useEffect(() => {
    if (task?.status === 'review') {
      setReviewStartTime(task.selection_start ?? 0)
      setAspectRatio(task.aspect_ratio ?? '9:16')
      setSubtitles(task.subtitles ?? true)
      setSubtitleColor(task.subtitle_color ?? '#FFD400')
      setSubtitleSize(task.subtitle_size ?? 'medium')
      setSubtitlePosition(task.subtitle_position ?? 'bottom')
      setSubtitleFont(task.subtitle_font ?? 'Arial')
    } else {
      setReviewStartTime(null)
    }
  }, [task?.task_id, task?.status])

  useEffect(() => {
    if (task?.status !== 'completed' && task?.status !== 'failed') return
    let cancelled = false
    void fetchCredits(user)
      .then((balance) => {
        if (!cancelled) {
          setCredits(balance)
          setCreditsError('')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCreditsError(error instanceof Error ? error.message : 'Impossible de mettre à jour vos jetons.')
        }
      })
    return () => { cancelled = true }
  }, [task?.status, user])


  useEffect(() => {
    if (!task || task.status === 'completed' || task.status === 'failed') return
    const poll = async () => {
      try {
        const response = await authenticatedFetch(user, `/api/status/${task.task_id}`)
        if (response.status === 401) {
          await signOut(getFirebaseAuth())
          window.location.replace('/login')
          return
        }
        if (response.status === 404) {
          const failedTask: Task = {
            ...task,
            status: 'failed',
            stage: 'Échec',
            error: 'Cette tâche a été perdue après un redémarrage du backend. Relancez la création du Short.',
            updated_at: new Date().toISOString(),
          }
          setTask(failedTask)
          void saveShortToFirestore(user.uid, failedTask)
          return
        }
        if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`)
        const updatedTask = (await response.json()) as Task
        setTask(updatedTask)
        if (updatedTask.status === 'review' || updatedTask.status === 'completed' || updatedTask.status === 'failed') {
          void saveShortToFirestore(user.uid, updatedTask)
        }
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Impossible de contacter le backend.')
      }
    }
    const interval = window.setInterval(poll, 1500)
    void poll()
    return () => window.clearInterval(interval)
  }, [task?.task_id, task?.status, user])

  useEffect(() => {
    if (!task || task.status !== 'completed' || !task.video_url) {
      setVideoObjectUrl(null)
      setVideoLoading(false)
      setVideoError('')
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    setVideoObjectUrl(null)
    setVideoError('')
    setVideoLoading(true)
    void fetchTaskVideo(user, task.task_id)
      .then((video) => {
        objectUrl = URL.createObjectURL(video)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
        } else {
          setVideoObjectUrl(objectUrl)
        }
      })
      .catch(async (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          await signOut(getFirebaseAuth())
          window.location.replace('/login')
          return
        }
        if (!cancelled) {
          setVideoError(
            error instanceof TypeError
              ? 'Le Short est créé, mais le serveur vidéo est injoignable. Vérifiez que le backend est démarré, puis réessayez.'
              : error instanceof Error
                ? error.message
                : 'Impossible de charger votre vidéo.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setVideoLoading(false)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [task?.task_id, task?.status, task?.video_url, user, videoRetry])


  async function createClip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setTask(null)
    if (sourceType === 'youtube') {
      try {
        new URL(url)
      } catch {
        setFormError('Saisissez une URL YouTube valide.')
        return
      }
    } else if (!videoFile) {
      setFormError('Sélectionnez un fichier vidéo.')
      return
    } else if (videoFile.size > maxUploadBytes) {
      setFormError('La vidéo ne doit pas dépasser 250 Mo.')
      return
    }

    setSubmitting(true)
    setUploadProgress(null)
    try {
      const options = {
        duration_seconds: Number(duration),
        aspect_ratio: aspectRatio,
        resolution: Number(resolution),
        subtitles,
        subtitle_color: subtitleColor,
        subtitle_size: subtitleSize,
        subtitle_position: subtitlePosition,
        subtitle_font: subtitleFont,
      }
      let response: Response
      if (sourceType === 'youtube') {
        response = await authenticatedFetch(user, '/api/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ youtube_url: url, ...options }),
          })
      } else {
        if (!videoFile) throw new Error('Sélectionnez un fichier vidéo.')
        if (import.meta.env.DEV) {
          const body = new FormData()
          body.append('video', videoFile)
          Object.entries(options).forEach(([key, value]) => body.append(key, String(value)))
          response = await authenticatedFetch(user, '/api/clip/upload', { method: 'POST', body })
        } else {
          const { upload: uploadBlob } = await import('@vercel/blob/client')
          const uploadId = crypto.randomUUID()
          const suffix = videoFile.name.slice(videoFile.name.lastIndexOf('.')).toLowerCase()
          const pathname = `uploads/${user.uid}/${uploadId}${suffix}`
          const token = await user.getIdToken()
          const blob = await uploadBlob(pathname, videoFile, {
            access: 'private',
            handleUploadUrl: apiUrl('/api/blob-upload'),
            headers: { Authorization: `Bearer ${token}` },
            clientPayload: JSON.stringify({ uploadId, pathname }),
            contentType: videoFile.type || undefined,
            multipart: true,
            onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
          })
          const finalized = await authenticatedFetch(user, '/api/blob-upload/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_id: uploadId, pathname, blob_url: blob.url }),
          })
          if (finalized.status === 401) {
            await signOut(getFirebaseAuth())
            window.location.assign('/login')
            return
          }
          const finalizedResult = await finalized.json()
          if (!finalized.ok) {
            throw new Error(formatApiError(finalizedResult.detail, finalized.status))
          }
          setUploadProgress(100)
          response = await authenticatedFetch(user, '/api/clip/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_id: uploadId, ...options }),
          })
        }
      }
      const result = await response.json()
      if (response.status === 401) {
        await signOut(getFirebaseAuth())
        window.location.assign('/login')
        return
      }
      if (!response.ok) {
        if (response.status === 402) {
          setCredits(await fetchCredits(user))
        }
        throw new Error(formatApiError(result.detail, response.status))
      }
      const newTask: Task = {
        task_id: result.task_id,
        status: 'queued',
        progress: 0,
        stage: 'En attente',
        error: null,
        video_url: null,
        titre: null,
        explication: null,
        source: sourceType === 'youtube' ? 'YouTube' : (videoFile?.name || 'Vidéo importée'),
        duration_seconds: Number(duration),
        resolution: Number(resolution),
        aspect_ratio: aspectRatio,
        subtitles,
        subtitle_color: subtitleColor,
        subtitle_size: subtitleSize,
        subtitle_position: subtitlePosition,
        subtitle_font: subtitleFont,
        credit_cost: tokenCost,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setTask(newTask)
      setCredits((current) => current ? {
        ...current,
        spent_today: current.spent_today + tokenCost,
        remaining: Math.max(0, current.remaining - tokenCost),
      } : current)
      void saveShortToFirestore(user.uid, newTask)
      setShowHistory(false)

    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'La création de la tâche a échoué.')
    } finally {
      setSubmitting(false)
      setUploadProgress(null)
    }
  }

  const currentStage = task?.stage ?? ''
  const activeStep = currentStage.includes('Téléchargement') || currentStage.includes('Préparation')
    ? 0
    : currentStage.includes('Transcription')
      ? 1
      : currentStage.includes('Analyse')
        ? 2
        : currentStage.includes('sous-titres')
          ? 3
          : currentStage.includes('Montage')
            ? 4
            : -1
  const working = task?.status === 'queued' || task?.status === 'processing'
  const tokenCost = Math.ceil(Number(duration) / 30) + (resolution === '1080' ? 1 : 0)
  const hasEnoughCredits = credits !== null && credits.remaining >= tokenCost

  async function openHistory() {
    setShowHistory(true)
    setHistoryError('')
    try {
      const backendEntries = await fetchHistory(user)
      if (backendEntries?.length) {
        void syncExistingEntriesToFirestore(user.uid, backendEntries)
      }
    } catch {
      // Non bloquant si Firestore a déjà les données
    }
  }

  async function handleDeleteHistoryItem(event: React.MouseEvent, taskId: string) {
    event.stopPropagation()
    if (!window.confirm('Voulez-vous supprimer ce Short de votre historique ?')) {
      return
    }
    setHistory((prev) => prev.filter((item) => item.task_id !== taskId))
    if (task?.task_id === taskId) {
      setTask(null)
    }
    try {
      await deleteShortFromFirestore(user.uid, taskId)
    } catch (err) {
      console.warn('Erreur suppression Firestore :', err)
    }
    try {
      await authenticatedFetch(user, `/api/history/${taskId}`, { method: 'DELETE' })
    } catch (err) {
      console.warn('Erreur suppression backend :', err)
    }
  }

  async function downloadHistoryItem(event: React.MouseEvent, taskId: string) {
    event.stopPropagation()
    try {
      const video = await fetchTaskVideo(user, taskId)
      const objectUrl = URL.createObjectURL(video)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `gemclip-${taskId}.mp4`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await signOut(getFirebaseAuth())
        window.location.replace('/login')
        return
      }
      setFormError(error instanceof Error ? error.message : 'Impossible de télécharger cette vidéo.')
    }
  }

  async function renderSelectedClip() {
    if (!task || task.status !== 'review' || reviewStartTime === null) return
    setFormError('')
    try {
      const response = await authenticatedFetch(user, `/api/clip/${task.task_id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_time: reviewStartTime,
          aspect_ratio: aspectRatio,
          subtitles,
          subtitle_color: subtitleColor,
          subtitle_size: subtitleSize,
          subtitle_position: subtitlePosition,
          subtitle_font: subtitleFont,
        }),
      })
      const result = await response.json()
      if (response.status === 401) {
        await signOut(getFirebaseAuth())
        window.location.assign('/login')
        return
      }
      if (!response.ok) {
        throw new Error(formatApiError(result.detail, response.status))
      }
      setTask({
        ...task,
        ...{
          aspect_ratio: aspectRatio,
          subtitles,
          subtitle_color: subtitleColor,
          subtitle_size: subtitleSize,
          subtitle_position: subtitlePosition,
          subtitle_font: subtitleFont,
        },
        status: 'processing',
        progress: 65,
        stage: 'Montage FFmpeg',
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Impossible de lancer le rendu du Short.')
    }
  }


  async function logout() {
    setLoggingOut(true)
    try {
      await signOut(getFirebaseAuth())
      window.location.assign('/login')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'La déconnexion a échoué.')
      setLoggingOut(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Accueil GemClip">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>GemClip</span>
        </a>
        <span className="local-badge"><span className="live-dot" /> GemClip</span>
        <div className="account-actions">
          <a className="subscription-nav" href="/subscribe">Abonnement</a>
          <UserAvatar user={user} />
          <span className="account-email" title={user.email ?? user.uid}>{user.email ?? user.uid}</span>
          <button className="logout-button" type="button" onClick={logout} disabled={loggingOut} aria-label="Se déconnecter">
            {loggingOut ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="control-panel">
          <div className="panel-kicker"><Sparkles size={14} /> GEMCLIP</div>
          <h1>Créer un <span>Short</span></h1>
          <p className="panel-description">Transformez une vidéo en clip vertical sous-titré.</p>
          <div className="credit-balance" aria-live="polite" aria-busy={creditsLoading}>
            <span className="credit-count">
              <img
                className="credit-icon"
                src="https://img.icons8.com/?size=100&id=ykmhl41iogPd&format=png&color=000000"
                alt=""
              />
              <strong>{credits ? credits.remaining : creditsLoading ? '…' : '—'}</strong>
              <span>
                {credits?.plan === 'plus'
                  ? 'jetons disponibles aujourd’hui'
                  : credits
                    ? 'jetons gratuits aujourd’hui'
                    : creditsLoading
                      ? 'chargement des jetons'
                      : 'jetons indisponibles'}
              </span>
            </span>
            {credits?.plan === 'plus' ? (
              <span className="plan-badge plus">PLUS</span>
            ) : (
              <a className="plan-badge plan-upgrade" href="/subscribe">PLUS · 100/J</a>
            )}
          </div>
          {creditsError && (
            <div className="credit-load-error" role="alert">
              <span>{creditsError}</span>
              <button
                className="credit-retry"
                type="button"
                disabled={creditsLoading}
                onClick={() => {
                  setCreditsLoading(true)
                  setCreditsReload((current) => current + 1)
                }}
              >
                <RefreshCw size={12} /> Réessayer
              </button>
            </div>
          )}

          <section className="creation-settings" id="creation-settings" aria-label="Options de création">
            <div className="settings-heading">
              <span>Format du Short</span>
              <span className="settings-summary">
                {duration} s · {resolution}p · {tokenCost} jeton{tokenCost > 1 ? 's' : ''}
              </span>
            </div>
            <div className="settings-grid primary-settings">
              <label>
                Durée
                <select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={Boolean(working) || submitting}>
                  <option value="30">30 s</option>
                  <option value="45">45 s</option>
                  <option value="55">55 s</option>
                </select>
              </label>
              <label>
                Qualité
                <select value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={Boolean(working) || submitting}>
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
                </select>
              </label>
              <label className="subtitle-option">
                <input
                  type="checkbox"
                  checked={subtitles}
                  onChange={(event) => setSubtitles(event.target.checked)}
                  disabled={Boolean(working) || submitting}
                />
                <span>Sous-titres</span>
              </label>
            </div>
            <details className="advanced-settings">
              <summary>Personnaliser le format et les sous-titres</summary>
              <div className="settings-grid">
                <label>
                  Format
                  <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} disabled={Boolean(working) || submitting}>
                    <option value="9:16">Vertical · 9:16</option>
                    <option value="1:1">Carré · 1:1</option>
                    <option value="16:9">Paysage · 16:9</option>
                  </select>
                </label>
                <label>
                  Couleur
                  <span className="subtitle-color-control">
                    <input
                      aria-label="Choisir la couleur des sous-titres"
                      type="color"
                      value={subtitleColor}
                      onChange={(event) => setSubtitleColor(event.target.value.toUpperCase())}
                      disabled={Boolean(working) || submitting || !subtitles}
                    />
                    <span>{subtitleColor}</span>
                  </span>
                </label>
                <label>
                  Taille
                  <select value={subtitleSize} onChange={(event) => setSubtitleSize(event.target.value)} disabled={Boolean(working) || submitting || !subtitles}>
                    <option value="xsmall">Très petite</option>
                    <option value="small">Petite</option>
                    <option value="medium">Moyenne</option>
                    <option value="large">Grande</option>
                    <option value="xlarge">Très grande</option>
                  </select>
                </label>
                <label>
                  Police
                  <select value={subtitleFont} onChange={(event) => setSubtitleFont(event.target.value)} disabled={Boolean(working) || submitting || !subtitles}>
                    <option value="Arial">Arial</option>
                    <option value="DejaVu Sans">DejaVu Sans</option>
                    <option value="Liberation Sans">Liberation Sans</option>
                    <option value="Noto Sans">Noto Sans</option>
                  </select>
                </label>
                <label>
                  Position
                  <select value={subtitlePosition} onChange={(event) => setSubtitlePosition(event.target.value)} disabled={Boolean(working) || submitting || !subtitles}>
                    <option value="bottom">En bas</option>
                    <option value="center">Au centre</option>
                    <option value="top">En haut</option>
                  </select>
                </label>
                <span
                  className="subtitle-preview"
                  style={{
                    color: subtitleColor,
                    fontFamily: subtitleFont,
                    fontSize: `${subtitlePreviewSizes[subtitleSize] ?? 16}px`,
                  }}
                >
                  Aperçu des sous-titres
                </span>
              </div>
            </details>
          </section>

          <form className="source-form" ref={sourceForm} onSubmit={createClip}>
            <div className="source-tabs" role="group" aria-label="Source de la vidéo">
              <button
                className={sourceType === 'youtube' ? 'source-tab active' : 'source-tab'}
                type="button"
                aria-pressed={sourceType === 'youtube'}
                onClick={() => { setSourceType('youtube'); setFormError('') }}
                disabled={Boolean(working) || submitting}
              >
                <span className="source-tab-icons" aria-hidden="true">
                  <img src="https://img.icons8.com/?size=100&id=118640&format=png&color=000000" alt="" />
                  <img src="https://img.icons8.com/?size=100&id=19318&format=png&color=000000" alt="" />
                </span>
                Liens
              </button>
              <button
                className={sourceType === 'file' ? 'source-tab active' : 'source-tab'}
                type="button"
                aria-pressed={sourceType === 'file'}
                onClick={() => { setSourceType('file'); setFormError('') }}
                disabled={Boolean(working) || submitting}
              >
                <FileVideo2 size={15} /> Fichier
              </button>
            </div>

            <input
              ref={fileInput}
              className="file-input"
              aria-label="Choisir une vidéo à importer"
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo,video/mpeg,.mp4,.mov,.mkv,.webm,.avi,.mpeg,.mpg"
              onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
              disabled={Boolean(working) || submitting}
            />
            {sourceType === 'youtube' ? (
              <label className="source-input">
                <Link2 size={16} className="input-icon" />
                <input
                  aria-label="Lien de la vidéo YouTube"
                  type="url"
                  placeholder="Collez un lien YouTube"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={Boolean(working) || submitting}
                  required
                />
              </label>
            ) : (
              <button
                className="source-input file-picker"
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={Boolean(working) || submitting}
              >
                <FileVideo2 size={16} className="input-icon" />
                <span>{videoFile ? videoFile.name : 'Choisir une vidéo'}</span>
              </button>
            )}
            <p className="upload-note">
              {sourceType === 'youtube'
                ? import.meta.env.DEV
                  ? 'Lien public ou accessible avec vos cookies locaux.'
                  : 'Lien YouTube public.'
                : submitting && uploadProgress !== null
                  ? `Téléversement privé sécurisé · ${uploadProgress} %`
                  : 'MP4, MOV, MKV, WEBM, AVI · 250 Mo max.'}
            </p>
            <button
              className="create-button"
              type="submit"
              disabled={Boolean(working) || submitting || creditsLoading || !hasEnoughCredits || (sourceType === 'youtube' ? !url.trim() : !videoFile)}
            >
              {submitting ? <LoaderCircle className="spin" size={17} /> : <>Créer mon Short · {tokenCost} jeton{tokenCost > 1 ? 's' : ''} <ArrowUpRight size={16} /></>}
            </button>
            {!creditsLoading && credits && !hasEnoughCredits && (
              <p className="credit-warning" role="status">
                Jetons insuffisants pour cette création. Renouvellement à 00:00 UTC.
              </p>
            )}
          </form>

          {formError && <p className="error-message" role="alert">{formError}</p>}
          <div className="feature-list">
            <span><Check size={14} /> Recadrage vertical automatique</span>
            <span><Check size={14} /> Sous-titres synchronisés</span>
            <span><Check size={14} /> Son original conservé</span>
          </div>
        </aside>

        <section className="result-card" aria-live="polite">
          <div className="result-toolbar">
            <div>
              <span className="result-eyebrow">VOTRE ESPACE · SYNC FIREBASE</span>
              <h2>
                {showHistory
                  ? 'Historique des créations'
                  : task?.status === 'review'
                    ? 'Éditeur du Short'
                    : task?.status === 'queued' || task?.status === 'processing'
                      ? 'Génération'
                      : 'Aperçu du Short'}
              </h2>
            </div>
            <button
              className={`history-toggle ${showHistory ? 'active' : ''}`}
              type="button"
              onClick={() => void (showHistory ? setShowHistory(false) : openHistory())}
              aria-pressed={showHistory}
            >
              {showHistory ? <Clapperboard size={15} /> : <History size={15} />}
              {showHistory ? 'Créer un Short' : `Historique${history.length ? ` · ${history.length}` : ''}`}
            </button>
          </div>
          {showHistory ? (
            <div className="history-panel">
              {historyLoading ? (
                <p className="history-message"><LoaderCircle className="spin" size={17} /> Chargement de vos créations…</p>
              ) : historyError ? (
                <p className="history-error" role="alert">{historyError}</p>
              ) : history.length === 0 ? (
                <div className="history-empty">
                  <History size={23} />
                  <p>Vos Shorts créés apparaîtront ici et sont synchronisés en temps réel avec Firebase.</p>
                </div>
              ) : (
                <ul className="history-list">
                  {history.map((entry) => (
                    <li className="history-item" key={entry.task_id}>
                      <button className="history-open" type="button" onClick={() => { setTask(entry); setShowHistory(false) }}>
                        <span className={`history-status ${entry.status}`}>
                          {entry.status === 'completed' ? <Check size={13} /> : entry.status === 'processing' || entry.status === 'queued' || entry.status === 'review' ? <LoaderCircle size={13} /> : '!'}
                        </span>
                        <span className="history-item-main">
                          <strong>{entry.titre || entry.source}</strong>
                          <span>{entry.source} · {entry.duration_seconds}s · {entry.resolution}p · {entry.credit_cost} jeton{entry.credit_cost === 1 ? '' : 's'}</span>
                        </span>
                        <span className={`history-status-label ${entry.status}`}>
                          {entry.status === 'completed' ? 'Terminé' : entry.status === 'failed' ? 'Échec' : entry.status === 'review' ? 'À ajuster' : entry.status === 'queued' ? 'En attente' : 'En cours'}
                        </span>
                        <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleDateString('fr-FR')}</time>
                      </button>
                      {entry.status === 'completed' && entry.video_url && (
                        <button
                          className="history-download"
                          type="button"
                          onClick={(event) => void downloadHistoryItem(event, entry.task_id)}
                          aria-label="Télécharger ce Short"
                          title="Télécharger le Short"
                        >
                          <Download size={15} />
                        </button>
                      )}
                      <button
                        className="history-delete"
                        type="button"
                        onClick={(event) => void handleDeleteHistoryItem(event, entry.task_id)}
                        aria-label="Supprimer de l’historique"
                        title="Supprimer de l’historique"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          ) : !task && !creditsLoading && credits && !hasEnoughCredits ? (
            <div className="credit-exhausted-grid">
              <article className="credit-exhausted-card">
                <span className="credit-state-icon"><AlertCircle size={20} /></span>
                <h2>Pas assez de jetons pour ce Short.</h2>
                <p>
                  Il vous en reste {credits.remaining} et cette création en demande {tokenCost}.
                  Réduisez la durée ou la qualité pour continuer.
                </p>
                <div className="credit-state-detail">
                  Votre quota sera renouvelé {creditResetTime(credits.resets_at)}.
                </div>
                <a className="credit-secondary-action" href="#creation-settings">Modifier les options</a>
              </article>
              <aside className="credit-upgrade-card">
                <span className="credit-state-icon"><Zap size={20} /></span>
                <h2>{credits.plan === 'plus' ? 'Vos jetons reviennent bientôt.' : 'Besoin de plus de jetons ?'}</h2>
                <p>
                  {credits.plan === 'plus'
                    ? `Votre quota Plus revient ${creditResetTime(credits.resets_at)}.`
                    : 'Avec Plus, votre quota passe à 100 jetons renouvelés chaque jour.'}
                </p>
                <div
                  className="credit-quota-track"
                  role="progressbar"
                  aria-label="Jetons quotidiens restants"
                  aria-valuemin={0}
                  aria-valuemax={credits.daily_allowance}
                  aria-valuenow={credits.remaining}
                >
                  <span style={{ width: `${credits.daily_allowance > 0 ? (credits.remaining / credits.daily_allowance) * 100 : 0}%` }} />
                </div>
                {credits.plan === 'plus'
                  ? <a className="credit-upgrade-action secondary" href="#creation-settings">Modifier la création</a>
                  : <a className="credit-upgrade-action" href="/subscribe">Passer à Plus <ArrowUpRight size={15} /></a>}
              </aside>
            </div>
          ) : !task ? (
            <div className="empty-result">
              <div className="empty-preview" aria-hidden="true">
                <span className="empty-preview-format">APERÇU · 9:16</span>
                <div className="empty-preview-scene">
                  <span className="empty-preview-glow" />
                  <span className="empty-preview-play"><Clapperboard size={20} /></span>
                  <span className="empty-preview-caption">
                    <span>LES IDÉES</span>
                    <strong>PRENNENT VIE</strong>
                  </span>
                  <span className="empty-preview-progress"><span /></span>
                </div>
              </div>
              <h2>Votre Short apparaîtra ici</h2>
              <p>Ajoutez une vidéo pour lancer votre création.</p>
              <div className="preview-features">
                <span><Sparkles size={13} /> Extrait choisi par IA</span>
                <span><Check size={13} /> Sous-titres animés</span>
                <span><Download size={13} /> Export MP4</span>
              </div>
            </div>
          ) : task.status === 'failed' ? (
            <div className="task-failure-grid">
              <article className="task-failure-card">
                <span className="credit-state-icon error"><AlertCircle size={20} /></span>
                <h2>Impossible de lire cette vidéo.</h2>
                <p>Vérifiez que le lien est accessible, puis relancez la création.</p>
                <p className="task-error">{task.error || 'Une erreur est survenue pendant la création.'}</p>
                <button className="task-retry-button" type="button" onClick={() => sourceForm.current?.requestSubmit()}>
                  Réessayer <RefreshCw size={15} />
                </button>
                <button
                  className="task-change-source"
                  type="button"
                  onClick={() => {
                    setTask(null)
                    setUrl('')
                    setVideoFile(null)
                    setSourceType('youtube')
                    setFormError('')
                  }}
                >
                  Changer de source
                </button>
              </article>
              <aside className="credit-upgrade-card">
                <span className="credit-state-icon"><Zap size={20} /></span>
                <h2>{credits?.plan === 'plus' ? 'Vos jetons reviennent bientôt.' : 'Plus de jetons chaque jour.'}</h2>
                <p>
                  {credits?.plan === 'plus'
                    ? `Votre quota Plus revient ${creditResetTime(credits.resets_at)}.`
                    : 'Plus vous donne 100 jetons renouvelés chaque jour.'}
                </p>
                <div className="credit-quota-track"><span style={{ width: `${credits && credits.daily_allowance > 0 ? (credits.remaining / credits.daily_allowance) * 100 : 0}%` }} /></div>
                {credits?.plan === 'plus'
                  ? <a className="credit-upgrade-action secondary" href="#creation-settings">Retour aux options</a>
                  : <a className="credit-upgrade-action" href="/subscribe">Passer à Plus <ArrowUpRight size={15} /></a>}
              </aside>
            </div>
          ) : task.status === 'review' ? (
            (() => {
              const clipDuration = Math.max(
                0,
                (task.selection_end ?? task.duration_seconds ?? 0)
                  - (task.selection_start ?? 0),
              )
              const sourceDuration = task.source_duration ?? clipDuration
              const maxStart = Math.max(0, sourceDuration - clipDuration)
              const start = Math.min(reviewStartTime ?? task.selection_start ?? 0, maxStart)
              const selectionLeft = sourceDuration > 0 ? (start / sourceDuration) * 100 : 0
              const selectionWidth = sourceDuration > 0 ? (clipDuration / sourceDuration) * 100 : 100
              const selectedSizeIndex = Math.max(0, subtitleSizeValues.indexOf(subtitleSize as typeof subtitleSizeValues[number]))

              return (
                <div className="editor-screen">
                  <header className="editor-toolbar">
                    <button className="editor-back" type="button" onClick={() => { setTask(null); setFormError('') }}>
                      <ArrowUpRight size={14} /> Retour à la création
                    </button>
                    <div className="editor-document-title">
                      <strong>{task.titre || 'Mon Short'}</strong>
                      <span>Brouillon · enregistrement automatique</span>
                    </div>
                    <button className="editor-history-button" type="button" onClick={() => void openHistory()}>
                      <History size={15} /> Historique
                    </button>
                  </header>

                  <div className="editor-workspace">
                    <nav className="editor-tools" aria-label="Outils de l’éditeur">
                      <a className="active" href="#editor-excerpt"><Scissors size={18} /><span>Extrait</span></a>
                      <a href="#editor-captions"><Captions size={18} /><span>Sous-titres</span></a>
                      <a href="#editor-format"><Smartphone size={18} /><span>Format</span></a>
                    </nav>

                    <section className="editor-stage" aria-label="Aperçu du Short">
                      <div className="editor-phone-preview" style={{ aspectRatio: aspectRatio.replace(':', ' / ') }}>
                        <span className="editor-preview-title">{task.titre || 'Votre Short'}</span>
                        {subtitles && (
                          <span
                            className={`editor-caption-preview position-${subtitlePosition}`}
                            style={{
                              color: subtitleColor,
                              fontFamily: subtitleFont,
                              fontSize: `${subtitlePreviewSizes[subtitleSize] ?? 16}px`,
                            }}
                          >
                            Aperçu des sous-titres
                          </span>
                        )}
                        <span className="editor-preview-progress"><span style={{ width: `${task.progress}%` }} /></span>
                      </div>
                      <span className="editor-preview-format">Aperçu {aspectRatio} · {resolution}p</span>
                    </section>

                    <aside className="editor-settings">
                      <section id="editor-excerpt" className="editor-setting-section">
                        <h3><Scissors size={16} /> Extrait</h3>
                        {task.explication && <p className="editor-explanation">{task.explication}</p>}
                        <p className="clip-review-note">
                          Déplacez la sélection pour choisir un autre passage. Sa durée reste de {Math.round(clipDuration)} secondes.
                        </p>
                        <div className="clip-range-labels">
                          <span>Début <strong>{formatTime(start)}</strong></span>
                          <span>Fin <strong>{formatTime(start + clipDuration)}</strong></span>
                        </div>
                        <input
                          className="clip-range"
                          aria-label="Déplacer le passage vidéo"
                          type="range"
                          min="0"
                          max={maxStart}
                          step="0.1"
                          value={start}
                          onChange={(event) => setReviewStartTime(Number(event.target.value))}
                        />
                        <div className="clip-range-scale">
                          <span>00:00</span>
                          <span>{formatTime(sourceDuration)}</span>
                        </div>
                      </section>

                      <section id="editor-captions" className="editor-setting-section">
                        <div className="editor-section-title">
                          <h3><Captions size={16} /> Sous-titres</h3>
                          <label className="editor-toggle">
                            <input type="checkbox" checked={subtitles} onChange={(event) => setSubtitles(event.target.checked)} />
                            <span>{subtitles ? 'Activés' : 'Désactivés'}</span>
                          </label>
                        </div>
                        <label className="editor-field-label" htmlFor="editor-subtitle-size">Taille</label>
                        <input
                          id="editor-subtitle-size"
                          className="editor-slider"
                          type="range"
                          min="0"
                          max={subtitleSizeValues.length - 1}
                          step="1"
                          value={selectedSizeIndex}
                          onChange={(event) => setSubtitleSize(subtitleSizeValues[Number(event.target.value)])}
                          disabled={!subtitles}
                        />
                        <div className="editor-setting-heading">Couleur</div>
                        <div className="editor-color-swatches" role="group" aria-label="Couleur des sous-titres">
                          {subtitleColorSwatches.map((color) => (
                            <button
                              key={color}
                              className={subtitleColor === color ? 'selected' : ''}
                              type="button"
                              style={{ backgroundColor: color }}
                              aria-label={`Choisir la couleur ${color}`}
                              aria-pressed={subtitleColor === color}
                              onClick={() => setSubtitleColor(color)}
                              disabled={!subtitles}
                            />
                          ))}
                          <label className="editor-custom-color" title="Choisir une couleur personnalisée">
                            <input
                              aria-label="Couleur personnalisée des sous-titres"
                              type="color"
                              value={subtitleColor}
                              onChange={(event) => setSubtitleColor(event.target.value.toUpperCase())}
                              disabled={!subtitles}
                            />
                          </label>
                        </div>
                        <div className="editor-setting-heading">Position</div>
                        <div className="editor-choice-group">
                          {(['top', 'center', 'bottom'] as const).map((position) => (
                            <button
                              key={position}
                              className={subtitlePosition === position ? 'selected' : ''}
                              type="button"
                              aria-pressed={subtitlePosition === position}
                              onClick={() => setSubtitlePosition(position)}
                              disabled={!subtitles}
                            >
                              {position === 'top' ? 'Haut' : position === 'center' ? 'Milieu' : 'Bas'}
                            </button>
                          ))}
                        </div>
                        <label className="editor-field-label" htmlFor="editor-subtitle-font">Police</label>
                        <select
                          id="editor-subtitle-font"
                          className="editor-font-select"
                          value={subtitleFont}
                          onChange={(event) => setSubtitleFont(event.target.value)}
                          disabled={!subtitles}
                        >
                          <option value="Arial">Arial</option>
                          <option value="DejaVu Sans">DejaVu Sans</option>
                          <option value="Liberation Sans">Liberation Sans</option>
                          <option value="Noto Sans">Noto Sans</option>
                        </select>
                      </section>

                      <section id="editor-format" className="editor-setting-section">
                        <h3><Smartphone size={16} /> Format</h3>
                        <label className="editor-field-label" htmlFor="editor-aspect-ratio">Format vidéo</label>
                        <select
                          id="editor-aspect-ratio"
                          className="editor-font-select"
                          value={aspectRatio}
                          onChange={(event) => setAspectRatio(event.target.value)}
                        >
                          <option value="9:16">Vertical · 9:16</option>
                          <option value="1:1">Carré · 1:1</option>
                          <option value="16:9">Paysage · 16:9</option>
                        </select>
                        <p className="editor-format-note">Durée fixe : {Math.round(clipDuration)} s · Qualité : {resolution}p · {task.credit_cost ?? tokenCost} jetons</p>
                      </section>
                    </aside>
                  </div>

                  <section className="editor-timeline" aria-labelledby="editor-timeline-title">
                    <div className="editor-timeline-toolbar">
                      <h3 id="editor-timeline-title">Sélection de l’extrait</h3>
                      <span>{formatTime(start)} — {formatTime(start + clipDuration)}</span>
                    </div>
                    <div className="editor-timeline-track">
                      <span className="editor-timeline-selection" style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />
                      <input
                        className="editor-timeline-range"
                        aria-label="Déplacer la sélection sur la chronologie"
                        type="range"
                        min="0"
                        max={maxStart}
                        step="0.1"
                        value={start}
                        onChange={(event) => setReviewStartTime(Number(event.target.value))}
                      />
                    </div>
                    <div className="editor-timeline-scale"><span>00:00</span><span>{formatTime(sourceDuration)}</span></div>
                    <div className="editor-timeline-caption">
                      <span>Sous-titres</span>
                      <span className={subtitles ? 'active' : ''}>
                        {subtitles ? 'Sous-titres activés · style personnalisable' : 'Sous-titres désactivés'}
                      </span>
                    </div>
                  </section>

                  <div className="editor-finalize">
                    <p>La source est conservée temporairement pour finaliser votre sélection.</p>
                    <button className="editor-export-button" type="button" onClick={() => void renderSelectedClip()}>
                      <Sparkles size={15} /> Créer ce Short
                    </button>
                  </div>
                  {formError && <p className="error-message" role="alert">{formError}</p>}
                </div>
              )
            })()
          ) : task.status === 'completed' ? (
            <>
              <div className="card-heading"><span className="status-icon success"><Check size={17} /></span><div><h2>Votre Short est prêt</h2><p>{task.titre}</p></div></div>
              {task.explication && <p className="explanation">{task.explication}</p>}
              <div className="video-details">
                <span>{task.aspect_ratio || '9:16'}</span>
                <span>{task.resolution || 1080}p</span>
                {task.subtitles && <span>Sous-titres animés</span>}
              </div>
              {videoLoading && <p className="history-message">Chargement de la vidéo…</p>}
              {videoError && (
                <div className="video-load-error" role="alert">
                  <p>{videoError}</p>
                  <button
                    className="history-toggle"
                    type="button"
                    onClick={() => setVideoRetry((attempt) => attempt + 1)}
                    disabled={videoLoading}
                  >
                    <RefreshCw size={14} /> Réessayer
                  </button>
                </div>
              )}
              {videoObjectUrl && <video className="video-result" src={videoObjectUrl} controls playsInline />}
              {videoObjectUrl && <a className="download-link" href={videoObjectUrl} download="gemclip-short.mp4">Télécharger la vidéo <ArrowUpRight size={15} /></a>}
            </>
          ) : (
            <div className="processing-layout">
              <section className="processing-status-card">
                <div className="card-heading">
                  <span className="status-icon processing"><LoaderCircle className="spin" size={17} /></span>
                  <div><h2>Création en cours…</h2><p>{task.stage || 'Préparation du traitement…'}</p></div>
                  <strong className="percentage">{task.progress}%</strong>
                </div>
                <p className="processing-credit-note">
                  Gardez cette page ouverte. {task.credit_cost ?? tokenCost} jeton{(task.credit_cost ?? tokenCost) === 1 ? '' : 's'} utilisés.
                </p>
                <div className="progress-track"><div className="progress-value" style={{ width: `${task.progress}%` }} /></div>
                <div className="steps-row">
                  {steps.map((step, index) => (
                    <span key={step} className={index < activeStep ? 'step done' : index === activeStep ? 'step current' : 'step'}>{step}</span>
                  ))}
                </div>
                <p className="progress-note">Le traitement continue sur le serveur. Retrouvez vos créations dans l’historique.</p>
              </section>
              <div className="processing-preview-wrap">
                <div className="processing-preview" aria-label={`Aperçu vertical au format ${task.aspect_ratio || aspectRatio}`}>
                  <span>Votre Short</span>
                  <strong>arrive</strong>
                  <div className="processing-preview-progress"><span style={{ width: `${task.progress}%` }} /></div>
                </div>
                <p>Aperçu {task.aspect_ratio || aspectRatio}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <footer>GemClip <span>·</span> Vos fichiers sont traités sur nos serveurs.</footer>
    </main>
  )
}

export default function App() {
  const path = window.location.pathname
  const authMode = path === '/register' ? 'register' : path === '/login' ? 'login' : null
  const isPublicHome = path === '/'
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(authMode === null && !isPublicHome)
  const [sessionError, setSessionError] = useState('')

  useEffect(() => {
    if (authMode !== null) return
    try {
      return onAuthStateChanged(
        getFirebaseAuth(),
        (currentUser) => {
          setUser(currentUser)
          setCheckingSession(false)
          if (!currentUser && !isPublicHome) window.location.replace('/login')
        },
        (error) => {
          setSessionError(error.message || 'Impossible de vérifier votre session Firebase.')
          setCheckingSession(false)
        },
      )
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : firebaseConfigMessage)
      setCheckingSession(false)
    }
  }, [authMode, isPublicHome])

  if (authMode) return <AuthPage mode={authMode} />
  if (checkingSession) {
    return <SessionScreen loading message="Un instant, nous vérifions votre connexion Firebase." />
  }
  if (sessionError && !isPublicHome) {
    return <SessionScreen loading={false} message={sessionError} />
  }
  if (!user) return isPublicHome ? <HomePage /> : null
  if (path === '/legacy') return <ClipWorkspace user={user} />
  return <StudioApp user={user} initialScreen={path === '/subscribe' ? 'pricing' : undefined} />
}

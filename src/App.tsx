import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Clapperboard,
  Download,
  FileVideo2,
  History,
  Link2,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import AuthPage from './AuthPage'
import SubscriptionPage from './SubscriptionPage'
import { firebaseConfigMessage, getFirebaseAuth } from './firebase'
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
  status: 'queued' | 'processing' | 'completed' | 'failed'
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
  credit_cost?: number
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

function HomePage() {
  return (
    <main className="app-shell landing-shell">
      <header className="topbar landing-nav">
        <a className="brand" href="/" aria-label="ClipFlow AI accueil">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>clipflow<span className="brand-ai">.ai</span></span>
        </a>
        <nav className="landing-nav-actions" aria-label="Navigation principale">
          <a className="landing-login" href="/login">Connexion</a>
          <a className="landing-signup" href="/register">Créer un compte <ArrowUpRight size={15} /></a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow"><Sparkles size={14} /> LE STUDIO SHORTS PROPULSÉ PAR L’IA</span>
          <h1>Vos vidéos.<br /><span>Des Shorts qui accrochent.</span></h1>
          <p className="landing-description">
            Transformez une vidéo YouTube ou un fichier en clips verticaux sous-titrés.
            L’IA repère le moment fort, ClipFlow s’occupe du montage.
          </p>
          <div className="landing-actions">
            <a className="landing-primary" href="/register">Créer mon premier Short <ArrowUpRight size={17} /></a>
            <span className="landing-free-note">10 jetons offerts chaque jour</span>
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

      <section className="landing-features" aria-label="Fonctionnalités">
        <article><span>01</span><div><strong>Ajoutez une vidéo</strong><p>Collez un lien YouTube ou importez votre fichier.</p></div></article>
        <article><span>02</span><div><strong>L’IA trouve le bon passage</strong><p>Un extrait captivant, sans montage manuel.</p></div></article>
        <article><span>03</span><div><strong>Téléchargez votre Short</strong><p>Format vertical et sous-titres prêts à partager.</p></div></article>
      </section>
      <footer>ClipFlow AI <span>·</span> Le format court, simplement.</footer>
    </main>
  )
}

function SessionScreen({ loading, message }: { loading: boolean; message?: string }) {
  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ClipFlow AI">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>clipflow<span className="brand-ai">.ai</span></span>
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
      <footer>ClipFlow AI <span>·</span> Vos vidéos sont traitées sur cette machine.</footer>
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
  return fetch(input, { ...init, headers })
}

async function fetchCredits(user: User): Promise<CreditBalance> {
  const response = await authenticatedFetch(user, '/api/credits')
  const result = await response.json()
  if (!response.ok) throw new ApiError(formatApiError(result.detail, response.status), response.status)
  return result as CreditBalance
}

async function fetchHistory(user: User): Promise<HistoryEntry[]> {
  const response = await authenticatedFetch(user, '/api/history')
  const result = await response.json()
  if (!response.ok) throw new ApiError(formatApiError(result.detail, response.status), response.status)
  return result as HistoryEntry[]
}

function ClipWorkspace({ user }: { user: User }) {
  const [sourceType, setSourceType] = useState<'youtube' | 'file'>('youtube')
  const [url, setUrl] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [duration, setDuration] = useState('45')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [resolution, setResolution] = useState('1080')
  const [subtitles, setSubtitles] = useState(true)
  const [subtitleColor, setSubtitleColor] = useState('yellow')
  const [subtitleSize, setSubtitleSize] = useState('medium')
  const [subtitlePosition, setSubtitlePosition] = useState('bottom')
  const [task, setTask] = useState<Task | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(true)
  const creditDay = useRef(new Date().toISOString().slice(0, 10))
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void fetchCredits(user)
      .then((balance) => {
        if (!cancelled) setCredits(balance)
      })
      .catch(async (error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          await signOut(getFirebaseAuth())
          window.location.replace('/login')
          return
        }
        setFormError(error instanceof Error ? error.message : 'Impossible de charger vos jetons.')
      })
      .finally(() => {
        if (!cancelled) setCreditsLoading(false)
      })
    return () => { cancelled = true }
  }, [user])

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
        .then(setCredits)
        .catch(async (error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            await signOut(getFirebaseAuth())
            window.location.replace('/login')
            return
          }
          setFormError(error instanceof Error ? error.message : 'Impossible de renouveler vos jetons.')
        })
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [user])

  useEffect(() => {
    if (task?.status !== 'completed' && task?.status !== 'failed') return
    let cancelled = false
    void fetchCredits(user)
      .then((balance) => {
        if (!cancelled) setCredits(balance)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFormError(error instanceof Error ? error.message : 'Impossible de mettre à jour vos jetons.')
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
        if (updatedTask.status === 'completed' || updatedTask.status === 'failed') {
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
    } else if (videoFile.size > 2 * 1024 * 1024 * 1024) {
      setFormError('La vidéo ne doit pas dépasser 2 Go.')
      return
    }

    setSubmitting(true)
    try {
      const options = {
        duration_seconds: Number(duration),
        aspect_ratio: aspectRatio,
        resolution: Number(resolution),
        subtitles,
        subtitle_color: subtitleColor,
        subtitle_size: subtitleSize,
        subtitle_position: subtitlePosition,
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
        const body = new FormData()
        body.append('video', videoFile)
        Object.entries(options).forEach(([key, value]) => body.append(key, String(value)))
        response = await authenticatedFetch(user, '/api/clip/upload', { method: 'POST', body })
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
        credit_cost: tokenCost,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setTask(newTask)
      void saveShortToFirestore(user.uid, newTask)
      setShowHistory(false)

    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'La création de la tâche a échoué.')
    } finally {
      setSubmitting(false)
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
        <a className="brand" href="/" aria-label="ClipFlow AI accueil">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>clipflow<span className="brand-ai">.ai</span></span>
        </a>
        <span className="local-badge"><span className="live-dot" /> Traitement local</span>
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
          <div className="panel-kicker"><Sparkles size={14} /> CLIPFLOW AI</div>
          <h1>Créer un <span>Short</span></h1>
          <p className="panel-description">Transformez une vidéo en clip vertical sous-titré.</p>
          <div className="credit-balance" aria-live="polite">
            <span className="credit-count">
              <img
                className="credit-icon"
                src="https://img.icons8.com/?size=100&id=ykmhl41iogPd&format=png&color=000000"
                alt=""
              />
              <strong>{creditsLoading ? '…' : credits?.remaining ?? '—'}</strong>
              <span>{credits?.plan === 'plus' ? 'jetons disponibles aujourd’hui' : 'jetons gratuits aujourd’hui'}</span>
            </span>
            {credits?.plan === 'plus' ? (
              <span className="plan-badge plus">PLUS</span>
            ) : (
              <a className="plan-badge plan-upgrade" href="/subscribe">PLUS · 100/J</a>
            )}
          </div>

          <section className="creation-settings" aria-label="Options de création">
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
                  <select value={subtitleColor} onChange={(event) => setSubtitleColor(event.target.value)} disabled={Boolean(working) || submitting || !subtitles}>
                    <option value="yellow">Jaune</option>
                    <option value="white">Blanc</option>
                    <option value="cyan">Cyan</option>
                    <option value="pink">Rose</option>
                  </select>
                </label>
                <label>
                  Taille
                  <select value={subtitleSize} onChange={(event) => setSubtitleSize(event.target.value)} disabled={Boolean(working) || submitting || !subtitles}>
                    <option value="small">Petite</option>
                    <option value="medium">Moyenne</option>
                    <option value="large">Grande</option>
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
              </div>
            </details>
          </section>

          <form className="source-form" onSubmit={createClip}>
            <div className="source-tabs" role="group" aria-label="Source de la vidéo">
              <button
                className={sourceType === 'youtube' ? 'source-tab active' : 'source-tab'}
                type="button"
                aria-pressed={sourceType === 'youtube'}
                onClick={() => { setSourceType('youtube'); setFormError('') }}
                disabled={Boolean(working) || submitting}
              >
                <Link2 size={15} /> YouTube
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
              {sourceType === 'youtube' ? 'Lien public ou accessible avec vos cookies.' : 'MP4, MOV, MKV, WEBM, AVI · 2 Go max.'}
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
              <h2>{showHistory ? 'Historique des créations' : 'Aperçu du Short'}</h2>
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
                          {entry.status === 'completed' ? <Check size={13} /> : entry.status === 'processing' || entry.status === 'queued' ? <LoaderCircle size={13} /> : '!'}
                        </span>
                        <span className="history-item-main">
                          <strong>{entry.titre || entry.source}</strong>
                          <span>{entry.source} · {entry.duration_seconds}s · {entry.resolution}p · {entry.credit_cost} jeton{entry.credit_cost === 1 ? '' : 's'}</span>
                        </span>
                        <span className={`history-status-label ${entry.status}`}>
                          {entry.status === 'completed' ? 'Terminé' : entry.status === 'failed' ? 'Échec' : entry.status === 'queued' ? 'En attente' : 'En cours'}
                        </span>
                        <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleDateString('fr-FR')}</time>
                      </button>
                      {entry.status === 'completed' && entry.video_url && (
                        <a className="history-download" href={entry.video_url} download={`clipflow-${entry.task_id}.mp4`} aria-label="Télécharger ce Short" title="Télécharger le Short">
                          <Download size={15} />
                        </a>
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

          ) : !task ? (
            <div className="empty-result">
              <span className="empty-result-icon"><Clapperboard size={26} /></span>
              <h2>Votre résultat apparaîtra ici</h2>
              <p>Ajoutez une vidéo pour générer votre premier Short.</p>
            </div>
          ) : task.status === 'failed' ? (
            <>
              <div className="card-heading"><span className="status-icon failed">!</span><div><h2>Le traitement a échoué</h2><p>{task.stage || 'Une erreur est survenue pendant la création.'}</p></div></div>
              <p className="task-error">{task.error || 'Erreur inconnue.'}</p>
            </>
          ) : task.status === 'completed' ? (
            <>
              <div className="card-heading"><span className="status-icon success"><Check size={17} /></span><div><h2>Votre Short est prêt</h2><p>{task.titre}</p></div></div>
              {task.explication && <p className="explanation">{task.explication}</p>}
              {task.video_url && <video className="video-result" src={task.video_url} controls playsInline />}
              <a className="download-link" href={task.video_url ?? undefined} download="clipflow-short.mp4">Télécharger la vidéo <ArrowUpRight size={15} /></a>
            </>
          ) : (
            <>
              <div className="card-heading"><span className="status-icon processing"><LoaderCircle className="spin" size={17} /></span><div><h2>Création de votre Short</h2><p>{task.stage || 'Préparation du traitement...'}</p></div><strong className="percentage">{task.progress}%</strong></div>
              <div className="progress-track"><div className="progress-value" style={{ width: `${task.progress}%` }} /></div>
              <div className="steps-row">
                {steps.map((step, index) => (
                  <span key={step} className={index < activeStep ? 'step done' : index === activeStep ? 'step current' : 'step'}>{step}</span>
                ))}
              </div>
              <p className="progress-note">Votre vidéo est traitée localement, gardez la page ouverte.</p>
            </>
          )}
        </section>
      </div>

      <footer>ClipFlow AI <span>·</span> Vos fichiers sont traités sur cette machine.</footer>
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
  if (path === '/subscribe') return <SubscriptionPage user={user} />
  return <ClipWorkspace user={user} />
}

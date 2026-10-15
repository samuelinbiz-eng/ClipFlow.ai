import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Copy,
  Download,
  Film,
  History,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Minus,
  MoreHorizontal,
  Music2,
  Play,
  Plus,
  Redo2,
  Scissors,
  Settings2,
  Share2,
  Smartphone,
  Sparkles,
  Subtitles,
  Type,
  Undo2,
  WandSparkles,
  Zap,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { getFirebaseAuth } from './firebase'
import { generateClipMock } from './apiMock'

export const FREE_TOKENS = 10
export const SHORT_COST = 3
export const PLUS_TOKENS = 100
export const PLUS_PRICE = 4.99

type MainScreen = 'create' | 'generation' | 'editor' | 'history' | 'account' | 'pricing' | 'error' | 'exhausted'
type SubtitleStyle = 'Gras' | 'Sobre' | 'Marqué'
type SubtitleAnimation = 'Aucune' | 'Mot par mot' | 'Pop' | 'Karaoké' | 'Machine à écrire' | 'Glissé'
type EditorTool = 'Extrait' | 'Sous-titres' | 'Format' | 'Audio' | 'Recadrage' | 'Effets' | 'Titre' | 'Historique'

type SubtitleSettings = {
  style: SubtitleStyle
  position: 'Haut' | 'Milieu' | 'Bas'
  size: number
  color: string
  animation: SubtitleAnimation
  animationSpeed: number
  font: 'Outfit' | 'Montserrat' | 'Anton' | 'Poppins'
  highlightedWords: boolean
  automaticEmojis: boolean
  outline: boolean
  hidePunctuation: boolean
  enabled: boolean
  text: string
}

type ShortItem = SubtitleSettings & {
  id: string
  title: string
  source: string
  createdAt: string
  durationSeconds: number
  progress: number
  stage: string
  status: 'generating' | 'ready' | 'failed' | 'cancelled'
  error?: string
}

type StudioState = {
  profile: { displayName: string; email: string; photoURL: string | null } | null
  plan: 'free' | 'plus'
  tokens: number
  lastResetDay: string
  history: ShortItem[]
  activeShortId: string | null
  screen: MainScreen
  sourceDraft: string
  duration: number
  resolution: 720 | 1080
  subtitlesEnabled: boolean
  subtitleDefaults: SubtitleSettings
}

const STORAGE_KEY = 'gemclip-studio-v1'
const DEFAULT_SUBTITLES: SubtitleSettings = {
  style: 'Gras',
  position: 'Bas',
  size: 22,
  color: '#93C5FD',
  animation: 'Mot par mot',
  animationSpeed: 1,
  font: 'Outfit',
  highlightedWords: true,
  automaticEmojis: false,
  outline: true,
  hidePunctuation: false,
  enabled: true,
  text: 'Les idées\nprennent vie',
}
const COLORS = ['#93C5FD', '#FDE68A', '#F9A8D4', '#86EFAC']
const TOOLS: { name: EditorTool; icon: typeof Scissors }[] = [
  { name: 'Extrait', icon: Scissors },
  { name: 'Sous-titres', icon: Subtitles },
  { name: 'Format', icon: Smartphone },
  { name: 'Audio', icon: AudioLines },
  { name: 'Recadrage', icon: LayoutGrid },
  { name: 'Effets', icon: WandSparkles },
  { name: 'Titre', icon: Type },
  { name: 'Historique', icon: History },
]

function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

function initialStudioState(): StudioState {
  return {
    profile: null,
    plan: 'free',
    tokens: FREE_TOKENS,
    lastResetDay: utcDay(),
    history: [],
    activeShortId: null,
    screen: 'create',
    sourceDraft: '',
    duration: 45,
    resolution: 1080,
    subtitlesEnabled: true,
    subtitleDefaults: { ...DEFAULT_SUBTITLES },
  }
}

function readStudioState(): { value: StudioState; warning: string } {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return { value: initialStudioState(), warning: '' }
    const parsed = JSON.parse(stored) as Partial<StudioState>
    if (
      !parsed
      || !Array.isArray(parsed.history)
      || !['free', 'plus'].includes(String(parsed.plan))
      || typeof parsed.tokens !== 'number'
    ) {
      return { value: initialStudioState(), warning: 'Les données locales GemClip sont invalides. Un nouvel espace a été créé.' }
    }
    const value = { ...initialStudioState(), ...parsed } as StudioState
    if (value.lastResetDay !== utcDay()) {
      value.tokens = value.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS
      value.lastResetDay = utcDay()
    }
    return { value, warning: '' }
  } catch {
    return { value: initialStudioState(), warning: 'Le stockage local est inaccessible. Votre progression ne sera pas conservée.' }
  }
}

function Button({
  children,
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'dark' | 'quiet' }) {
  return <button className={`gc-button gc-button-${variant} ${className}`} {...props}>{children}</button>
}

function Chip({ children, active = false, className = '' }: { children: ReactNode; active?: boolean; className?: string }) {
  return <span className={`gc-chip ${active ? 'is-active' : ''} ${className}`}>{children}</span>
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`gc-card ${className}`}>{children}</section>
}

function TokenPill({ tokens }: { tokens: number }) {
  return <span className="gc-token-pill"><Zap size={16} strokeWidth={2} /><strong>{tokens}</strong><span>/ 100 jetons</span></span>
}

function Toggle({ label, checked, onChange, badge }: { label: string; checked: boolean; onChange: (value: boolean) => void; badge?: string }) {
  return (
    <label className="gc-toggle-row">
      <span>{label}{badge && <small>{badge}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="gc-toggle-track" aria-hidden="true"><span /></span>
    </label>
  )
}

function PhonePreview({
  caption = DEFAULT_SUBTITLES.text,
  subtitle = true,
  settings = DEFAULT_SUBTITLES,
  variant = 'short',
}: {
  caption?: string
  subtitle?: boolean
  settings?: SubtitleSettings
  variant?: 'short' | 'empty' | 'generating'
}) {
  const displayedCaption = settings.hidePunctuation ? caption.replace(/[.,!?;:]/g, '') : caption
  const lines = displayedCaption.split('\n')
  const animationClass = settings.animation.toLowerCase().replace(/\s/g, '-').replace(/à/g, 'a')
  const previewFont = {
    Outfit: 'Outfit, sans-serif',
    Montserrat: 'Montserrat, Arial, sans-serif',
    Anton: 'Anton, Impact, sans-serif',
    Poppins: 'Poppins, "Trebuchet MS", sans-serif',
  }[settings.font]
  return (
    <div className={`gc-phone gc-phone-${variant}`} aria-label="Aperçu vidéo vertical au format 9:16">
      {variant === 'generating' ? (
        <div className="gc-phone-arrival"><span>Votre Short</span><strong>arrive</strong></div>
      ) : (
        <>
          <div className="gc-phone-scenery" />
          {variant === 'empty' && <div className="gc-phone-play"><Play size={20} fill="currentColor" /></div>}
          {subtitle && (
            <div
              className={`gc-phone-caption position-${settings.position.toLowerCase()} style-${settings.style.toLowerCase()} ${settings.highlightedWords ? 'highlight-keywords' : ''} ${settings.outline ? 'with-outline' : ''} animation-${animationClass}`}
              style={{
                '--gc-accent': settings.color,
                fontSize: `${settings.size}px`,
                fontFamily: previewFont,
                animationDuration: `${1 / settings.animationSpeed}s`,
              } as CSSProperties}
            >
              {lines.map((line, index) => <span key={`${line}-${index}`}>{line}{settings.automaticEmojis && index === lines.length - 1 ? ' ✨' : ''}</span>)}
            </div>
          )}
        </>
      )}
      <div className="gc-phone-progress"><span /></div>
    </div>
  )
}

function Header({
  user,
  tokens,
  onNavigate,
}: {
  user: User
  tokens: number
  onNavigate: (screen: MainScreen) => void
}) {
  const [avatarError, setAvatarError] = useState(false)
  const avatarLetters = (user.displayName || user.email || 'G')
    .split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return (
    <header className="gc-header">
      <a className="gc-brand" href="/" aria-label="GemClip, accueil">
        <span className="gc-brand-mark"><Clapperboard size={19} strokeWidth={2} /></span>
        GemClip
      </a>
      <span className="gc-prototype-badge"><Sparkles size={13} /> Prototype · génération simulée</span>
      <nav className="gc-desktop-nav" aria-label="Navigation principale">
        <button type="button" onClick={() => onNavigate('create')}>Créer</button>
        <button type="button" onClick={() => onNavigate('history')}>Historique</button>
        <button type="button" onClick={() => onNavigate('pricing')}>Abonnement</button>
      </nav>
      <div className="gc-header-actions">
        <Button className="gc-subscribe-button" onClick={() => onNavigate('pricing')}>Abonnement</Button>
        <TokenPill tokens={tokens} />
        <button className="gc-avatar" type="button" onClick={() => onNavigate('account')} aria-label="Ouvrir le compte">
          {user.photoURL && !avatarError
            ? <img src={user.photoURL} alt="" onError={() => setAvatarError(true)} />
            : avatarLetters}
        </button>
      </div>
    </header>
  )
}

function BottomNavigation({ screen, onNavigate }: { screen: MainScreen; onNavigate: (screen: MainScreen) => void }) {
  return (
    <nav className="gc-bottom-nav" aria-label="Navigation mobile">
      <button className={screen === 'create' ? 'active' : ''} type="button" onClick={() => onNavigate('create')}>
        <Plus size={19} /><span>Créer</span>
      </button>
      <button className={screen === 'history' ? 'active' : ''} type="button" onClick={() => onNavigate('history')}>
        <History size={19} /><span>Historique</span>
      </button>
      <button className={screen === 'account' ? 'active' : ''} type="button" onClick={() => onNavigate('account')}>
        <Settings2 size={19} /><span>Compte</span>
      </button>
    </nav>
  )
}

function ShortTile({ item, active, onEdit }: { item: ShortItem; active?: boolean; onEdit: () => void }) {
  return (
    <article className={`gc-short-tile ${active ? 'selected' : ''}`}>
      <button type="button" className="gc-short-tile-preview" onClick={onEdit} aria-label={`Rééditer ${item.title}`}>
        <PhonePreview caption={item.text} settings={item} />
        {active && <span className="gc-current-badge"><Check size={12} /> En cours</span>}
      </button>
      <div className="gc-short-tile-meta">
        <div><strong>{item.title || 'Short sans titre'}</strong><span>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(item.createdAt))} · {item.durationSeconds} s</span></div>
        <Button onClick={onEdit}>Rééditer</Button>
      </div>
    </article>
  )
}

function StudioApp({ user, initialScreen }: { user: User; initialScreen?: MainScreen }) {
  const [initial] = useState(readStudioState)
  const [data, setData] = useState<StudioState>(initialScreen
    ? { ...initial.value, screen: initialScreen }
    : initial.value)
  const [storageWarning, setStorageWarning] = useState(initial.warning)
  const [notice, setNotice] = useState('')
  const [editorTool, setEditorTool] = useState<EditorTool>('Sous-titres')
  const [source, setSource] = useState(data.sourceDraft)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [playhead, setPlayhead] = useState(12)
  const [musicAdded, setMusicAdded] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  const [settingsUndo, setSettingsUndo] = useState<SubtitleSettings[]>([])
  const [settingsRedo, setSettingsRedo] = useState<SubtitleSettings[]>([])
  const lastResetRef = useRef(data.lastResetDay)
  const abortController = useRef<AbortController | null>(null)
  const runningId = useRef<string | null>(null)

  const activeShort = useMemo(
    () => data.history.find((item) => item.id === data.activeShortId) ?? null,
    [data.history, data.activeShortId],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      setStorageWarning('')
    } catch {
      setStorageWarning('Le navigateur ne peut pas enregistrer votre espace. Vérifiez le stockage local.')
    }
  }, [data])

  useEffect(() => {
    setData((current) => ({
      ...current,
      profile: {
        displayName: user.displayName || user.email?.split('@')[0] || 'GemClip',
        email: user.email || '',
        photoURL: user.photoURL,
      },
    }))
  }, [user])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const today = utcDay()
      if (lastResetRef.current === today) return
      lastResetRef.current = today
      setData((current) => {
        return {
          ...current,
          lastResetDay: today,
          tokens: current.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS,
        }
      })
      setNotice('Vos jetons quotidiens ont été renouvelés.')
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setSettingsUndo([])
    setSettingsRedo([])
  }, [activeShort?.id])

  useEffect(() => {
    if (data.screen !== 'generation' || !activeShort || activeShort.status !== 'generating') return
    if (runningId.current === activeShort.id) return
    runningId.current = activeShort.id
    const controller = new AbortController()
    abortController.current = controller
    const taskId = activeShort.id
    void generateClipMock(activeShort.source, (update) => {
      setData((current) => ({
        ...current,
        history: current.history.map((item) => item.id === taskId
          ? { ...item, progress: update.progress, stage: update.stage }
          : item),
      }))
    }, controller.signal, activeShort.durationSeconds, data.resolution).then((result) => {
      setData((current) => ({
        ...current,
        activeShortId: taskId,
        screen: 'editor',
        history: current.history.map((item) => item.id === taskId
          ? { ...item, ...result, status: 'ready', progress: 100, stage: 'Terminé' }
          : item),
      }))
      setNotice('Votre aperçu de Short est prêt. L’export vidéo réel reste à connecter.')
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : 'Une erreur est survenue pendant la création.'
      setData((current) => ({
        ...current,
        screen: 'error',
        history: current.history.map((item) => item.id === taskId
          ? { ...item, status: 'failed', error: message }
          : item),
      }))
    }).finally(() => {
      if (runningId.current === taskId) runningId.current = null
      if (abortController.current === controller) abortController.current = null
    })
    return () => {
      controller.abort()
      if (runningId.current === taskId) runningId.current = null
    }
  }, [data.screen, data.activeShortId, activeShort?.status])

  const navigate = (screen: MainScreen) => {
    setNotice('')
    setData((current) => ({ ...current, screen }))
  }

  const updateActiveShort = (values: Partial<ShortItem>) => {
    if (!activeShort) return
    setData((current) => ({
      ...current,
      history: current.history.map((item) => item.id === activeShort.id ? { ...item, ...values } : item),
    }))
  }

  function startGeneration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    const sourceValue = fileName ? `Fichier : ${fileName}` : source.trim()
    if (data.tokens < SHORT_COST) {
      navigate('exhausted')
      return
    }
    if (!fileName) {
      try {
        const parsed = new URL(sourceValue)
        if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'].includes(parsed.hostname.toLowerCase())) {
          setNotice('Collez un lien public YouTube ou TikTok.')
          return
        }
      } catch {
        setNotice('Saisissez un lien public YouTube ou TikTok valide.')
        return
      }
    }
    const id = crypto.randomUUID()
    const short: ShortItem = {
      ...data.subtitleDefaults,
      id,
      title: fileName ? fileName.replace(/\.[^.]+$/, '') : 'Mon Short',
      source: sourceValue,
      createdAt: new Date().toISOString(),
      durationSeconds: data.duration,
      progress: 0,
      stage: 'Préparation de la vidéo',
      status: 'generating',
      enabled: data.subtitlesEnabled,
    }
    setData((current) => ({
      ...current,
      tokens: current.tokens - SHORT_COST,
      history: [short, ...current.history],
      activeShortId: id,
      screen: 'generation',
      sourceDraft: sourceValue,
    }))
    setFileName('')
  }

  function cancelGeneration() {
    abortController.current?.abort()
    runningId.current = null
    setData((current) => ({
      ...current,
      tokens: Math.min(current.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS, current.tokens + SHORT_COST),
      activeShortId: null,
      screen: 'create',
      history: current.history.map((item) => item.id === current.activeShortId
        ? { ...item, status: 'cancelled', stage: 'Annulé' }
        : item),
    }))
    setNotice('Création annulée. Les 3 jetons ont été recrédités.')
  }

  function retryFailedGeneration() {
    if (!activeShort) return
    const cap = data.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS
    const restoredBalance = Math.min(cap, data.tokens + SHORT_COST)
    if (restoredBalance < SHORT_COST) {
      setData((current) => ({ ...current, tokens: restoredBalance, screen: 'exhausted' }))
      return
    }
    const retry: ShortItem = {
      ...activeShort,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      progress: 0,
      stage: 'Préparation de la vidéo',
      status: 'generating',
      error: undefined,
    }
    setData((current) => ({
      ...current,
      tokens: restoredBalance - SHORT_COST,
      history: [retry, ...current.history.filter((item) => item.id !== activeShort.id)],
      activeShortId: retry.id,
      screen: 'generation',
    }))
    setNotice('')
  }

  function reedit(item: ShortItem) {
    setData((current) => ({ ...current, activeShortId: item.id, screen: item.status === 'generating' ? 'generation' : 'editor' }))
    setNotice('')
  }

  function duplicateShort() {
    if (!activeShort) return
    const copy: ShortItem = {
      ...activeShort,
      id: crypto.randomUUID(),
      title: `${activeShort.title} (copie)`,
      createdAt: new Date().toISOString(),
      status: 'ready',
    }
    setData((current) => ({ ...current, history: [copy, ...current.history], activeShortId: copy.id }))
    setNotice('Une copie du Short a été ajoutée à votre historique.')
  }

  async function shareShort() {
    if (!activeShort) return
    try {
      if (navigator.share) await navigator.share({ title: activeShort.title, text: 'Mon aperçu GemClip' })
      else {
        await navigator.clipboard.writeText(window.location.origin)
        setNotice('Lien de GemClip copié. L’URL vidéo sera disponible avec le backend.')
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setNotice('Le partage n’a pas pu être ouvert.')
    }
  }

  function exportMock() {
    // TODO: Connecter l’export MP4 réel et son téléchargement sécurisé.
    setNotice('Export MP4 simulé. TODO : connecter le rendu vidéo avant toute publication.')
  }

  function updateSubtitle<K extends keyof SubtitleSettings>(key: K, value: SubtitleSettings[K]) {
    if (activeShort) {
      const snapshot: SubtitleSettings = {
        style: activeShort.style,
        position: activeShort.position,
        size: activeShort.size,
        color: activeShort.color,
        animation: activeShort.animation,
        animationSpeed: activeShort.animationSpeed,
        font: activeShort.font,
        highlightedWords: activeShort.highlightedWords,
        automaticEmojis: activeShort.automaticEmojis,
        outline: activeShort.outline,
        hidePunctuation: activeShort.hidePunctuation,
        enabled: activeShort.enabled,
        text: activeShort.text,
      }
      setSettingsUndo((current) => [...current.slice(-19), snapshot])
      setSettingsRedo([])
    }
    if (key === 'enabled') setData((current) => ({ ...current, subtitlesEnabled: value as boolean }))
    updateActiveShort({ [key]: value } as Partial<ShortItem>)
  }

  function restoreSubtitleSettings(settings: SubtitleSettings) {
    if (!activeShort) return
    updateActiveShort(settings)
    setData((current) => ({ ...current, subtitlesEnabled: settings.enabled }))
  }

  function undoSubtitleSettings() {
    if (!activeShort || settingsUndo.length === 0) return
    const previous = settingsUndo[settingsUndo.length - 1]
    const current: SubtitleSettings = {
      style: activeShort.style,
      position: activeShort.position,
      size: activeShort.size,
      color: activeShort.color,
      animation: activeShort.animation,
      animationSpeed: activeShort.animationSpeed,
      font: activeShort.font,
      highlightedWords: activeShort.highlightedWords,
      automaticEmojis: activeShort.automaticEmojis,
      outline: activeShort.outline,
      hidePunctuation: activeShort.hidePunctuation,
      enabled: activeShort.enabled,
      text: activeShort.text,
    }
    setSettingsRedo((items) => [...items.slice(-19), current])
    setSettingsUndo((items) => items.slice(0, -1))
    restoreSubtitleSettings(previous)
  }

  function redoSubtitleSettings() {
    if (!activeShort || settingsRedo.length === 0) return
    const next = settingsRedo[settingsRedo.length - 1]
    const current: SubtitleSettings = {
      style: activeShort.style,
      position: activeShort.position,
      size: activeShort.size,
      color: activeShort.color,
      animation: activeShort.animation,
      animationSpeed: activeShort.animationSpeed,
      font: activeShort.font,
      highlightedWords: activeShort.highlightedWords,
      automaticEmojis: activeShort.automaticEmojis,
      outline: activeShort.outline,
      hidePunctuation: activeShort.hidePunctuation,
      enabled: activeShort.enabled,
      text: activeShort.text,
    }
    setSettingsUndo((items) => [...items.slice(-19), current])
    setSettingsRedo((items) => items.slice(0, -1))
    restoreSubtitleSettings(next)
  }

  async function upgradePlan() {
    setBusy(true)
    // TODO: Connecter le paiement réel avant d’activer GemClip Plus en production.
    setData((current) => ({ ...current, plan: 'plus', tokens: PLUS_TOKENS, lastResetDay: utcDay(), screen: 'create' }))
    setNotice('Mode prototype : le plan Plus est simulé, aucun paiement réel n’a été effectué.')
    setBusy(false)
  }

  async function logout() {
    setBusy(true)
    try {
      await signOut(getFirebaseAuth())
      window.location.assign('/login')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Impossible de fermer la session.')
    } finally {
      setBusy(false)
    }
  }

  const profileName = user.displayName || user.email?.split('@')[0] || 'Créateur GemClip'

  return (
    <main className="gc-app">
      <Header user={user} tokens={data.tokens} onNavigate={navigate} />
      <p className="gc-mobile-sim-note">Prototype : génération vidéo simulée, export MP4 non connecté.</p>
      {storageWarning && <div className="gc-storage-warning" role="status"><AlertCircle size={16} />{storageWarning}</div>}
      {notice && <div className="gc-notice" role="status"><CheckCircle2 size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Fermer">×</button></div>}

      {data.screen === 'create' && (
        <>
          <div className="gc-create-layout">
            <section className="gc-create-copy">
              <Chip><Sparkles size={14} /> Nouveau · Sous-titres animés</Chip>
              <h1>Une vidéo.<br /><span>Un Short.</span></h1>
              <p className="gc-lead">Collez un lien, l’IA choisit le meilleur extrait et ajoute les sous-titres.</p>
              <Card className="gc-create-card">
                <form onSubmit={startGeneration}>
                  <label className="gc-field-label" htmlFor="gc-source">Lien YouTube ou TikTok</label>
                  <div className="gc-source-input">
                    <input
                      id="gc-source"
                      type="url"
                      value={source}
                      placeholder="https://youtube.com/…"
                      onChange={(event) => setSource(event.target.value)}
                      disabled={Boolean(fileName)}
                    />
                    <Button variant="primary" type="submit" disabled={data.tokens < SHORT_COST}>
                      Créer · {SHORT_COST} jetons <ArrowRight size={16} />
                    </Button>
                  </div>
                  <label className="gc-file-picker">
                    <ImagePlus size={16} /> {fileName || 'Importer un fichier vidéo'}
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(event) => {
                        setFileName(event.target.files?.[0]?.name ?? '')
                        if (event.target.files?.[0]) setSource('')
                      }}
                    />
                  </label>
                  {fileName && <button className="gc-file-clear" type="button" onClick={() => setFileName('')}>Retirer le fichier</button>}
                  <p className="gc-helper">Lien public requis pour une vidéo hébergée en ligne. Fichier importé utilisé en simulation.</p>
                </form>
                <div className="gc-options">
                  <label className="gc-option">
                    <span>Durée</span>
                    <select value={data.duration} onChange={(event) => setData((current) => ({ ...current, duration: Number(event.target.value) }))}>
                      <option value={30}>30 s</option><option value={45}>45 s</option><option value={60}>60 s</option>
                    </select>
                  </label>
                  <label className="gc-option">
                    <span>Qualité</span>
                    <select value={data.resolution} onChange={(event) => setData((current) => ({ ...current, resolution: Number(event.target.value) as 720 | 1080 }))}>
                      <option value={720}>720p</option><option value={1080}>1080p</option>
                    </select>
                  </label>
                  <Toggle label="Sous-titres activés" checked={data.subtitlesEnabled} onChange={(value) => setData((current) => ({ ...current, subtitlesEnabled: value }))} />
                  <button className="gc-customize-link" type="button" onClick={() => setShowCustomize((value) => !value)} aria-expanded={showCustomize}>
                    <Settings2 size={15} /> Personnaliser
                  </button>
                </div>
                {showCustomize && (
                  <div className="gc-create-customizer">
                    <div className="gc-create-customizer-heading"><strong>Personnaliser les sous-titres</strong><Chip>9:16</Chip></div>
                    <EditorChoice
                      title="Style"
                      choices={['Gras', 'Sobre', 'Marqué']}
                      value={data.subtitleDefaults.style}
                      onChange={(value) => setData((current) => ({ ...current, subtitleDefaults: { ...current.subtitleDefaults, style: value as SubtitleStyle } }))}
                    />
                    <EditorChoice
                      title="Position"
                      choices={['Haut', 'Milieu', 'Bas']}
                      value={data.subtitleDefaults.position}
                      onChange={(value) => setData((current) => ({ ...current, subtitleDefaults: { ...current.subtitleDefaults, position: value as SubtitleSettings['position'] } }))}
                    />
                    <label className="gc-slider-label">Taille <span>{data.subtitleDefaults.size}px</span><input type="range" min="14" max="34" value={data.subtitleDefaults.size} onChange={(event) => setData((current) => ({ ...current, subtitleDefaults: { ...current.subtitleDefaults, size: Number(event.target.value) } }))} /></label>
                    <div className="gc-setting-group"><strong>Couleur d’accent</strong><div className="gc-color-list">{COLORS.map((color) => <button key={color} type="button" aria-label={`Couleur ${color}`} aria-pressed={data.subtitleDefaults.color === color} className={data.subtitleDefaults.color === color ? 'selected' : ''} style={{ backgroundColor: color }} onClick={() => setData((current) => ({ ...current, subtitleDefaults: { ...current.subtitleDefaults, color } }))} />)}</div></div>
                    <label className="gc-select-label">Animation<select value={data.subtitleDefaults.animation} onChange={(event) => setData((current) => ({ ...current, subtitleDefaults: { ...current.subtitleDefaults, animation: event.target.value as SubtitleAnimation } }))}>{['Aucune', 'Mot par mot', 'Pop', 'Karaoké', 'Machine à écrire', 'Glissé'].map((value) => <option key={value}>{value}</option>)}</select></label>
                    <label className="gc-select-label">Police<select value={data.subtitleDefaults.font} onChange={(event) => setData((current) => ({ ...current, subtitleDefaults: { ...current.subtitleDefaults, font: event.target.value as SubtitleSettings['font'] } }))}>{['Outfit', 'Montserrat', 'Anton', 'Poppins'].map((value) => <option key={value}>{value}</option>)}</select></label>
                  </div>
                )}
                {data.tokens < SHORT_COST && <button className="gc-inline-error" type="button" onClick={() => navigate('exhausted')}>Plus assez de jetons — voir les options</button>}
              </Card>
              <div className="gc-create-note"><Zap size={15} /> Un Short coûte {SHORT_COST} jetons. {FREE_TOKENS} jetons offerts dans le plan Gratuit.</div>
            </section>

            <section className="gc-create-preview">
              <div className="gc-preview-label"><span>Aperçu du rendu</span><Chip>9:16</Chip></div>
              <PhonePreview variant="empty" />
              <div className="gc-preview-actions">
                <Button disabled><Download size={16} /> Télécharger MP4</Button>
                <Button disabled><Share2 size={16} /> Partager</Button>
              </div>
              <p>Les actions d’export et de partage s’activent après la génération.</p>
            </section>
          </div>
          <section className="gc-platforms">
            <span>PRÊT À PUBLIER SUR</span>
            <strong>YouTube Shorts</strong><strong>TikTok</strong><strong>Instagram Reels</strong><strong>Facebook Reels</strong>
          </section>
          <section className="gc-features-section">
            <div className="gc-section-heading"><span>LE STUDIO SHORTS</span><h2>Tout ce qu’il faut,<br />rien de plus.</h2></div>
            <div className="gc-feature-grid">
              <Card><span className="gc-feature-icon"><Sparkles size={20} /></span><h3>Extrait choisi par l’IA</h3><p>Un passage intéressant détecté automatiquement dans votre vidéo.</p></Card>
              <Card><span className="gc-feature-icon"><Subtitles size={20} /></span><h3>Sous-titres animés</h3><p>Personnalisez le style, la couleur, la position et l’animation.</p></Card>
              <Card><span className="gc-feature-icon"><Download size={20} /></span><h3>Export MP4 1080p</h3><p>Un format vertical prêt à publier sur vos réseaux.</p></Card>
            </div>
          </section>
          <PricingPreview onChoose={() => navigate('pricing')} />
          <footer className="gc-footer">GemClip <span>·</span> Le format court, simplement.</footer>
        </>
      )}

      {data.screen === 'generation' && activeShort && (
        <section className="gc-generation">
          <Card className="gc-generation-card">
            <div className="gc-generation-heading">
              <span className="gc-icon-box"><LoaderCircle className="gc-spin" size={20} /></span>
              <div><h1>Création en cours…</h1><p>Gardez cette page ouverte. {SHORT_COST} jetons utilisés.</p></div>
              <strong>{activeShort.progress}%</strong>
            </div>
            <div className="gc-progress"><span style={{ width: `${activeShort.progress}%` }} /></div>
            <ol className="gc-step-list">
              {['Vidéo récupérée', 'Contenu analysé', 'L’IA choisit le meilleur extrait', 'Sous-titres animés', `Export MP4 ${data.resolution}p`].map((step, index) => {
                const currentIndex = activeShort.progress === 100 ? 5 : Math.floor(activeShort.progress / 20)
                const done = index < currentIndex
                const current = !done && index === currentIndex
                return <li key={step} className={done ? 'done' : current ? 'current' : ''}>
                  <span>{done ? <Check size={14} /> : current ? <span className="gc-step-dot" /> : index + 1}</span>{step}
                </li>
              })}
            </ol>
            <p className="gc-stage-note">{activeShort.stage}</p>
            <Button onClick={cancelGeneration}>Annuler la création</Button>
          </Card>
          <div className="gc-generation-preview"><PhonePreview variant="generating" /><p>Aperçu vertical · 9:16</p></div>
        </section>
      )}

      {data.screen === 'editor' && (
        activeShort ? (
          <section className="gc-editor">
            <header className="gc-editor-topbar">
              <Button onClick={() => navigate('create')}><ArrowLeft size={16} /> Retour</Button>
              <div className="gc-editor-name"><strong>{activeShort.title || 'Mon Short'}</strong><span>Brouillon · enregistré</span></div>
              <TokenPill tokens={data.tokens} />
              <div className="gc-undo-actions"><Button aria-label="Annuler le dernier réglage" onClick={undoSubtitleSettings} disabled={settingsUndo.length === 0}><Undo2 size={17} /></Button><Button aria-label="Rétablir le réglage" onClick={redoSubtitleSettings} disabled={settingsRedo.length === 0}><Redo2 size={17} /></Button></div>
              <Button variant="primary" onClick={exportMock}><Download size={16} /> Exporter MP4 <Chip>{SHORT_COST} jetons</Chip></Button>
            </header>
            <div className="gc-editor-main">
              <nav className="gc-tool-rail" aria-label="Outils de montage">
                {TOOLS.map(({ name, icon: Icon }) => (
                  <button key={name} type="button" className={editorTool === name ? 'active' : ''} onClick={() => {
                    setEditorTool(name)
                    if (name === 'Historique') navigate('history')
                  }}>
                    <Icon size={18} strokeWidth={2} /><span>{name}</span>
                  </button>
                ))}
              </nav>
              <section className="gc-editor-canvas">
                <div className="gc-canvas-toolbar"><span>Aperçu du Short <Chip>9:16</Chip></span><button type="button" onClick={() => setNotice('Lecture de l’aperçu simulée.') } aria-label="Lire l’aperçu"><Play size={17} fill="currentColor" /></button></div>
                <PhonePreview caption={activeShort.text} settings={activeShort} subtitle={activeShort.enabled} />
                <div className="gc-player-controls">
                  <button type="button" onClick={() => setPlayhead((time) => time >= activeShort.durationSeconds ? 0 : time + 1)} aria-label="Lire la vidéo"><Play size={15} fill="currentColor" /></button>
                  <span>00:{String(playhead).padStart(2, '0')} / 00:{String(activeShort.durationSeconds).padStart(2, '0')}</span>
                  <Chip>Export : {SHORT_COST} jetons</Chip>
                  <button type="button" onClick={() => void shareShort()} aria-label="Partager l’aperçu"><Share2 size={15} /></button>
                </div>
              </section>
              <aside className="gc-editor-panel">
                {editorTool === 'Sous-titres' ? (
                  <>
                    <div className="gc-panel-heading"><div><span>PERSONNALISATION</span><h2>Sous-titres</h2></div><button type="button" aria-label="Options de sous-titres"><MoreHorizontal size={20} /></button></div>
                    <Toggle label="Sous-titres activés" checked={activeShort.enabled} onChange={(value) => updateSubtitle('enabled', value)} />
                    <EditorChoice title="Style" choices={['Gras', 'Sobre', 'Marqué']} value={activeShort.style} onChange={(value) => updateSubtitle('style', value as SubtitleStyle)} />
                    <EditorChoice title="Position" choices={['Haut', 'Milieu', 'Bas']} value={activeShort.position} onChange={(value) => updateSubtitle('position', value as SubtitleSettings['position'])} />
                    <label className="gc-slider-label">Taille <span>{activeShort.size}px</span><input type="range" min="14" max="34" value={activeShort.size} onChange={(event) => updateSubtitle('size', Number(event.target.value))} /></label>
                    <div className="gc-setting-group"><strong>Couleur d’accent</strong><div className="gc-color-list">{COLORS.map((color) => <button key={color} type="button" aria-label={`Couleur ${color}`} aria-pressed={activeShort.color === color} className={activeShort.color === color ? 'selected' : ''} style={{ backgroundColor: color }} onClick={() => updateSubtitle('color', color)} />)}</div></div>
                    <label className="gc-select-label">Animation<select value={activeShort.animation} onChange={(event) => updateSubtitle('animation', event.target.value as SubtitleAnimation)}>{['Aucune', 'Mot par mot', 'Pop', 'Karaoké', 'Machine à écrire', 'Glissé'].map((value) => <option key={value}>{value}</option>)}</select></label>
                    <label className="gc-slider-label">Vitesse de l’animation <span>{activeShort.animationSpeed.toFixed(1)}×</span><input type="range" min="0.5" max="2" step="0.1" value={activeShort.animationSpeed} onChange={(event) => updateSubtitle('animationSpeed', Number(event.target.value))} /></label>
                    <label className="gc-select-label">Police<select value={activeShort.font} onChange={(event) => updateSubtitle('font', event.target.value as SubtitleSettings['font'])}>{['Outfit', 'Montserrat', 'Anton', 'Poppins'].map((value) => <option key={value}>{value}</option>)}</select></label>
                    <Toggle label="Mots clés surlignés" badge="IA" checked={activeShort.highlightedWords} onChange={(value) => updateSubtitle('highlightedWords', value)} />
                    <Toggle label="Emojis automatiques" badge="IA" checked={activeShort.automaticEmojis} onChange={(value) => updateSubtitle('automaticEmojis', value)} />
                    <Toggle label="Contour et ombre" checked={activeShort.outline} onChange={(value) => updateSubtitle('outline', value)} />
                    <Toggle label="Masquer la ponctuation" checked={activeShort.hidePunctuation} onChange={(value) => updateSubtitle('hidePunctuation', value)} />
                    <div className="gc-panel-buttons"><Button onClick={() => setNotice('Traduction simulée. TODO : connecter le service de traduction.')}>Traduire</Button><Button onClick={() => {
                      const editedText = window.prompt('Modifier le texte des sous-titres', activeShort.text)
                      if (editedText !== null) updateSubtitle('text', editedText)
                    }}>Modifier le texte</Button></div>
                  </>
                ) : editorTool === 'Extrait' ? (
                  <div className="gc-tool-placeholder"><Scissors size={21} /><h2>Extrait</h2><p>Durée de l’extrait : {activeShort.durationSeconds} secondes.</p><Button onClick={() => updateActiveShort({ durationSeconds: activeShort.durationSeconds === 45 ? 30 : 45 })}>Changer la durée</Button></div>
                ) : editorTool === 'Format' ? (
                  <div className="gc-tool-placeholder"><Smartphone size={21} /><h2>Format</h2><p>Format vertical 9:16 · Export {data.resolution}p</p><Chip active>9:16</Chip></div>
                ) : (
                  <div className="gc-tool-placeholder"><WandSparkles size={21} /><h2>{editorTool}</h2><p>Outil de démonstration du prototype. TODO : connecter cette fonction à l’éditeur vidéo.</p></div>
                )}
              </aside>
            </div>
            <section className="gc-timeline">
              <div className="gc-timeline-actions">
                <Button onClick={() => updateActiveShort({ durationSeconds: Math.max(15, activeShort.durationSeconds - 5) })}><Scissors size={15} /> Couper</Button>
                <Button onClick={duplicateShort}><Copy size={15} /> Dupliquer</Button>
                <label className="gc-speed-control">Vitesse <select aria-label="Vitesse de lecture"><option>1×</option><option>1,25×</option><option>1,5×</option><option>2×</option></select></label>
                <Button onClick={() => setNotice('Nouvel extrait IA simulé. TODO : connecter l’analyse vidéo.') }><Sparkles size={15} /> Nouvel extrait IA</Button>
                <span className="gc-zoom-actions"><button type="button" aria-label="Zoom arrière" onClick={() => setZoom((value) => Math.max(.7, value - .1))}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom avant" onClick={() => setZoom((value) => Math.min(1.5, value + .1))}><Plus size={15} /></button></span>
              </div>
              <div className="gc-time-ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span></div>
              <div className="gc-track-row"><span>Vidéo</span><div className="gc-video-track"><span style={{ width: `${Math.min(100, (activeShort.durationSeconds / 60) * 100)}%` }} /></div></div>
              <div className="gc-track-row"><span>Sous-titres</span><div className="gc-caption-track">
                {[...activeShort.text.split('\n').filter(Boolean), 'quand on ose', 'commencer'].slice(0, 4).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
                <button type="button" onClick={() => updateSubtitle('text', `${activeShort.text}\ncommencer`)}>+ Ajouter</button>
              </div></div>
              <div className="gc-track-row"><span>Musique</span><button className="gc-music-track" type="button" onClick={() => setMusicAdded((value) => !value)}><Music2 size={15} /> {musicAdded ? 'Musique libre de droits ajoutée · cliquer pour retirer' : 'Ajouter une musique libre de droits'} <Plus size={14} /></button></div>
            </section>
            <div className="gc-export-footer"><span>Export MP4 · {SHORT_COST} jetons</span><Button variant="primary" onClick={exportMock}><Download size={16} /> Exporter MP4</Button></div>
          </section>
        ) : <EmptyState title="Aucun Short à modifier" action="Créer un Short" onAction={() => navigate('create')} />
      )}

      {data.screen === 'history' && (
        <section className="gc-page-section">
          <div className="gc-page-heading"><div><Chip><History size={14} /> VOTRE STUDIO</Chip><h1>Historique</h1><p>Retrouvez et rééditez vos Shorts. Vos créations sont enregistrées sur cet appareil.</p></div><TokenPill tokens={data.tokens} /></div>
          {data.history.length ? (
            <div className="gc-history-grid">
              {data.history.filter((item) => item.status === 'ready' || item.status === 'generating').map((item) => <ShortTile key={item.id} item={item} active={item.id === data.activeShortId} onEdit={() => reedit(item)} />)}
              <button className="gc-new-short-tile" type="button" onClick={() => navigate('create')}><Plus size={21} />Nouveau Short</button>
            </div>
          ) : <EmptyState title="Votre historique est vide" description="Créez votre premier Short pour le retrouver ici." action="Créer mon premier Short" onAction={() => navigate('create')} />}
        </section>
      )}

      {data.screen === 'account' && (
        <section className="gc-page-section gc-account-page">
          <div className="gc-page-heading"><div><Chip>COMPTE</Chip><h1>Votre espace GemClip</h1><p>Profil et préférences de votre studio.</p></div><TokenPill tokens={data.tokens} /></div>
          <Card className="gc-account-card">
            <div className="gc-account-avatar">{user.photoURL ? <img src={user.photoURL} alt="" /> : profileName.slice(0, 1).toUpperCase()}</div>
            <div><h2>{profileName}</h2><p>{user.email}</p></div>
          </Card>
          <Card className="gc-account-card gc-account-plan"><div><span>Votre offre</span><h2>{data.plan === 'plus' ? 'GemClip Plus' : 'Gratuit'}</h2><p>{data.tokens} jetons disponibles sur 100</p></div><Button onClick={() => navigate('pricing')}>Voir les offres</Button></Card>
          <Button onClick={() => void logout()} disabled={busy}><LogOut size={16} /> Se déconnecter</Button>
        </section>
      )}

      {data.screen === 'pricing' && (
        <section className="gc-pricing-page">
          <div className="gc-pricing-hero"><Chip><Zap size={14} /> GEMCLIP PLUS</Chip><h1>Publiez tous les jours.<br /><span>Sans compter.</span></h1><p>100 jetons par jour, soit jusqu’à 33 Shorts quotidiens, pour le prix d’un café.</p></div>
          <div className="gc-plan-grid">
            <Card className="gc-plan-card"><span className="gc-plan-name">Gratuit</span><strong className="gc-plan-price">0 $</strong><p>[X] jetons pour essayer</p><ul><li><Check size={16} /> Extrait choisi par l’IA</li><li><Check size={16} /> Sous-titres de base</li><li><Check size={16} /> Export MP4</li></ul><Button onClick={() => navigate('create')}>Continuer gratuitement</Button></Card>
            <Card className="gc-plan-card gc-plan-plus"><Chip active>Recommandé</Chip><span className="gc-plan-name">Plus</span><strong className="gc-plan-price">4,99 $ <small>/ mois</small></strong><p>100 jetons chaque jour · jusqu’à 33 Shorts</p><ul><li><Check size={16} /> Toutes les animations</li><li><Check size={16} /> Mots clés et emojis par l’IA</li><li><Check size={16} /> Traduction et export 1080p</li><li><Check size={16} /> Jusqu’à 33 Shorts par jour</li></ul><Button variant="primary" onClick={() => void upgradePlan()} disabled={busy}>Passer à Plus · 4,99 $/mois</Button><small className="gc-payment-note">Paiement sécurisé · simulation, aucun débit réel</small></Card>
          </div>
          <section className="gc-unlocks"><h2>Ce que vous débloquez.</h2><div><Card><strong>100</strong><span>jetons par jour</span></Card><Card><strong>6</strong><span>animations de sous-titres</span></Card><Card><strong>1080p</strong><span>qualité d’export</span></Card></div></section>
          <section className="gc-faq"><h2>Questions fréquentes</h2><details><summary>Qu’est-ce qu’un jeton ? <ChevronDown size={17} /></summary><p>Chaque création d’un Short consomme 3 jetons.</p></details><details><summary>Comment annuler mon abonnement ? <ChevronDown size={17} /></summary><p>[À CONFIRMER : modalités d’annulation]</p></details><details><summary>Quels moyens de paiement sont acceptés ? <ChevronDown size={17} /></summary><p>[À CONFIRMER : moyens de paiement]</p></details></section>
          <section className="gc-final-banner"><h2>Votre prochain Short vous attend.</h2><Button variant="primary" onClick={() => navigate('create')}>Créer un Short <ArrowRight size={16} /></Button></section>
        </section>
      )}
      {data.screen === 'pricing' && (
        <div className="gc-pricing-sticky">
          <span>GemClip Plus · 4,99 $ / mois</span>
          <Button variant="primary" onClick={() => void upgradePlan()}>Passer à Plus · 4,99 $/mois</Button>
        </div>
      )}

      {data.screen === 'exhausted' && (
        <section className="gc-state-page">
          <Card className="gc-exhausted-card"><span className="gc-icon-box"><Zap size={21} /></span><Chip active>QUOTA QUOTIDIEN</Chip><h1>Plus de jetons aujourd’hui.</h1><p>Vos jetons reviennent à <strong>[HEURE DE RECHARGE À CONFIRMER]</strong>. Avec Plus, créez jusqu’à 33 Shorts par jour.</p><TokenPill tokens={data.tokens} /><Button variant="primary" onClick={() => navigate('pricing')}>Passer à Plus · 4,99 $/mois <ArrowRight size={16} /></Button><Button onClick={() => navigate('create')}>Attendre la recharge</Button></Card>
        </section>
      )}

      {data.screen === 'error' && (
        <section className="gc-state-page">
          <Card className="gc-error-card"><span className="gc-error-icon"><AlertCircle size={22} /></span><h1>Impossible de lire cette vidéo.</h1><p>Vérifiez que le lien est public, puis réessayez.</p><div className="gc-error-detail"><strong>Détail :</strong> {activeShort?.error || 'réponse invalide du serveur (Not Found).'}</div><div><Button variant="primary" onClick={retryFailedGeneration}>Réessayer</Button><Button onClick={() => {
            setData((current) => ({
              ...current,
              tokens: Math.min(current.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS, current.tokens + SHORT_COST),
              history: current.history.filter((item) => item.id !== current.activeShortId),
              activeShortId: null,
              sourceDraft: '',
              screen: 'create',
            }))
            setSource('')
          }}>Changer de lien</Button></div></Card>
        </section>
      )}

      <BottomNavigation screen={data.screen} onNavigate={navigate} />
    </main>
  )
}

function EditorChoice({ title, choices, value, onChange }: { title: string; choices: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset className="gc-choice-field"><legend>{title}</legend><div>{choices.map((choice) => <button key={choice} type="button" className={choice === value ? 'selected' : ''} aria-pressed={choice === value} onClick={() => onChange(choice)}>{choice}</button>)}</div></fieldset>
}

function PricingPreview({ onChoose }: { onChoose: () => void }) {
  return (
    <section className="gc-pricing-preview">
      <div><span>POUR COMMENCER</span><h2>Commencez gratuitement.</h2></div>
      <div className="gc-plan-preview-grid">
        <Card><span>Gratuit</span><strong>{FREE_TOKENS} jetons / jour</strong><p>Pour essayer GemClip et créer vos premiers Shorts.</p><button type="button" onClick={onChoose}>Voir les offres</button></Card>
        <Card className="gc-plan-preview-plus"><Chip active>Plus</Chip><strong>100 jetons / jour</strong><p>Jusqu’à 33 Shorts par jour · 4,99 $ / mois.</p><button type="button" onClick={onChoose}>Découvrir Plus <ArrowRight size={15} /></button></Card>
      </div>
    </section>
  )
}

function EmptyState({ title, description, action, onAction }: { title: string; description?: string; action: string; onAction: () => void }) {
  return <Card className="gc-empty-state"><span className="gc-feature-icon"><Film size={21} /></span><h2>{title}</h2>{description && <p>{description}</p>}<Button variant="primary" onClick={onAction}>{action}</Button></Card>
}

export default StudioApp

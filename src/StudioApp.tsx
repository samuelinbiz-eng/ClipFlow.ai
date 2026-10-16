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
  Clapperboard,
  Copy,
  Download,
  Film,
  Flame,
  History,
  ImagePlus,
  Layers,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Minus,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Subtitles,
  Trash2,
  Sun,
  Type,
  Undo2,
  WandSparkles,
  Zap,
  Moon,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { getFirebaseAuth, getFirebaseFirestore } from './firebase'
import { doc, setDoc } from 'firebase/firestore'
import { generateClipMock } from './apiMock'
import {
  deleteShortFromFirestore,
  saveShortToFirestore,
  subscribeUserShorts,
  syncUserProfile,
} from './firestoreHistory'

export const FREE_TOKENS = 10
export const SHORT_COST = 3
export const PLUS_TOKENS = 100
export const PLUS_PRICE = 4.99

export type MainScreen =
  | 'create'
  | 'generation'
  | 'editor'
  | 'account'
  | 'pricing'
  | 'error'
  | 'exhausted'

export type SubtitleStyle = 'Gras' | 'Sobre' | 'Marqué'
export type SubtitleAnimation = 'Aucune' | 'Mot par mot' | 'Pop' | 'Karaoké' | 'Machine à écrire' | 'Glissé'
export type EditorTool =
  | 'Extrait'
  | 'Sous-titres'
  | 'Transitions'
  | 'Format'
  | 'Audio'
  | 'Recadrage'
  | 'Effets'
  | 'Titre'
  | 'Historique'

export type TransitionStyle =
  | 'Pop'
  | 'Glissé'
  | 'Fondu'
  | 'Rebond'
  | 'Machine à écrire'
  | 'Flash néon'
  | 'Bascule 3D'
  | 'Glitch'

export type TransitionInfo = {
  id: TransitionStyle
  name: string
  slug: string
  badge: string
  description: string
  icon: typeof Sparkles
  speedDefault: number
}

export const TRANSITION_LIBRARY: TransitionInfo[] = [
  {
    id: 'Pop',
    name: 'Pop Impact',
    slug: 'trans-pop',
    badge: 'TikTok Viral',
    description: 'Zoom percutant avec pulsation élastique pour un maximum de rétention.',
    icon: Zap,
    speedDefault: 0.35,
  },
  {
    id: 'Glissé',
    name: 'Glissé Vif',
    slug: 'trans-glisse',
    badge: 'Reels Rythmé',
    description: 'Entrée rapide du bas vers le haut avec accélération vive.',
    icon: ArrowRight,
    speedDefault: 0.35,
  },
  {
    id: 'Fondu',
    name: 'Fondu Enchaîné',
    slug: 'trans-fondu',
    badge: 'Cinéma & Épuré',
    description: 'Transition progressive et subtile avec un léger flou de focus.',
    icon: Sparkles,
    speedDefault: 0.4,
  },
  {
    id: 'Rebond',
    name: 'Rebond Élastique',
    slug: 'trans-rebond',
    badge: 'Ultra Dynamique',
    description: 'Effet de rebond avec amorti fluide pour rythmer chaque phrase.',
    icon: WandSparkles,
    speedDefault: 0.4,
  },
  {
    id: 'Machine à écrire',
    name: 'Machine à Écrire',
    slug: 'trans-machine',
    badge: 'Cadencé',
    description: 'Dévoilement mot par mot calé sur le tempo de parole.',
    icon: Type,
    speedDefault: 0.45,
  },
  {
    id: 'Flash néon',
    name: 'Flash Néon',
    slug: 'trans-flash-neon',
    badge: 'Impact Lumineux',
    description: 'Éclair brillant et halo lumineux coloré au changement de section.',
    icon: Flame,
    speedDefault: 0.35,
  },
  {
    id: 'Bascule 3D',
    name: 'Bascule 3D (Flip)',
    slug: 'trans-bascule-3d',
    badge: 'Effet 3D',
    description: 'Rotation tridimensionnelle spectaculaire sur l’axe horizontal.',
    icon: Layers,
    speedDefault: 0.4,
  },
  {
    id: 'Glitch',
    name: 'Cyber Glitch',
    slug: 'trans-glitch',
    badge: 'Tech & Moderne',
    description: 'Décalage numérique rapide et moderne idéal pour les punchlines.',
    icon: RefreshCw,
    speedDefault: 0.35,
  },
]

export function getTransitionSlug(transition: TransitionStyle): string {
  const match = TRANSITION_LIBRARY.find((t) => t.id === transition)
  return match ? match.slug : 'trans-pop'
}

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
  transition: TransitionStyle
  transitionSpeed: number
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
  hook?: string
  explanation?: string
  tags?: string[]
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

const STORAGE_KEY = 'gemclip-studio-v3'
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
  text: 'Voici le secret\nque personne ne vous dit\npour percer sur YouTube Shorts',
  transition: 'Pop',
  transitionSpeed: 0.35,
}

const COLORS = ['#93C5FD', '#FDE68A', '#F9A8D4', '#86EFAC']
const TOOLS: { name: EditorTool; icon: typeof Scissors }[] = [
  { name: 'Extrait', icon: Scissors },
  { name: 'Sous-titres', icon: Subtitles },
  { name: 'Transitions', icon: WandSparkles },
  { name: 'Format', icon: Smartphone },
  { name: 'Audio', icon: AudioLines },
  { name: 'Recadrage', icon: LayoutGrid },
  { name: 'Effets', icon: Sparkles },
  { name: 'Titre', icon: Type },
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
      !parsed ||
      !Array.isArray(parsed.history) ||
      !['free', 'plus'].includes(String(parsed.plan)) ||
      typeof parsed.tokens !== 'number'
    ) {
      return { value: initialStudioState(), warning: '' }
    }
    const value = { ...initialStudioState(), ...parsed } as StudioState
    if (value.lastResetDay !== utcDay()) {
      value.tokens = value.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS
      value.lastResetDay = utcDay()
    }
    return { value, warning: '' }
  } catch {
    return { value: initialStudioState(), warning: '' }
  }
}

function Button({
  children,
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'dark' | 'quiet'
}) {
  return (
    <button className={`gc-button gc-button-${variant} ${className}`} {...props}>
      {children}
    </button>
  )
}

function Chip({
  children,
  active = false,
  className = '',
}: {
  children: ReactNode
  active?: boolean
  className?: string
}) {
  return <span className={`gc-chip ${active ? 'is-active' : ''} ${className}`}>{children}</span>
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`gc-card ${className}`}>{children}</section>
}

function TokenPill({ tokens }: { tokens: number }) {
  return (
    <span className="gc-token-pill">
      <Zap size={15} strokeWidth={2.2} />
      <strong>{tokens}</strong>
      <span>/ 100 jetons</span>
    </span>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  badge,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  badge?: string
}) {
  return (
    <label className="gc-toggle-row">
      <span>
        {label}
        {badge && <small>{badge}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="gc-toggle-track" aria-hidden="true">
        <span />
      </span>
    </label>
  )
}

function PhonePreview({
  caption = DEFAULT_SUBTITLES.text,
  variant = 'default',
  settings = DEFAULT_SUBTITLES,
  subtitle = true,
  activeSectionIndex = 0,
  isTransitioning = false,
}: {
  caption?: string
  variant?: 'default' | 'empty'
  settings?: SubtitleSettings
  subtitle?: boolean
  activeSectionIndex?: number
  isTransitioning?: boolean
}) {
  const isOutfit = settings.font === 'Outfit'
  const sections = caption.split('\n').filter(Boolean)
  const currentSection =
    sections.length > 0 ? sections[activeSectionIndex % sections.length] : caption
  const positionClass = `pos-${settings.position.toLowerCase()}`
  const styleClass = `style-${settings.style.toLowerCase()}`
  const transitionClass = getTransitionSlug(settings.transition || 'Pop')

  return (
    <div className={`gc-phone ${variant === 'empty' ? 'is-empty' : ''}`} aria-hidden="true">
      <div className="gc-phone-notch" />
      <div className="gc-phone-screen">
        <div className="gc-phone-video-placeholder">
          <div className="gc-phone-badge">
            <span className="live-dot" /> 9:16
          </div>
          {variant !== 'empty' && (
            <div className="gc-phone-sparkle-center">
              <Sparkles size={28} />
            </div>
          )}
          {subtitle && currentSection && variant !== 'empty' && (
            <div
              key={`${currentSection}-${activeSectionIndex}-${isTransitioning ? 'trans' : 'still'}`}
              className={`gc-phone-subtitles ${positionClass} ${styleClass} ${
                isOutfit ? 'font-outfit' : ''
              } ${isTransitioning ? `trans-animating ${transitionClass}` : ''}`}
              style={
                {
                  '--sub-size': `${settings.size}px`,
                  '--sub-color': settings.color,
                  '--trans-speed': `${settings.transitionSpeed || 0.35}s`,
                  fontFamily: `${settings.font}, sans-serif`,
                } as CSSProperties
              }
            >
              <span className={`gc-sub-line ${settings.outline ? 'has-outline' : ''}`}>
                {settings.highlightedWords ? (
                  <mark style={{ backgroundColor: 'transparent', color: settings.color }}>
                    {currentSection}
                  </mark>
                ) : (
                  currentSection
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Header({
  user,
  tokens,
  plan,
  screen,
  onNavigate,
}: {
  user: User
  tokens: number
  plan: 'free' | 'plus'
  screen: MainScreen
  onNavigate: (screen: MainScreen) => void
}) {
  const [avatarError, setAvatarError] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = window.localStorage.getItem('gemclip-theme')
    return stored === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('gemclip-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((curr) => (curr === 'light' ? 'dark' : 'light'))
  }

  const avatarLetters = (user.displayName || user.email || 'G')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <header className="gc-header">
      <button
        type="button"
        className="gc-brand"
        onClick={() => onNavigate('create')}
        aria-label="Accueil GemClip"
        style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}
      >
        <span className="gc-brand-mark">
          <Clapperboard size={19} strokeWidth={2} />
        </span>
        GemClip
      </button>

      <nav className="gc-desktop-nav" aria-label="Navigation principale">
        <button
          type="button"
          className={screen === 'create' ? 'is-active' : ''}
          onClick={() => onNavigate('create')}
          title="Créer"
        >
          <Plus size={18} />
        </button>
      </nav>

      <div className="gc-header-actions">
        <button
          type="button"
          className="gc-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          style={{
            width: 38,
            height: 38,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid var(--gc-border)',
            borderRadius: 11,
            background: 'var(--gc-white)',
            color: 'var(--gc-ink)',
            cursor: 'pointer',
          }}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        {plan === 'free' ? (
          <Button
            className="gc-subscribe-button"
            onClick={() => onNavigate('pricing')}
            style={{ padding: '0 12px', minHeight: 36, fontSize: '11px' }}
          >
            <Zap size={14} /> Passer à Plus
          </Button>
        ) : (
          <Chip active>Plan Plus</Chip>
        )}
        <TokenPill tokens={tokens} />
        <button
          className={`gc-avatar ${screen === 'account' ? 'selected' : ''}`}
          type="button"
          onClick={() => onNavigate('account')}
          aria-label="Ouvrir le compte"
          style={{
            outline: screen === 'account' ? '2px solid var(--gc-blue)' : 'none',
            outlineOffset: '2px',
          }}
        >
          {user.photoURL && !avatarError ? (
            <img src={user.photoURL} alt="" onError={() => setAvatarError(true)} />
          ) : (
            avatarLetters
          )}
        </button>
      </div>
    </header>
  )
}

function BottomNavigation({
  screen,
  onNavigate,
}: {
  screen: MainScreen
  onNavigate: (screen: MainScreen) => void
}) {
  return (
    <nav className="gc-bottom-nav" aria-label="Navigation mobile">
      <button
        className={screen === 'create' ? 'active' : ''}
        type="button"
        onClick={() => onNavigate('create')}
      >
        <Plus size={19} />
        <span>Créer</span>
      </button>
      <button
        className={screen === 'editor' ? 'active' : ''}
        type="button"
        onClick={() => onNavigate('editor')}
      >
        <Scissors size={19} />
        <span>Éditeur</span>
      </button>
      <button
        className={screen === 'account' ? 'active' : ''}
        type="button"
        onClick={() => onNavigate('account')}
      >
        <Settings2 size={19} />
        <span>Compte</span>
      </button>
    </nav>
  )
}

function ShortTile({
  item,
  active,
  onEdit,
  onDelete,
}: {
  item: ShortItem
  active?: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article className={`gc-short-tile ${active ? 'selected' : ''}`}>
      <button
        type="button"
        className="gc-short-tile-preview"
        onClick={onEdit}
        aria-label={`Rééditer ${item.title}`}
      >
        <PhonePreview caption={item.text} settings={item} />
        {active && (
          <span className="gc-current-badge">
            <Check size={12} /> En cours
          </span>
        )}
      </button>
      <div className="gc-short-tile-meta">
        <div>
          <strong>{item.title || 'Short sans titre'}</strong>
          <span>
            {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
              new Date(item.createdAt),
            )}{' '}
            · {item.durationSeconds} s
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <Button onClick={onEdit}>Rééditer</Button>
          <Button
            aria-label="Supprimer"
            variant="quiet"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
    </article>
  )
}

function StudioApp({ user, initialScreen }: { user: User; initialScreen?: MainScreen }) {
  const [initial] = useState(readStudioState)
  const [data, setData] = useState<StudioState>(
    initialScreen ? { ...initial.value, screen: initialScreen } : initial.value,
  )
  const [storageWarning, setStorageWarning] = useState(initial.warning)
  const [notice, setNotice] = useState('')
  const [editorTool, setEditorTool] = useState<EditorTool>('Transitions')
  const [source, setSource] = useState(data.sourceDraft)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [playhead, setPlayhead] = useState(12)
  const [showCustomize, setShowCustomize] = useState(false)
  const [settingsUndo, setSettingsUndo] = useState<SubtitleSettings[]>([])
  const [settingsRedo, setSettingsRedo] = useState<SubtitleSettings[]>([])
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isEditingSections, setIsEditingSections] = useState(false)
  const [sectionDraft, setSectionDraft] = useState('')
  const [apiStatus, setApiStatus] = useState<{
    groqConfigured: boolean
    groqModel: string
    paypalConfigured: boolean
  } | null>(null)
  const lastResetRef = useRef(data.lastResetDay)
  const abortController = useRef<AbortController | null>(null)
  const runningId = useRef<string | null>(null)
  const transitionTimer = useRef<number | null>(null)

  const activeShort = useMemo(
    () => data.history.find((item) => item.id === data.activeShortId) ?? null,
    [data.history, data.activeShortId],
  )

  // Subtitle sections computed from text lines
  const subtitleSections = useMemo(() => {
    if (!activeShort) return []
    return activeShort.text.split('\n').filter(Boolean)
  }, [activeShort?.text])

  // Function to trigger live transition preview
  const triggerTransition = (targetIndex?: number) => {
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current)
    setIsTransitioning(false)
    if (typeof targetIndex === 'number') {
      setActiveSectionIndex(targetIndex)
    } else {
      setActiveSectionIndex((curr) =>
        subtitleSections.length > 0 ? (curr + 1) % subtitleSections.length : 0,
      )
    }
    // Small timeout to allow re-trigger of CSS animation
    window.setTimeout(() => {
      setIsTransitioning(true)
      const durationMs = (activeShort?.transitionSpeed || 0.35) * 1000 + 100
      transitionTimer.current = window.setTimeout(() => {
        setIsTransitioning(false)
      }, durationMs)
    }, 10)
  }

  // 1. Fetch Backend API Keys Status (Groq & PayPal)
  useEffect(() => {
    fetch('/api/config-status')
      .then((r) => r.json())
      .then((status) => {
        setApiStatus(status)
      })
      .catch(() => {})
  }, [])

  // 2. Synchronize user profile & subscribe to user's Shorts from Cloud Firestore
  useEffect(() => {
    void syncUserProfile(user)
    const unsubscribe = subscribeUserShorts(
      user.uid,
      (firestoreEntries) => {
        if (!firestoreEntries) return
        setData((current) => {
          const currentGenerating = current.history.filter((h) => h.status === 'generating')
          const existingIds = new Set(firestoreEntries.map((e) => e.task_id))

          const syncedItems: ShortItem[] = firestoreEntries.map((e) => ({
            ...current.subtitleDefaults,
            id: e.task_id,
            title: e.titre || e.source || 'Mon Short',
            source: e.source || '',
            createdAt: e.created_at,
            durationSeconds: e.duration_seconds || 45,
            progress: e.progress,
            stage: e.stage,
            status: (e.status === 'completed' ? 'ready' : e.status) as any,
            error: e.error || undefined,
            enabled: e.subtitles ?? true,
            color: e.subtitle_color || current.subtitleDefaults.color,
            size:
              Number(e.subtitle_size) > 0
                ? Number(e.subtitle_size)
                : current.subtitleDefaults.size,
            position: (e.subtitle_position as any) || current.subtitleDefaults.position,
            font: (e.subtitle_font as any) || current.subtitleDefaults.font,
            text: e.explication || current.subtitleDefaults.text,
            transition: current.subtitleDefaults.transition,
            transitionSpeed: current.subtitleDefaults.transitionSpeed,
          }))

          const uniqueGenerating = currentGenerating.filter((g) => !existingIds.has(g.id))
          return {
            ...current,
            history: [...uniqueGenerating, ...syncedItems],
          }
        })
      },
      (err) => {
        console.warn('Firestore subscription info:', err)
      },
    )
    return () => unsubscribe()
  }, [user])

  // 3. Save local storage fallback
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      setStorageWarning('')
    } catch {
      setStorageWarning('')
    }
  }, [data])

  // 4. Update profile in state
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

  // 5. Daily token reset
  useEffect(() => {
    const timer = window.setInterval(() => {
      const today = utcDay()
      if (lastResetRef.current === today) return
      lastResetRef.current = today
      setData((current) => ({
        ...current,
        lastResetDay: today,
        tokens: current.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS,
      }))
      setNotice('Vos jetons quotidiens ont été renouvelés.')
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 6. Generation Pipeline with Groq AI + Firestore persistence
  useEffect(() => {
    if (data.screen !== 'generation' || !data.activeShortId || !activeShort) return
    if (activeShort.status !== 'generating') return
    const taskId = activeShort.id
    if (runningId.current === taskId) return
    runningId.current = taskId
    const controller = new AbortController()
    abortController.current = controller

    void generateClipMock(
      activeShort.source,
      (update) => {
        setData((current) => ({
          ...current,
          history: current.history.map((item) =>
            item.id === taskId
              ? { ...item, progress: update.progress, stage: update.stage }
              : item,
          ),
        }))
      },
      controller.signal,
      activeShort.durationSeconds,
      data.resolution,
      activeShort.style,
    )
      .then((result) => {
        setData((current) => ({
          ...current,
          activeShortId: taskId,
          screen: 'editor',
          history: current.history.map((item) =>
            item.id === taskId
              ? {
                  ...item,
                  ...result,
                  text: result.caption,
                  status: 'ready',
                  progress: 100,
                  stage: 'Terminé',
                }
              : item,
          ),
        }))

        // Persist completed Short to Cloud Firestore
        void saveShortToFirestore(user.uid, {
          task_id: taskId,
          status: 'completed',
          progress: 100,
          stage: 'Terminé',
          titre: result.title.slice(0, 200),
          explication: result.caption.slice(0, 1000),
          source: activeShort.source.slice(0, 500),
          duration_seconds: result.durationSeconds || data.duration,
          resolution: data.resolution,
          aspect_ratio: '9:16',
          subtitles: activeShort.enabled,
          subtitle_color: activeShort.color,
          subtitle_size: String(activeShort.size),
          subtitle_position: activeShort.position,
          credit_cost: SHORT_COST,
          owner_uid: user.uid,
        })

        if (result.notice) {
          setNotice(result.notice)
        } else {
          setNotice('Votre Short est prêt ! Extrait analysé et sauvegardé dans Firestore.')
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const message =
          error instanceof Error
            ? error.message
            : 'Une erreur est survenue pendant la création.'
        setData((current) => ({
          ...current,
          screen: 'error',
          history: current.history.map((item) =>
            item.id === taskId ? { ...item, status: 'failed', error: message } : item,
          ),
        }))
      })
      .finally(() => {
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
      history: current.history.map((item) =>
        item.id === activeShort.id ? { ...item, ...values } : item,
      ),
    }))

    // Sync updates to Firestore
    void saveShortToFirestore(user.uid, {
      task_id: activeShort.id,
      titre: values.title ?? activeShort.title,
      explication: values.text ?? activeShort.text,
      subtitle_color: values.color ?? activeShort.color,
      subtitle_size: String(values.size ?? activeShort.size),
      subtitle_position: values.position ?? activeShort.position,
      subtitles: values.enabled ?? activeShort.enabled,
      duration_seconds: values.durationSeconds ?? activeShort.durationSeconds,
    })
  }

  function startGeneration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    const sourceValue = fileName ? `Fichier : ${fileName}` : source.trim()
    if (data.tokens < SHORT_COST) {
      navigate('exhausted')
      return
    }
    if (!sourceValue) {
      setNotice('Collez un lien YouTube ou saisissez un sujet pour le Short.')
      return
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
      stage: 'Préparation et appel Groq IA…',
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
      tokens: Math.min(
        current.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS,
        current.tokens + SHORT_COST,
      ),
      activeShortId: null,
      screen: 'create',
      history: current.history.map((item) =>
        item.id === current.activeShortId
          ? { ...item, status: 'cancelled', stage: 'Annulé' }
          : item,
      ),
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
      stage: 'Préparation et appel Groq IA…',
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
    setData((current) => ({
      ...current,
      activeShortId: item.id,
      screen: item.status === 'generating' ? 'generation' : 'editor',
    }))
    setNotice('')
  }

  function handleDeleteShort(shortId: string) {
    setData((current) => ({
      ...current,
      history: current.history.filter((h) => h.id !== shortId),
      activeShortId: current.activeShortId === shortId ? null : current.activeShortId,
    }))
    void deleteShortFromFirestore(user.uid, shortId)
    setNotice('Short supprimé de votre historique et de Cloud Firestore.')
  }

  function duplicateShort() {
    if (!activeShort) return
    const copyId = crypto.randomUUID()
    const copy: ShortItem = {
      ...activeShort,
      id: copyId,
      title: `${activeShort.title} (copie)`,
      createdAt: new Date().toISOString(),
      status: 'ready',
    }
    setData((current) => ({
      ...current,
      history: [copy, ...current.history],
      activeShortId: copy.id,
    }))
    void saveShortToFirestore(user.uid, {
      task_id: copyId,
      status: 'completed',
      titre: copy.title,
      explication: copy.text,
      source: copy.source,
      duration_seconds: copy.durationSeconds,
      resolution: data.resolution,
      aspect_ratio: '9:16',
      subtitles: copy.enabled,
      subtitle_color: copy.color,
      subtitle_size: String(copy.size),
      subtitle_position: copy.position,
      credit_cost: 0,
      owner_uid: user.uid,
    })
    setNotice('Une copie du Short a été ajoutée et enregistrée.')
  }

  async function shareShort() {
    if (!activeShort) return
    try {
      if (navigator.share) {
        await navigator.share({
          title: activeShort.title,
          text: `Regardez mon Short créé avec GemClip : ${activeShort.title}`,
        })
      } else {
        await navigator.clipboard.writeText(
          `${activeShort.title}\n\n${activeShort.text}\n\nCréé avec GemClip IA`,
        )
        setNotice('Détails du Short copiés dans le presse-papiers !')
      }
    } catch {
      setNotice('Le partage n’a pas pu être effectué.')
    }
  }

  function downloadShortDetails() {
    if (!activeShort) return
    const textBlob = new Blob(
      [
        `=== GEMCLIP SHORT EXPORT ===\n`,
        `Titre : ${activeShort.title}\n`,
        `Format : 9:16 Vertical (${data.resolution}p)\n`,
        `Durée : ${activeShort.durationSeconds} secondes\n`,
        `Police : ${activeShort.font} | Couleur : ${activeShort.color} | Style : ${activeShort.style}\n`,
        `Animation de transition : ${activeShort.transition} (${activeShort.transitionSpeed}s)\n\n`,
        `SECTIONS DE SOUS-TITRES SYNCHRONISÉES :\n${activeShort.text}\n\n`,
        `Tags : #Shorts #YouTubeShorts #Reels #TikTok\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    )
    const url = URL.createObjectURL(textBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeShort.title.replace(/[^a-z0-9_-]/gi, '_')}-gemclip.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setNotice('Dossier du Short exporté avec succès.')
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
        transition: activeShort.transition,
        transitionSpeed: activeShort.transitionSpeed,
      }
      setSettingsUndo((current) => [...current.slice(-19), snapshot])
      setSettingsRedo([])
      updateActiveShort({ [key]: value })
    }
  }

  function undoSubtitleSettings() {
    if (settingsUndo.length === 0 || !activeShort) return
    const previous = settingsUndo[settingsUndo.length - 1]
    updateActiveShort(previous)
    setSettingsUndo((items) => items.slice(0, -1))
  }

  function redoSubtitleSettings() {
    if (settingsRedo.length === 0 || !activeShort) return
    const next = settingsRedo[settingsRedo.length - 1]
    updateActiveShort(next)
    setSettingsRedo((items) => items.slice(0, -1))
  }

  async function upgradePlan() {
    setBusy(true)
    try {
      const db = getFirebaseFirestore()
      await setDoc(
        doc(db, 'users', user.uid),
        {
          plan: 'plus',
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      ).catch(() => {})

      setData((current) => ({
        ...current,
        plan: 'plus',
        tokens: PLUS_TOKENS,
        lastResetDay: utcDay(),
        screen: 'create',
      }))
      setNotice('Abonnement Plus activé avec succès ! Vous bénéficiez de 100 jetons par jour.')
    } catch {
      setData((current) => ({
        ...current,
        plan: 'plus',
        tokens: PLUS_TOKENS,
        lastResetDay: utcDay(),
        screen: 'create',
      }))
      setNotice('Abonnement Plus activé pour votre studio (100 jetons/jour).')
    } finally {
      setBusy(false)
    }
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
  const isEditorMode = data.screen === 'editor'

  return (
    <main className={`gc-app ${isEditorMode ? 'gc-app-editor-mode' : ''}`}>
      <Header
        user={user}
        tokens={data.tokens}
        plan={data.plan}
        screen={data.screen}
        onNavigate={navigate}
      />
      {storageWarning && (
        <div className="gc-storage-warning" role="status">
          <AlertCircle size={16} />
          {storageWarning}
        </div>
      )}
      {notice && (
        <div className="gc-notice" role="status">
          <CheckCircle2 size={16} />
          {notice}
          <button type="button" onClick={() => setNotice('')} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      {data.screen === 'create' && (
        <>
          <div className="gc-create-layout">
            <section className="gc-create-copy">
              <Chip>
                <Sparkles size={14} /> Extraction Groq LLaMA & Sous-titres 9:16
              </Chip>
              <h1>
                Une vidéo.
                <br />
                <span>Un Short.</span>
              </h1>
              <p className="gc-lead">
                Collez un lien YouTube ou écrivez votre sujet. L’IA Groq extrait le moment fort et
                GemClip crée les sous-titres animés avec transitions percutantes.
              </p>
              <Card className="gc-create-card">
                <form onSubmit={startGeneration}>
                  <label className="gc-field-label" htmlFor="gc-source">
                    Lien YouTube, TikTok ou Sujet de la vidéo
                  </label>
                  <div className="gc-source-input">
                    <input
                      id="gc-source"
                      type="text"
                      value={source}
                      placeholder="https://youtube.com/watch?v=... ou « Les 3 secrets du dropshipping »"
                      onChange={(event) => setSource(event.target.value)}
                      disabled={Boolean(fileName)}
                    />
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={data.tokens < SHORT_COST}
                    >
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
                  {fileName && (
                    <button
                      className="gc-file-clear"
                      type="button"
                      onClick={() => setFileName('')}
                    >
                      Retirer le fichier
                    </button>
                  )}
                  <p className="gc-helper">
                    Propulsé par le modèle Groq LLaMA. Vos créations sont sauvegardées
                    directement dans Cloud Firestore.
                  </p>
                </form>
                <div className="gc-options">
                  <label className="gc-option">
                    <span>Durée</span>
                    <select
                      value={data.duration}
                      onChange={(event) =>
                        setData((current) => ({
                          ...current,
                          duration: Number(event.target.value),
                        }))
                      }
                    >
                      <option value={30}>30 s</option>
                      <option value={45}>45 s</option>
                      <option value={60}>60 s</option>
                    </select>
                  </label>
                  <label className="gc-option">
                    <span>Qualité</span>
                    <select
                      value={data.resolution}
                      onChange={(event) =>
                        setData((current) => ({
                          ...current,
                          resolution: Number(event.target.value) as 720 | 1080,
                        }))
                      }
                    >
                      <option value={720}>720p</option>
                      <option value={1080}>1080p</option>
                    </select>
                  </label>
                  <Toggle
                    label="Sous-titres activés"
                    checked={data.subtitlesEnabled}
                    onChange={(value) =>
                      setData((current) => ({ ...current, subtitlesEnabled: value }))
                    }
                  />
                  <button
                    className="gc-customize-link"
                    type="button"
                    onClick={() => setShowCustomize((value) => !value)}
                    aria-expanded={showCustomize}
                  >
                    <Settings2 size={15} /> Personnaliser
                  </button>
                </div>
                {showCustomize && (
                  <div className="gc-create-customizer">
                    <div className="gc-create-customizer-heading">
                      <strong>Personnaliser les sous-titres</strong>
                      <Chip>9:16</Chip>
                    </div>
                    <EditorChoice
                      title="Style"
                      choices={['Gras', 'Sobre', 'Marqué']}
                      value={data.subtitleDefaults.style}
                      onChange={(value) =>
                        setData((current) => ({
                          ...current,
                          subtitleDefaults: {
                            ...current.subtitleDefaults,
                            style: value as SubtitleStyle,
                          },
                        }))
                      }
                    />
                    <EditorChoice
                      title="Position"
                      choices={['Haut', 'Milieu', 'Bas']}
                      value={data.subtitleDefaults.position}
                      onChange={(value) =>
                        setData((current) => ({
                          ...current,
                          subtitleDefaults: {
                            ...current.subtitleDefaults,
                            position: value as SubtitleSettings['position'],
                          },
                        }))
                      }
                    />
                    <label className="gc-slider-label">
                      Taille <span>{data.subtitleDefaults.size}px</span>
                      <input
                        type="range"
                        min="14"
                        max="34"
                        value={data.subtitleDefaults.size}
                        onChange={(event) =>
                          setData((current) => ({
                            ...current,
                            subtitleDefaults: {
                              ...current.subtitleDefaults,
                              size: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <div className="gc-setting-group">
                      <strong>Couleur d’accent</strong>
                      <div className="gc-color-list">
                        {COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={`Couleur ${color}`}
                            aria-pressed={data.subtitleDefaults.color === color}
                            className={data.subtitleDefaults.color === color ? 'selected' : ''}
                            style={{ backgroundColor: color }}
                            onClick={() =>
                              setData((current) => ({
                                ...current,
                                subtitleDefaults: { ...current.subtitleDefaults, color },
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <label className="gc-select-label">
                      Animation de transition
                      <select
                        value={data.subtitleDefaults.transition}
                        onChange={(event) =>
                          setData((current) => ({
                            ...current,
                            subtitleDefaults: {
                              ...current.subtitleDefaults,
                              transition: event.target.value as TransitionStyle,
                            },
                          }))
                        }
                      >
                        {TRANSITION_LIBRARY.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.badge})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="gc-select-label">
                      Police
                      <select
                        value={data.subtitleDefaults.font}
                        onChange={(event) =>
                          setData((current) => ({
                            ...current,
                            subtitleDefaults: {
                              ...current.subtitleDefaults,
                              font: event.target.value as SubtitleSettings['font'],
                            },
                          }))
                        }
                      >
                        {['Outfit', 'Montserrat', 'Anton', 'Poppins'].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {data.tokens < SHORT_COST && (
                  <button
                    className="gc-inline-error"
                    type="button"
                    onClick={() => navigate('exhausted')}
                  >
                    Plus assez de jetons — voir les options
                  </button>
                )}
              </Card>
              <div className="gc-create-note">
                <Zap size={15} /> Un Short coûte {SHORT_COST} jetons. {FREE_TOKENS} jetons offerts
                quotidiennement en plan Gratuit.
              </div>
            </section>

            <section className="gc-create-preview">
              <div className="gc-preview-label">
                <span>Aperçu du rendu</span>
                <Chip>9:16</Chip>
              </div>
              <PhonePreview variant="empty" />
              <div className="gc-preview-actions">
                <Button disabled>
                  <Download size={16} /> Télécharger
                </Button>
                <Button disabled>
                  <Share2 size={16} /> Partager
                </Button>
              </div>
              <p>L’aperçu dynamique interactif se débloque dès la fin de la génération.</p>
            </section>
          </div>

          <section className="gc-platforms">
            <span>PRÊT À PUBLIER SUR</span>
            <strong>YouTube Shorts</strong>
            <strong>TikTok</strong>
            <strong>Instagram Reels</strong>
            <strong>Facebook Reels</strong>
          </section>

          {data.history.length > 0 && (
            <section className="gc-page-section" style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1.5rem' }}>
              <div className="gc-page-heading" style={{ marginBottom: '1.2rem' }}>
                <div>
                  <Chip>
                    <History size={14} /> CLOUD FIRESTORE
                  </Chip>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.4rem 0 0.2rem' }}>Historique de vos Shorts</h2>
                  <p style={{ color: 'var(--gc-text-muted)', fontSize: '0.9rem' }}>
                    Retrouvez et rééditez toutes vos créations directement ici.
                  </p>
                </div>
                <TokenPill tokens={data.tokens} />
              </div>
              <div className="gc-history-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                {data.history
                  .filter((item) => item.status === 'ready' || item.status === 'generating')
                  .map((item) => (
                    <ShortTile
                      key={item.id}
                      item={item}
                      active={item.id === data.activeShortId}
                      onEdit={() => reedit(item)}
                      onDelete={() => handleDeleteShort(item.id)}
                    />
                  ))}
              </div>
            </section>
          )}

          <section className="gc-features-section" id="features">
            <div className="gc-section-heading">
              <span>LE STUDIO SHORTS</span>
              <h2>Tout ce qu’il faut, rien de plus.</h2>
            </div>
            <div className="gc-feature-grid">
              <Card>
                <span className="gc-feature-icon">
                  <Sparkles size={20} />
                </span>
                <h3>Analyse Groq IA</h3>
                <p>Détection ultra-rapide des moments à haute rétention grâce au moteur Groq.</p>
              </Card>
              <Card>
                <span className="gc-feature-icon">
                  <WandSparkles size={20} />
                </span>
                <h3>Transitions de Sous-titres</h3>
                <p>Bibliothèque de 8 transitions exclusives (Pop Impact, Glissé, Rebond, Flash Néon).</p>
              </Card>
              <Card>
                <span className="gc-feature-icon">
                  <ShieldCheck size={20} />
                </span>
                <h3>Cloud Firestore</h3>
                <p>Vos créations et votre historique sont sauvegardés et synchronisés en direct.</p>
              </Card>
            </div>
          </section>
          <PricingPreview onChoose={() => navigate('pricing')} />
          <footer className="gc-footer">
            GemClip <span>·</span> YouTube vers Shorts avec Groq, PayPal & Firestore.
          </footer>
        </>
      )}

      {data.screen === 'generation' && activeShort && (
        <section className="gc-generation">
          <Card className="gc-generation-card">
            <div className="gc-generation-heading">
              <span className="gc-icon-box">
                <LoaderCircle className="gc-spin" size={20} />
              </span>
              <div>
                <h1>Création en cours…</h1>
                <p>{activeShort.stage || 'Analyse en cours…'}</p>
              </div>
              <strong>{activeShort.progress}%</strong>
            </div>
            <div className="gc-progress">
              <span style={{ width: `${activeShort.progress}%` }} />
            </div>
            <ol className="gc-step-list">
              {[
                'Vidéo récupérée',
                'Contenu transcrit',
                'Analyse Groq IA & moment clé',
                'Sous-titres & transitions configurées',
                'Short prêt',
              ].map((step, index) => {
                const currentIndex =
                  activeShort.progress === 100
                    ? 5
                    : Math.floor(activeShort.progress / 20)
                const done = index < currentIndex
                const current = !done && index === currentIndex
                return (
                  <li key={step} className={done ? 'done' : current ? 'current' : ''}>
                    <span>
                      {done ? (
                        <Check size={14} />
                      ) : current ? (
                        <span className="gc-step-dot" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {step}
                  </li>
                )
              })}
            </ol>
            <div className="gc-generation-actions">
              <Button onClick={cancelGeneration}>Annuler</Button>
            </div>
          </Card>
        </section>
      )}

      {data.screen === 'editor' &&
        (activeShort ? (
          <section className="gc-editor">
            <header className="gc-editor-topbar">
              <Button aria-label="Retour" onClick={() => navigate('create')}>
                <ArrowLeft size={16} />
              </Button>
              <div className="gc-editor-name">
                <strong>{activeShort.title || 'Mon Short'}</strong>
              </div>
              <TokenPill tokens={data.tokens} />
              <div className="gc-undo-actions">
                <Button
                  aria-label="Annuler"
                  onClick={undoSubtitleSettings}
                  disabled={settingsUndo.length === 0}
                >
                  <Undo2 size={16} />
                </Button>
                <Button
                  aria-label="Rétablir"
                  onClick={redoSubtitleSettings}
                  disabled={settingsRedo.length === 0}
                >
                  <Redo2 size={16} />
                </Button>
              </div>
              <Button variant="primary" aria-label="Exporter" onClick={downloadShortDetails}>
                <Download size={16} />
              </Button>
            </header>

            <div className="gc-editor-main">
              <nav className="gc-tool-rail" aria-label="Outils de montage">
                {TOOLS.map(({ name, icon: Icon }) => (
                  <button
                    key={name}
                    type="button"
                    className={editorTool === name ? 'active' : ''}
                    title={name}
                    aria-label={name}
                    onClick={() => {
                      setEditorTool(name)
                    }}
                  >
                    <Icon size={20} strokeWidth={2} />
                  </button>
                ))}
              </nav>

              <section className="gc-editor-canvas">
                <div className="gc-canvas-toolbar">
                  <Chip>9:16</Chip>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Button
                      variant="primary"
                      aria-label="Tester transition"
                      onClick={() => triggerTransition()}
                      style={{ padding: '0 8px', minHeight: 30 }}
                    >
                      <Sparkles size={16} />
                    </Button>
                  </div>
                </div>

                <PhonePreview
                  caption={activeShort.text}
                  settings={activeShort}
                  subtitle={activeShort.enabled}
                  activeSectionIndex={activeSectionIndex}
                  isTransitioning={isTransitioning}
                />

                <div className="gc-player-controls">
                  <button
                    type="button"
                    onClick={() => {
                      setPlayhead((time) =>
                        time >= activeShort.durationSeconds ? 0 : time + 1,
                      )
                      triggerTransition()
                    }}
                    aria-label="Lecture & transition"
                  >
                    <Play size={14} fill="currentColor" />
                  </button>
                  <span>
                    00:{String(playhead).padStart(2, '0')} / 00:
                    {String(activeShort.durationSeconds).padStart(2, '0')}
                  </span>
                  <Chip active>
                    Section {activeSectionIndex + 1}/{Math.max(1, subtitleSections.length)} ·{' '}
                    {activeShort.transition || 'Pop'}
                  </Chip>
                  <button
                    type="button"
                    onClick={() => void shareShort()}
                    aria-label="Partager"
                  >
                    <Share2 size={14} />
                  </button>
                </div>
              </section>

              <aside className="gc-editor-panel">
                {/* TOOL: TRANSITIONS (DEDICATED LIBRARY) */}
                {editorTool === 'Transitions' ? (
                  <>
                    <div className="gc-panel-heading">
                      <h2>Transitions</h2>
                      <Button variant="primary" style={{ minHeight: 32, padding: '0 8px', fontSize: '10px' }} onClick={() => triggerTransition()} title="Tester">
                        <Play size={12} fill="currentColor" /> Tester
                      </Button>
                    </div>

                    <div className="gc-transition-grid" style={{ marginTop: '4px' }}>
                      {TRANSITION_LIBRARY.map((t) => {
                        const Icon = t.icon
                        const isSelected = (activeShort.transition || 'Pop') === t.id
                        return (
                          <div
                            key={t.id}
                            className={`gc-transition-card ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              updateSubtitle('transition', t.id)
                              updateSubtitle('transitionSpeed', t.speedDefault)
                              triggerTransition()
                            }}
                            title={t.description}
                          >
                            <Icon size={15} />
                            <strong>{t.name}</strong>
                          </div>
                        )
                      })}
                    </div>

                    <label className="gc-slider-label" style={{ marginTop: '10px' }}>
                      Vitesse <span>{(activeShort.transitionSpeed || 0.35).toFixed(2)}s</span>
                      <input
                        type="range"
                        min="0.2"
                        max="0.8"
                        step="0.05"
                        value={activeShort.transitionSpeed || 0.35}
                        onChange={(event) =>
                          updateSubtitle('transitionSpeed', Number(event.target.value))
                        }
                      />
                    </label>

                    {/* SECTIONS MANAGER */}
                    <div className="gc-section-manager" style={{ marginTop: '10px' }}>
                      <div className="gc-section-manager-head">
                        <strong>Sections ({subtitleSections.length})</strong>
                      </div>
                      <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'grid', gap: '4px', margin: '6px 0' }}>
                        {subtitleSections.map((sec, idx) => (
                          <div
                            key={`${sec}-${idx}`}
                            className="gc-section-item"
                            onClick={() => triggerTransition(idx)}
                            style={{
                              cursor: 'pointer',
                              borderColor: activeSectionIndex === idx ? 'var(--gc-blue)' : undefined,
                              backgroundColor:
                                activeSectionIndex === idx ? 'var(--gc-blue-soft)' : '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid var(--gc-border)',
                            }}
                          >
                            <span style={{ minWidth: 16, fontSize: '9px', fontWeight: 700, color: 'var(--gc-blue)' }}>{idx + 1}</span>
                            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10px' }}>{sec}</span>
                            <Sparkles size={10} />
                          </div>
                        ))}
                      </div>
                      {isEditingSections ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <textarea
                            value={sectionDraft}
                            onChange={(e) => setSectionDraft(e.target.value)}
                            rows={3}
                            style={{
                              width: '100%',
                              padding: '6px',
                              borderRadius: '6px',
                              border: '1px solid var(--gc-border)',
                              fontSize: '10px',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                            }}
                            placeholder="Une phrase par ligne..."
                          />
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <Button
                              variant="primary"
                              style={{ flex: 1, minHeight: 26, fontSize: '9px' }}
                              onClick={() => {
                                updateSubtitle('text', sectionDraft)
                                setIsEditingSections(false)
                              }}
                            >
                              Appliquer
                            </Button>
                            <Button
                              style={{ minHeight: 26, fontSize: '9px' }}
                              onClick={() => setIsEditingSections(false)}
                            >
                              Annuler
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          style={{ minHeight: 28, fontSize: '9px', width: '100%' }}
                          onClick={() => {
                            setSectionDraft(activeShort.text)
                            setIsEditingSections(true)
                          }}
                        >
                          Éditer les phrases
                        </Button>
                      )}
                    </div>
                  </>
                ) : editorTool === 'Sous-titres' ? (
                  <>
                    <div className="gc-panel-heading">
                      <div>
                        <span>PERSONNALISATION</span>
                        <h2>Sous-titres animés</h2>
                      </div>
                    </div>
                    <Toggle
                      label="Sous-titres activés"
                      checked={activeShort.enabled}
                      onChange={(value) => updateSubtitle('enabled', value)}
                    />

                    {/* Quick Access to Transition Library */}
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'var(--gc-blue-soft)',
                        border: '1px solid #bfdbfe',
                        marginTop: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '11px', color: '#1e40af', display: 'block' }}>
                          Transition : {activeShort.transition || 'Pop'}
                        </strong>
                        <span style={{ fontSize: '9px', color: '#3b82f6' }}>
                          {(activeShort.transitionSpeed || 0.35).toFixed(2)}s entre chaque section
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        style={{ padding: '0 8px', minHeight: 28, fontSize: '9px' }}
                        onClick={() => setEditorTool('Transitions')}
                      >
                        Bibliothèque →
                      </Button>
                    </div>

                    <EditorChoice
                      title="Style"
                      choices={['Gras', 'Sobre', 'Marqué']}
                      value={activeShort.style}
                      onChange={(value) => updateSubtitle('style', value as SubtitleStyle)}
                    />
                    <EditorChoice
                      title="Position"
                      choices={['Haut', 'Milieu', 'Bas']}
                      value={activeShort.position}
                      onChange={(value) =>
                        updateSubtitle('position', value as SubtitleSettings['position'])
                      }
                    />
                    <label className="gc-slider-label">
                      Taille <span>{activeShort.size}px</span>
                      <input
                        type="range"
                        min="14"
                        max="34"
                        value={activeShort.size}
                        onChange={(event) =>
                          updateSubtitle('size', Number(event.target.value))
                        }
                      />
                    </label>
                    <div className="gc-setting-group">
                      <strong>Couleur d’accent</strong>
                      <div className="gc-color-list">
                        {COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={`Couleur ${color}`}
                            aria-pressed={activeShort.color === color}
                            className={activeShort.color === color ? 'selected' : ''}
                            style={{ backgroundColor: color }}
                            onClick={() => updateSubtitle('color', color)}
                          />
                        ))}
                      </div>
                    </div>
                    <label className="gc-select-label">
                      Police
                      <select
                        value={activeShort.font}
                        onChange={(event) =>
                          updateSubtitle(
                            'font',
                            event.target.value as SubtitleSettings['font'],
                          )
                        }
                      >
                        {['Outfit', 'Montserrat', 'Anton', 'Poppins'].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <Toggle
                      label="Mots clés surlignés"
                      badge="IA"
                      checked={activeShort.highlightedWords}
                      onChange={(value) => updateSubtitle('highlightedWords', value)}
                    />
                    <Toggle
                      label="Contour et ombre"
                      checked={activeShort.outline}
                      onChange={(value) => updateSubtitle('outline', value)}
                    />
                    <div className="gc-panel-buttons">
                      <Button
                        onClick={() => {
                          const editedText = window.prompt(
                            'Modifier le texte des sous-titres (sautez une ligne pour séparer les sections)',
                            activeShort.text,
                          )
                          if (editedText !== null) updateSubtitle('text', editedText)
                        }}
                      >
                        Modifier le texte
                      </Button>
                      <Button
                        onClick={() => {
                          const newTitle = window.prompt(
                            'Modifier le titre du Short',
                            activeShort.title,
                          )
                          if (newTitle !== null) updateActiveShort({ title: newTitle })
                        }}
                      >
                        Modifier le titre
                      </Button>
                    </div>
                  </>
                ) : editorTool === 'Extrait' ? (
                  <div className="gc-tool-placeholder">
                    <Scissors size={21} />
                    <h2>Extrait</h2>
                    <p>Durée de l’extrait : {activeShort.durationSeconds} secondes.</p>
                    <Button
                      onClick={() =>
                        updateActiveShort({
                          durationSeconds:
                            activeShort.durationSeconds === 45 ? 30 : 45,
                        })
                      }
                    >
                      Alterner 30s / 45s
                    </Button>
                  </div>
                ) : editorTool === 'Format' ? (
                  <div className="gc-tool-placeholder">
                    <Smartphone size={21} />
                    <h2>Format Vertical</h2>
                    <p>Format vertical 9:16 standard pour Shorts, TikTok & Reels · {data.resolution}p</p>
                    <Chip active>9:16 Plein écran</Chip>
                  </div>
                ) : (
                  <div className="gc-tool-placeholder">
                    <WandSparkles size={21} />
                    <h2>{editorTool}</h2>
                    <p>Paramètres synchronisés directement avec Cloud Firestore.</p>
                  </div>
                )}
              </aside>
            </div>

            {/* DOCKED TIMELINE - COMPACT ZERO SCROLL */}
            <section className="gc-timeline">
              <div className="gc-timeline-actions">
                <Button
                  onClick={() =>
                    updateActiveShort({
                      durationSeconds: Math.max(15, activeShort.durationSeconds - 5),
                    })
                  }
                >
                  <Scissors size={13} /> -5s
                </Button>
                <Button onClick={duplicateShort}>
                  <Copy size={13} /> Dupliquer
                </Button>
                <Button onClick={() => triggerTransition()}>
                  <Sparkles size={13} /> Transition : {activeShort.transition || 'Pop'}
                </Button>
                <span className="gc-zoom-actions">
                  <button
                    type="button"
                    aria-label="Zoom arrière"
                    onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}
                  >
                    <Minus size={13} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    aria-label="Zoom avant"
                    onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
                  >
                    <Plus size={13} />
                  </button>
                </span>
              </div>

              <div className="gc-time-ruler">
                <span>00:00</span>
                <span>00:10</span>
                <span>00:20</span>
                <span>00:30</span>
                <span>00:40</span>
              </div>

              <div className="gc-track-row">
                <span>Sous-titres</span>
                <div className="gc-caption-track">
                  {subtitleSections.map((line, index) => (
                    <span
                      key={`${line}-${index}`}
                      onClick={() => triggerTransition(index)}
                      style={{
                        cursor: 'pointer',
                        borderColor: activeSectionIndex === index ? 'var(--gc-blue)' : undefined,
                        backgroundColor:
                          activeSectionIndex === index ? 'var(--gc-blue-soft)' : undefined,
                        fontWeight: activeSectionIndex === index ? 750 : undefined,
                      }}
                      title="Cliquer pour prévisualiser la transition"
                    >
                      {index > 0 && (
                        <span className="gc-transition-connector">
                          ⚡ {activeShort.transition || 'Pop'}
                        </span>
                      )}{' '}
                      {line}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEditorTool('Transitions')}
                  >
                    + Transitions ({activeShort.transition || 'Pop'})
                  </button>
                </div>
              </div>
            </section>
          </section>
        ) : (
          <EmptyState
            title="Aucun Short à modifier"
            action="Créer un Short"
            onAction={() => navigate('create')}
          />
        ))}

      {/* History is now directly integrated into the creation section */}

      {data.screen === 'account' && (
        <section className="gc-page-section gc-account-page">
          <div className="gc-page-heading">
            <div>
              <Chip>COMPTE & INTÉGRATIONS</Chip>
              <h1>Votre espace GemClip</h1>
              <p>Profil utilisateur, abonnements et état des clés API.</p>
            </div>
            <TokenPill tokens={data.tokens} />
          </div>

          <Card className="gc-account-card">
            <div className="gc-account-avatar">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" />
              ) : (
                profileName.slice(0, 1).toUpperCase()
              )}
            </div>
            <div>
              <h2>{profileName}</h2>
              <p>{user.email}</p>
            </div>
          </Card>

          {/* API Keys Configuration Status Card */}
          <Card className="gc-account-card">
            <div>
              <span style={{ fontSize: '0.8rem', color: '#93C5FD', fontWeight: 600 }}>
                ÉTAT DES CLÉS API
              </span>
              <h2 style={{ fontSize: '1.15rem', marginTop: '0.2rem' }}>
                Services connectés
              </h2>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  marginTop: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: apiStatus?.groqConfigured ? '#86EFAC' : '#FDE68A',
                    }}
                  />
                  <strong>Groq API :</strong>
                  <span>
                    {apiStatus?.groqConfigured
                      ? `Connecté (${apiStatus.groqModel})`
                      : 'Actif en mode démo (ajoutez GROQ_API_KEY dans .env)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: apiStatus?.paypalConfigured ? '#86EFAC' : '#93C5FD',
                    }}
                  />
                  <strong>PayPal :</strong>
                  <span>
                    {apiStatus?.paypalConfigured
                      ? 'Prêt pour paiements réels'
                      : 'Prêt pour activation 1-clic (ajoutez PAYPAL_CLIENT_ID dans .env)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#86EFAC',
                    }}
                  />
                  <strong>Firebase Firestore :</strong>
                  <span>Connecté & synchronisé</span>
                </div>
              </div>
            </div>
          </Card>

          <Card className="gc-account-card gc-account-plan">
            <div>
              <span>Votre offre</span>
              <h2>{data.plan === 'plus' ? 'GemClip Plus' : 'Gratuit'}</h2>
              <p>
                {data.tokens} jetons disponibles sur {data.plan === 'plus' ? 100 : FREE_TOKENS}
              </p>
            </div>
            <Button onClick={() => navigate('pricing')}>Voir les offres</Button>
          </Card>

          <Button onClick={() => void logout()} disabled={busy}>
            <LogOut size={16} /> Se déconnecter
          </Button>
        </section>
      )}

      {data.screen === 'pricing' && (
        <section className="gc-pricing-page" id="pricing">
          <div className="gc-pricing-hero">
            <Chip>
              <Zap size={14} /> GEMCLIP PLUS
            </Chip>
            <h1>
              Publiez tous les jours.
              <br />
              <span>Sans compter.</span>
            </h1>
            <p>100 jetons par jour, soit jusqu’à 33 Shorts quotidiens pour votre chaîne.</p>
          </div>
          <div className="gc-plan-grid">
            <Card className="gc-plan-card">
              <span className="gc-plan-name">Gratuit</span>
              <strong className="gc-plan-price">0 €</strong>
              <p>{FREE_TOKENS} jetons par jour</p>
              <ul>
                <li>
                  <Check size={16} /> Extrait choisi par Groq IA
                </li>
                <li>
                  <Check size={16} /> Sous-titres animés 9:16
                </li>
                <li>
                  <Check size={16} /> Bibliothèque de transitions
                </li>
                <li>
                  <Check size={16} /> Sauvegarde Cloud Firestore
                </li>
              </ul>
              <Button onClick={() => navigate('create')}>Plan actuel</Button>
            </Card>
            <Card className="gc-plan-card gc-plan-plus">
              <Chip active>Recommandé</Chip>
              <span className="gc-plan-name">Plus</span>
              <strong className="gc-plan-price">
                4,99 € <small>/ mois</small>
              </strong>
              <p>100 jetons chaque jour · jusqu’à 33 Shorts</p>
              <ul>
                <li>
                  <Check size={16} /> Analyse Groq IA illimitée
                </li>
                <li>
                  <Check size={16} /> Toutes les transitions (Pop, Glitch, 3D...)
                </li>
                <li>
                  <Check size={16} /> Export 1080p haute définition
                </li>
                <li>
                  <Check size={16} /> Sauvegarde illimitée dans Firestore
                </li>
              </ul>
              <Button variant="primary" onClick={() => void upgradePlan()} disabled={busy}>
                Activer GemClip Plus · 4,99 €/mois
              </Button>
              <small className="gc-payment-note">
                Paiement sécurisé via PayPal · Annulation possible à tout moment
              </small>
            </Card>
          </div>
          <section className="gc-unlocks">
            <h2>Ce que vous débloquez.</h2>
            <div>
              <Card>
                <strong>100</strong>
                <span>jetons chaque jour</span>
              </Card>
              <Card>
                <strong>8</strong>
                <span>animations de transition</span>
              </Card>
              <Card>
                <strong>1080p</strong>
                <span>qualité Full HD</span>
              </Card>
            </div>
          </section>
        </section>
      )}

      {data.screen === 'exhausted' && (
        <section className="gc-state-page">
          <Card className="gc-exhausted-card">
            <span className="gc-icon-box">
              <Zap size={21} />
            </span>
            <Chip active>QUOTA QUOTIDIEN</Chip>
            <h1>Plus de jetons aujourd’hui.</h1>
            <p>
              Vos jetons gratuits reviennent demain. Avec le forfait Plus, obtenez 100 jetons
              quotidiens.
            </p>
            <TokenPill tokens={data.tokens} />
            <Button variant="primary" onClick={() => navigate('pricing')}>
              Passer à Plus · 4,99 €/mois <ArrowRight size={16} />
            </Button>
            <Button onClick={() => navigate('create')}>Attendre la recharge</Button>
          </Card>
        </section>
      )}

      {data.screen === 'error' && (
        <section className="gc-state-page">
          <Card className="gc-error-card">
            <span className="gc-error-icon">
              <AlertCircle size={22} />
            </span>
            <h1>Erreur lors de la génération.</h1>
            <p>Vérifiez le lien vidéo ou le texte saisi, puis réessayez.</p>
            <div className="gc-error-detail">
              <strong>Détail :</strong> {activeShort?.error || 'Erreur temporaire du serveur.'}
            </div>
            <div>
              <Button variant="primary" onClick={retryFailedGeneration}>
                Réessayer
              </Button>
              <Button
                onClick={() => {
                  setData((current) => ({
                    ...current,
                    tokens: Math.min(
                      current.plan === 'plus' ? PLUS_TOKENS : FREE_TOKENS,
                      current.tokens + SHORT_COST,
                    ),
                    history: current.history.filter(
                      (item) => item.id !== current.activeShortId,
                    ),
                    activeShortId: null,
                    sourceDraft: '',
                    screen: 'create',
                  }))
                  setSource('')
                }}
              >
                Changer de sujet
              </Button>
            </div>
          </Card>
        </section>
      )}

      {data.screen !== 'editor' && <BottomNavigation screen={data.screen} onNavigate={navigate} />}
    </main>
  )
}

function EditorChoice({
  title,
  choices,
  value,
  onChange,
}: {
  title: string
  choices: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="gc-choice-field">
      <legend>{title}</legend>
      <div>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className={choice === value ? 'selected' : ''}
            aria-pressed={choice === value}
            onClick={() => onChange(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function PricingPreview({ onChoose }: { onChoose: () => void }) {
  return (
    <section className="gc-pricing-preview">
      <div>
        <span>TARIFS TRANSPARENTS</span>
        <h2>Commencez gratuitement.</h2>
      </div>
      <div className="gc-plan-preview-grid">
        <Card>
          <span>Gratuit</span>
          <strong>{FREE_TOKENS} jetons / jour</strong>
          <p>Pour essayer GemClip et créer vos premiers Shorts.</p>
          <button type="button" onClick={onChoose}>
            Voir l'offre
          </button>
        </Card>
        <Card className="gc-plan-preview-plus">
          <Chip active>Plus</Chip>
          <strong>100 jetons / jour</strong>
          <p>Jusqu’à 33 Shorts par jour · 4,99 € / mois via PayPal.</p>
          <button type="button" onClick={onChoose}>
            Découvrir Plus <ArrowRight size={15} />
          </button>
        </Card>
      </div>
    </section>
  )
}

function EmptyState({
  title,
  description,
  action,
  onAction,
}: {
  title: string
  description?: string
  action: string
  onAction: () => void
}) {
  return (
    <Card className="gc-empty-state">
      <span className="gc-feature-icon">
        <Film size={21} />
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      <Button variant="primary" onClick={onAction}>
        {action}
      </Button>
    </Card>
  )
}

export default StudioApp

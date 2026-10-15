import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Clapperboard,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import AuthPage from './AuthPage'
import StudioApp from './StudioApp'
import SubscriptionPage from './SubscriptionPage'
import { firebaseConfigMessage, getFirebaseAuth } from './firebase'

function HomePage() {
  return (
    <main className="app-shell landing-shell">
      <header className="topbar landing-nav">
        <a className="brand" href="/" aria-label="Accueil GemClip">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>GemClip</span>
        </a>
        <nav className="landing-nav-actions" aria-label="Navigation principale">
          <a className="landing-login" href="#features">Fonctionnalités</a>
          <a className="landing-login" href="#pricing">Tarifs</a>
          <a className="landing-login" href="/login">Connexion</a>
          <a className="landing-signup" href="/register">Créer un compte <ArrowUpRight size={15} /></a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow"><Sparkles size={14} /> LE STUDIO SHORTS PROPULSÉ PAR L’IA</span>
          <h1>Une vidéo.<br /><span>Un Short.</span></h1>
          <p className="landing-description">
            Collez un lien YouTube ou indiquez votre sujet. L’IA Groq extrait le moment le plus viral
            et GemClip génère des sous-titres animés prêts à partager.
          </p>
          <div className="landing-actions">
            <a className="landing-primary" href="/register">Créer mon premier Short <ArrowUpRight size={17} /></a>
            <span className="landing-free-note">10 jetons offerts à l’inscription</span>
          </div>
          <div className="landing-points">
            <span><Check size={15} /> Analyse Groq IA</span>
            <span><Check size={15} /> Sous-titres animés 9:16</span>
            <span><Check size={15} /> Sauvegarde Cloud Firestore</span>
          </div>
        </div>

        <div className="landing-visual" aria-label="Aperçu d’un Short vertical généré">
          <div className="landing-orbit landing-orbit-one" />
          <div className="landing-orbit landing-orbit-two" />
          <div className="landing-preview">
            <div className="landing-preview-top"><span><span className="live-dot" /> GROQ IA</span><span>9:16</span></div>
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
          <div className="landing-float-card"><span className="landing-float-icon"><Check size={15} /></span><span><strong>Votre Short est prêt</strong><small>Sous-titres animés inclus</small></span></div>
        </div>
      </section>

      <section className="landing-platforms" aria-label="Formats de publication">
        <span>PRÊT À PUBLIER SUR</span>
        <strong>YouTube Shorts</strong>
        <strong>TikTok</strong>
        <strong>Instagram Reels</strong>
        <strong>Facebook Reels</strong>
      </section>

      <section className="landing-product-features" id="features" aria-labelledby="landing-features-title">
        <h2 id="landing-features-title">Simple, rapide, connecté.</h2>
        <div className="landing-features">
          <article><div><strong>Extraction Groq LLaMA</strong><p>Groq analyse la vidéo et identifie le passage le plus captivant pour les Shorts.</p></div></article>
          <article><div><strong>Sous-titres personnalisables</strong><p>Choisissez parmi 6 styles d’animation, vos couleurs d’accent et vos polices favorites.</p></div></article>
          <article><div><strong>Persistance Cloud Firestore</strong><p>Retrouvez vos créations et votre historique sur tous vos appareils en toute sécurité.</p></div></article>
        </div>
      </section>

      <section className="landing-pricing" id="pricing" aria-labelledby="landing-pricing-title">
        <h2 id="landing-pricing-title">Commencez dès aujourd'hui.</h2>
        <div className="landing-plan-grid">
          <article className="landing-plan-card">
            <span>Gratuit</span>
            <h3>10 jetons pour essayer</h3>
            <p>Pour essayer GemClip et créer vos premiers Shorts viraux.</p>
            <a href="/register">Créer un compte</a>
          </article>
          <article className="landing-plan-card featured">
            <span>Plus</span>
            <h3>100 jetons / jour</h3>
            <p>Quota quotidien supérieur avec abonnements PayPal sécurisés.</p>
            <a href="/register">Découvrir GemClip Plus</a>
          </article>
        </div>
      </section>
      <footer>GemClip <span>·</span> YouTube vers Shorts avec Groq, PayPal & Firestore.</footer>
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
      </header>
      <section className="auth-content">
        <article className="auth-card auth-state-card" role={loading ? 'status' : 'alert'}>
          {loading ? <LoaderCircle className="spin" size={24} /> : <ShieldCheck size={22} />}
          <h1>{loading ? 'Connexion en cours…' : 'Configuration Firebase'}</h1>
          <p className="auth-intro">{message}</p>
          {!loading && (
            <button className="auth-submit" type="button" onClick={() => window.location.reload()}>
              Réessayer
            </button>
          )}
        </article>
      </section>
      <footer>GemClip <span>·</span> Authentification Firebase sécurisée.</footer>
    </main>
  )
}

export default function App() {
  const path = window.location.pathname
  const authMode = path === '/register' ? 'register' : path === '/login' ? 'login' : null
  const isPublicHome = path === '/'
  const isSubscribe = path === '/subscribe'
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
  if (isSubscribe) return <SubscriptionPage user={user} />
  return <StudioApp user={user} />
}

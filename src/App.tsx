import { useEffect, useState } from 'react'
import {
  Clapperboard,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import AuthPage from './AuthPage'
import StudioApp from './StudioApp'
import SubscriptionPage from './SubscriptionPage'
import { firebaseConfigMessage, getFirebaseAuth } from './firebase'

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
  const isSubscribe = path === '/subscribe'
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(authMode === null)
  const [sessionError, setSessionError] = useState('')

  useEffect(() => {
    if (authMode !== null) return
    try {
      return onAuthStateChanged(
        getFirebaseAuth(),
        (currentUser) => {
          setUser(currentUser)
          setCheckingSession(false)
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
  }, [authMode])

  if (authMode) return <AuthPage mode={authMode} />
  if (checkingSession) {
    return <SessionScreen loading message="Un instant, nous vérifions votre connexion." />
  }
  if (sessionError && path !== '/') {
    return <SessionScreen loading={false} message={sessionError} />
  }
  if (isSubscribe && user) return <SubscriptionPage user={user} />
  return <StudioApp user={user} />
}

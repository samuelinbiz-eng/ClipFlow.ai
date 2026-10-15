import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Clapperboard, LoaderCircle, LockKeyhole, Mail, Sparkles } from 'lucide-react'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { firebaseConfigMessage, firebaseConfigured, getFirebaseAuth } from './firebase'

type AuthPageProps = {
  mode: 'login' | 'register'
}

function authError(error: unknown): string {
  if (error instanceof FirebaseError) {
    const messages: Record<string, string> = {
      'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse e-mail.',
      'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
      'auth/invalid-email': 'Saisissez une adresse e-mail valide.',
      'auth/too-many-requests': 'Trop de tentatives. Réessayez un peu plus tard.',
      'auth/weak-password': 'Choisissez un mot de passe plus sécurisé.',
      'auth/network-request-failed': 'Firebase est inaccessible. Vérifiez votre connexion Internet.',
      'auth/operation-not-allowed': 'Activez la connexion par e-mail et mot de passe dans Firebase Authentication.',
      'auth/account-exists-with-different-credential': 'Un compte existe déjà avec cette adresse. Connectez-vous avec votre méthode habituelle.',
      'auth/popup-closed-by-user': 'La fenêtre Google a été fermée avant la fin de la connexion.',
      'auth/popup-blocked': 'Autorisez les fenêtres pop-up pour ce site, puis réessayez.',
      'auth/unauthorized-domain': 'Ajoutez localhost ou le domaine du site aux domaines autorisés dans Firebase Authentication.',
    }
    return messages[error.code] ?? error.message
  }
  return error instanceof Error ? error.message : 'La connexion à Firebase a échoué.'
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.9-3.6-11.5-8.4H5.7v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.5 27.6a12 12 0 0 1 0-7.2v-5.3H5.7a20 20 0 0 0 0 17.8l6.8-5.3Z" />
      <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8A19.4 19.4 0 0 0 24 4 20 20 0 0 0 5.7 15.1l6.8 5.3C14.1 15.6 18.7 12 24 12Z" />
    </svg>
  )
}

export default function AuthPage({ mode }: AuthPageProps) {
  const isRegister = mode === 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function continueWithGoogle() {
    setError('')
    setSubmitting(true)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(getFirebaseAuth(), provider)
      window.location.assign('/')
    } catch (requestError) {
      setError(authError(requestError))
      setSubmitting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (isRegister && password !== passwordConfirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    if (isRegister && password.length < 10) {
      setError('Choisissez un mot de passe d’au moins 10 caractères.')
      return
    }

    setSubmitting(true)
    try {
      const auth = getFirebaseAuth()
      if (isRegister) await createUserWithEmailAndPassword(auth, email.trim(), password)
      else await signInWithEmailAndPassword(auth, email.trim(), password)
      window.location.assign('/')
    } catch (requestError) {
      setError(authError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

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
        <article className="auth-card">
          <span className="auth-icon"><Sparkles size={21} /></span>
          <p className="auth-credit-badge">[X] jetons offerts à l’inscription</p>
          <h1>{isRegister ? 'Créez votre compte' : 'Bienvenue.'}</h1>
          <p className="auth-intro">
            {isRegister
              ? 'Inscrivez-vous pour créer et retrouver vos Shorts.'
              : 'Connectez-vous pour transformer vos vidéos en Shorts.'}
          </p>

          <button
            className="google-auth-button"
            type="button"
            onClick={continueWithGoogle}
            disabled={submitting}
          >
            {submitting
              ? <LoaderCircle className="spin" size={17} />
              : <GoogleMark />}
            Continuer avec Google
          </button>
          <div className="auth-divider"><span>ou avec votre e-mail</span></div>

          <form className="auth-form" onSubmit={submit}>
            <label className="auth-field">
              <span>Adresse e-mail</span>
              <span className="auth-input">
                <Mail size={17} aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="vous@exemple.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={254}
                  disabled={submitting}
                />
              </span>
            </label>

            <label className="auth-field">
              <span>Mot de passe</span>
              <span className="auth-input">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  type="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? '10 caractères minimum' : 'Votre mot de passe'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={isRegister ? 10 : 1}
                  maxLength={128}
                  disabled={submitting}
                />
              </span>
            </label>

            {isRegister && (
              <label className="auth-field">
                <span>Confirmer le mot de passe</span>
                <span className="auth-input">
                  <LockKeyhole size={17} aria-hidden="true" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Saisissez-le à nouveau"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    required
                    minLength={10}
                    maxLength={128}
                    disabled={submitting}
                  />
                </span>
              </label>
            )}

            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting
                ? <><LoaderCircle className="spin" size={17} /> Patientez…</>
                : <>{isRegister ? 'Créer mon compte' : 'Continuer avec l’e-mail'} <ArrowRight size={17} /></>}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? 'Vous avez déjà un compte ?' : 'Pas encore de compte ?'}{' '}
            <a href={isRegister ? '/login' : '/register'}>
              {isRegister ? 'Se connecter' : 'Créer un compte'}
            </a>
          </p>
          {firebaseConfigMessage && <p className="auth-setup-note" role="status">{firebaseConfigMessage}</p>}
          {firebaseConfigured && <p className="auth-note"><LockKeyhole size={13} /> Connexion sécurisée par Firebase.</p>}
          <p className="auth-legal">
            En continuant, vous acceptez les <a href="#conditions">Conditions</a> et la{' '}
            <a href="#confidentialite">Politique de confidentialité</a>.
          </p>
        </article>
      </section>
      <footer>GemClip <span>·</span> Vos vidéos sont traitées par GemClip.</footer>
    </main>
  )
}

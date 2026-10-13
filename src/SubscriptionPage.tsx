import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Clapperboard, ShieldCheck } from 'lucide-react'
import type { User } from 'firebase/auth'
import { getFirebaseAuth } from './firebase'

type PayPalConfig = {
  client_id: string
  plan_id: string
  price: string
  currency: string
}

type PayPalActions = {
  subscription: {
    create: (options: { plan_id: string; custom_id: string }) => Promise<string>
  }
}

type PayPalButtons = {
  render: (container: HTMLElement) => Promise<void>
}

type PayPalNamespace = {
  Buttons: (options: {
    style: { layout: string; shape: string; label: string; color: string }
    createSubscription: (_data: unknown, actions: PayPalActions) => Promise<string>
    onApprove: (data: { subscriptionID: string }) => Promise<void>
    onCancel: () => void
    onError: (error: unknown) => void
  }) => PayPalButtons
}

declare global {
  interface Window {
    paypal?: PayPalNamespace
  }
}

function responseError(detail: unknown, status: number): string {
  return typeof detail === 'string' && detail.trim()
    ? detail
    : `Le serveur a répondu ${status}.`
}

export default function SubscriptionPage({ user }: { user: User }) {
  const buttonContainer = useRef<HTMLDivElement>(null)
  const [config, setConfig] = useState<PayPalConfig | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadConfig() {
      try {
        const response = await fetch('/api/paypal/config')
        const result = await response.json()
        if (!response.ok) throw new Error(responseError(result.detail, response.status))
        if (!cancelled) setConfig(result as PayPalConfig)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Impossible de charger PayPal.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadConfig()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!config || !buttonContainer.current) return
    let cancelled = false
    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.client_id)}&vault=true&intent=subscription&components=buttons`
    script.async = true
    script.dataset.clipflowPaypal = 'true'
    script.dataset.sdkIntegrationSource = 'button-factory'
    script.onload = () => {
      if (cancelled || !window.paypal || !buttonContainer.current) return
      const buttons = window.paypal.Buttons({
        style: { layout: 'horizontal', shape: 'pill', color: 'black', label: 'paypal' },
        createSubscription: (_data, actions) => actions.subscription.create({
          plan_id: config.plan_id,
          custom_id: user.uid,
        }),
        onApprove: async ({ subscriptionID }) => {
          setProcessing(true)
          setError('')
          try {
            const currentUser = getFirebaseAuth().currentUser
            if (!currentUser || currentUser.uid !== user.uid) {
              throw new Error('Connectez-vous pour vérifier votre abonnement.')
            }
            const token = await currentUser.getIdToken()
            const response = await fetch('/api/paypal/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ subscription_id: subscriptionID }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(responseError(result.detail, response.status))
            setMessage('Votre abonnement ClipFlow AI est actif. Vous avez maintenant 100 jetons par jour.')
          } catch (verifyError) {
            setError(verifyError instanceof Error ? verifyError.message : 'La vérification PayPal a échoué.')
          } finally {
            setProcessing(false)
          }
        },
        onCancel: () => setMessage('Paiement annulé. Aucun abonnement n’a été activé.'),
        onError: (paypalError) => {
          setError(paypalError instanceof Error ? paypalError.message : 'PayPal n’a pas pu démarrer le paiement.')
          setProcessing(false)
        },
      })
      void buttons.render(buttonContainer.current).catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : 'Impossible d’afficher les boutons PayPal.')
        }
      })
    }
    script.onerror = () => {
      if (!cancelled) setError('Le SDK PayPal ne peut pas être chargé. Vérifiez votre connexion Internet.')
    }
    document.head.appendChild(script)
    return () => {
      cancelled = true
      script.remove()
      if (buttonContainer.current) buttonContainer.current.replaceChildren()
    }
  }, [config])

  return (
    <main className="app-shell subscription-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Retour à ClipFlow AI">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>clipflow<span className="brand-ai">.ai</span></span>
        </a>
        <a className="subscription-back" href="/"><ArrowLeft size={15} /> Retour</a>
      </header>

      <section className="subscription-content">
        <article className="subscription-card">
          {message.startsWith('Votre abonnement') ? (
            <div className="subscription-confirmation" role="status">
              <span className="subscription-icon"><Check size={24} /></span>
              <h1>Abonnement activé</h1>
              <p>{message}</p>
              <a className="subscription-continue" href="/">Continuer vers ClipFlow AI</a>
            </div>
          ) : (
            <>
              <span className="subscription-icon"><Clapperboard size={23} /></span>
              <p className="subscription-eyebrow">CLIPFLOW AI · PREMIUM</p>
              <h1>Un Short, en quelques clics.</h1>
              <p className="subscription-intro">Accédez à la création vidéo assistée par IA avec une facturation simple, chaque mois.</p>

              <div className="subscription-price">
                <strong>5,99&nbsp;$</strong><span>USD / mois</span>
              </div>

              <ul className="subscription-benefits">
                <li><Check size={16} /> Création de clips assistée par IA</li>
                <li><Check size={16} /> Recadrage et sous-titres automatiques</li>
                <li><Check size={16} /> 100 jetons de création renouvelés chaque jour</li>
                <li><Check size={16} /> Facturation récurrente mensuelle</li>
              </ul>

              <div className="paypal-buttons" ref={buttonContainer} />
              {loading && <p className="subscription-status">Chargement du paiement sécurisé…</p>}
              {processing && <p className="subscription-status">Vérification de votre abonnement…</p>}
              {message && <p className="subscription-status" role="status">{message}</p>}
              {error && <p className="subscription-error" role="alert">{error}</p>}

              <p className="subscription-legal">
                Paiement traité de manière sécurisée par PayPal. L’abonnement est renouvelé automatiquement chaque mois ; vous pouvez le gérer ou l’annuler depuis votre compte PayPal.
              </p>
              <p className="subscription-secure"><ShieldCheck size={14} /> Vos données de paiement ne sont pas stockées par ClipFlow AI.</p>
            </>
          )}
        </article>
      </section>
      <footer>ClipFlow AI <span>·</span> Paiement sécurisé avec PayPal</footer>
    </main>
  )
}

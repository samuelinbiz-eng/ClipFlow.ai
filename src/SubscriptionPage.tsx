import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Clapperboard, ShieldCheck } from 'lucide-react'
import type { User } from 'firebase/auth'
import { getFirebaseAuth, getFirebaseFirestore } from './firebase'
import { doc, setDoc } from 'firebase/firestore'
import { apiUrl } from './api'

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
  const formattedPrice = config && Number.isFinite(Number(config.price))
    ? new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: config.currency,
    }).format(Number(config.price))
    : '—'

  useEffect(() => {
    let cancelled = false
    async function loadConfig() {
      try {
        const response = await fetch(apiUrl('/api/paypal/config'))
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
    script.dataset.gemclipPaypal = 'true'
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
            const response = await fetch(apiUrl('/api/paypal/verify'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ subscription_id: subscriptionID }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(responseError(result.detail, response.status))
            try {
              const db = getFirebaseFirestore()
              await setDoc(
                doc(db, 'users', user.uid),
                { plan: 'plus', updatedAt: new Date().toISOString() },
                { merge: true },
              )
            } catch (firestoreErr) {
              console.warn('Firestore plan sync warning:', firestoreErr)
            }
            setMessage('Votre abonnement GemClip est actif. Vous avez maintenant 100 jetons par jour.')
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
        <a className="brand" href="/" aria-label="Retour à GemClip">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>GemClip</span>
        </a>
        <a className="subscription-back" href="/"><ArrowLeft size={15} /> Retour</a>
      </header>

      <section className="subscription-content">
        {message.startsWith('Votre abonnement') ? (
          <article className="subscription-card subscription-confirmation-card">
            <div className="subscription-confirmation" role="status">
              <span className="subscription-icon"><Check size={24} /></span>
              <h1>Abonnement activé</h1>
              <p>{message}</p>
              <a className="subscription-continue" href="/">Continuer vers GemClip</a>
            </div>
          </article>
        ) : (
          <div className="subscription-page">
            <header className="subscription-hero">
              <span className="subscription-badge"><span /> GemClip Plus</span>
              <h1>Publiez tous les jours.<br />Sans compter.</h1>
              <p>100 jetons par jour. La durée et la qualité choisies déterminent le coût de chaque Short.</p>
            </header>

            <div className="subscription-plans">
              <article className="plan-card plan-free">
                <span className="plan-label">Gratuit</span>
                <strong className="plan-price">0&nbsp;$</strong>
                <p>10 jetons offerts chaque jour pour essayer GemClip.</p>
                <ul>
                  <li><Check size={16} /> Sélection d’extrait par IA</li>
                  <li><Check size={16} /> Sous-titres configurables</li>
                  <li><Check size={16} /> Export vidéo MP4</li>
                </ul>
                <a className="plan-secondary-button" href="/">Continuer gratuitement</a>
              </article>

              <article className="plan-card plan-plus">
                <span className="plan-recommended">Recommandé</span>
                <span className="plan-label">Plus</span>
                <div className="plan-price-row">
                  <strong className="plan-price">{formattedPrice}</strong>
                  <span>/ mois</span>
                </div>
                <p>100 jetons renouvelés chaque jour.</p>
                <ul>
                  <li><Check size={16} /> Jusqu’à 100 jetons par jour</li>
                  <li><Check size={16} /> Choix de la durée et de la qualité</li>
                  <li><Check size={16} /> Couleur, taille, police et position des sous-titres</li>
                  <li><Check size={16} /> Téléchargement MP4</li>
                </ul>

                <div className="paypal-buttons" id="paypal-buttons" ref={buttonContainer} />
                {loading && <p className="subscription-status">Chargement du paiement sécurisé…</p>}
                {processing && <p className="subscription-status">Vérification de votre abonnement…</p>}
                {message && <p className="subscription-status" role="status">{message}</p>}
                {error && <p className="subscription-error" role="alert">{error}</p>}
                <p className="subscription-legal">
                  Abonnement mensuel récurrent traité par PayPal. Gérez ou annulez votre abonnement depuis votre compte PayPal.
                </p>
                <p className="subscription-secure"><ShieldCheck size={14} /> GemClip ne stocke pas vos données de paiement.</p>
              </article>
            </div>

            <section className="subscription-unlocks" aria-labelledby="unlocks-heading">
              <h2 id="unlocks-heading">Ce que vous débloquez.</h2>
              <div className="subscription-benefit-grid">
                <article><strong>100</strong><h3>jetons par jour</h3><p>Le coût d’un Short dépend de sa durée et de sa résolution.</p></article>
                <article><strong>9:16</strong><h3>format vertical</h3><p>Choisissez le format de sortie adapté à votre vidéo.</p></article>
                <article><strong>MP4</strong><h3>prêt à télécharger</h3><p>Récupérez vos créations terminées depuis l’historique.</p></article>
              </div>
            </section>

            <section className="subscription-faq" aria-labelledby="faq-heading">
              <h2 id="faq-heading">Questions fréquentes.</h2>
              <details>
                <summary>Comment sont utilisés les jetons&nbsp;?</summary>
                <p>Chaque création consomme un nombre de jetons calculé selon la durée et la résolution sélectionnées.</p>
              </details>
              <details>
                <summary>Quand les jetons sont-ils renouvelés&nbsp;?</summary>
                <p>Le quota quotidien est renouvelé selon l’heure de réinitialisation indiquée dans votre espace GemClip.</p>
              </details>
              <details>
                <summary>Comment gérer mon abonnement&nbsp;?</summary>
                <p>Le paiement récurrent est géré par PayPal. Vous pouvez gérer ou annuler l’abonnement depuis votre compte PayPal.</p>
              </details>
            </section>

            <aside className="subscription-cta">
              <div><h2>Votre prochain Short vous attend.</h2><p>{formattedPrice} par mois · Facturation sécurisée avec PayPal.</p></div>
              <a href="#paypal-buttons">Passer à Plus</a>
            </aside>
          </div>
        )}
      </section>
      <footer>GemClip <span>·</span> Paiement sécurisé avec PayPal</footer>
    </main>
  )
}

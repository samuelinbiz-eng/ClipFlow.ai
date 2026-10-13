import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDPWursRFOSNwg8jiIC79cfM_53WpfhV2s',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'clipflow-ai-bba29.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'clipflow-ai-bba29',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:482233779109:web:3b73c3c61030ae16e2de4c',
}

const requiredConfig = [
  [firebaseConfig.apiKey, 'VITE_FIREBASE_API_KEY'],
  [firebaseConfig.authDomain, 'VITE_FIREBASE_AUTH_DOMAIN'],
  [firebaseConfig.projectId, 'VITE_FIREBASE_PROJECT_ID'],
  [firebaseConfig.appId, 'VITE_FIREBASE_APP_ID'],
] as const
const missingConfig = requiredConfig
  .filter(([value]) => !value?.trim())
  .map(([, name]) => name)

export const firebaseConfigured = missingConfig.length === 0
export const firebaseConfigMessage = firebaseConfigured
  ? ''
  : `Firebase incomplet : renseignez dans .env : ${missingConfig.join(', ')}.`

export function getFirebaseAuth() {
  if (!firebaseConfigured) throw new Error(firebaseConfigMessage)
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  return getAuth(app)
}

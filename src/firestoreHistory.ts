import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { getFirebaseFirestore } from './firebase'

export type TaskStatus = 'queued' | 'processing' | 'review' | 'completed' | 'failed'

export type ShortRecord = {
  task_id: string
  status: TaskStatus
  progress: number
  stage: string
  error: string | null
  video_url: string | null
  titre: string | null
  explication: string | null
  source: string
  duration_seconds: number
  resolution: number
  aspect_ratio: string
  subtitles: boolean
  subtitle_color: string
  subtitle_size: string
  subtitle_position: string
  subtitle_font: string
  credit_cost: number
  created_at: string
  updated_at: string
}

function cleanRecord(record: Partial<ShortRecord>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      clean[key] = value
    }
  }
  return clean
}

/**
 * Synchronise le profil utilisateur dans la collection /users/{userId}
 */
export async function syncUserProfile(user: User): Promise<void> {
  try {
    const db = getFirebaseFirestore()
    const userRef = doc(db, 'users', user.uid)
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        lastLoginAt: new Date().toISOString(),
      },
      { merge: true },
    )
  } catch (err) {
    console.warn('Impossible de synchroniser le profil utilisateur dans Firestore :', err)
  }
}

/**
 * Enregistre ou met à jour un Short dans la sous-collection /users/{userId}/shorts/{taskId}
 */
export async function saveShortToFirestore(
  userId: string,
  short: Partial<ShortRecord> & { task_id: string },
): Promise<void> {
  if (!userId || !short.task_id) return
  const db = getFirebaseFirestore()
  const shortRef = doc(db, 'users', userId, 'shorts', short.task_id)

  const payload: Partial<ShortRecord> = {
    ...short,
    updated_at: new Date().toISOString(),
  }
  if (!payload.created_at) {
    payload.created_at = new Date().toISOString()
  }

  await setDoc(shortRef, cleanRecord(payload), { merge: true })
}

/**
 * Supprime un Short de l'historique Firestore de l'utilisateur
 */
export async function deleteShortFromFirestore(
  userId: string,
  taskId: string,
): Promise<void> {
  if (!userId || !taskId) return
  const db = getFirebaseFirestore()
  const shortRef = doc(db, 'users', userId, 'shorts', taskId)
  await deleteDoc(shortRef)
}

/**
 * Écoute en temps réel l'historique des Shorts de l'utilisateur dans Firestore
 */
export function subscribeUserShorts(
  userId: string,
  onUpdate: (entries: ShortRecord[]) => void,
  onError: (error: Error) => void,
): () => void {
  const db = getFirebaseFirestore()
  const shortsRef = collection(db, 'users', userId, 'shorts')
  const q = query(shortsRef, orderBy('created_at', 'desc'))

  return onSnapshot(
    q,
    (snapshot) => {
      const records: ShortRecord[] = []
      snapshot.forEach((item) => {
        const data = item.data()
        records.push({
          task_id: data.task_id || item.id,
          status: data.status || 'completed',
          progress: typeof data.progress === 'number' ? data.progress : 100,
          stage: data.stage || '',
          error: data.error ?? null,
          video_url: data.video_url ?? null,
          titre: data.titre ?? data.title ?? null,
          explication: data.explication ?? data.explanation ?? null,
          source: data.source || 'Vidéo',
          duration_seconds: Number(data.duration_seconds) || 45,
          resolution: Number(data.resolution) || 1080,
          aspect_ratio: data.aspect_ratio || '9:16',
          subtitles: Boolean(data.subtitles),
          subtitle_color: data.subtitle_color || 'yellow',
          subtitle_size: data.subtitle_size || 'medium',
          subtitle_position: data.subtitle_position || 'bottom',
          subtitle_font: data.subtitle_font || 'Arial',
          credit_cost: Number(data.credit_cost) || 0,
          created_at: data.created_at || new Date().toISOString(),
          updated_at: data.updated_at || data.created_at || new Date().toISOString(),
        })
      })
      onUpdate(records)
    },
    (err) => {
      // Si l'index orderBy created_at n'est pas encore disponible, tenter une requête simple sans tri
      console.warn('Erreur sur orderBy created_at, tentative de requête sans tri :', err)
      const fallbackQuery = collection(db, 'users', userId, 'shorts')
      return onSnapshot(
        fallbackQuery,
        (snapshot) => {
          const records: ShortRecord[] = []
          snapshot.forEach((item) => {
            const data = item.data()
            records.push({
              task_id: data.task_id || item.id,
              status: data.status || 'completed',
              progress: typeof data.progress === 'number' ? data.progress : 100,
              stage: data.stage || '',
              error: data.error ?? null,
              video_url: data.video_url ?? null,
              titre: data.titre ?? data.title ?? null,
              explication: data.explication ?? data.explanation ?? null,
              source: data.source || 'Vidéo',
              duration_seconds: Number(data.duration_seconds) || 45,
              resolution: Number(data.resolution) || 1080,
              aspect_ratio: data.aspect_ratio || '9:16',
              subtitles: Boolean(data.subtitles),
              subtitle_color: data.subtitle_color || 'yellow',
              subtitle_size: data.subtitle_size || 'medium',
              subtitle_position: data.subtitle_position || 'bottom',
              subtitle_font: data.subtitle_font || 'Arial',
              credit_cost: Number(data.credit_cost) || 0,
              created_at: data.created_at || new Date().toISOString(),
              updated_at: data.updated_at || data.created_at || new Date().toISOString(),
            })
          })
          records.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
          onUpdate(records)
        },
        onError,
      )
    },
  )
}

/**
 * Synchronise les créations existantes vers Firestore si elles ne s'y trouvent pas déjà
 */
export async function syncExistingEntriesToFirestore(
  userId: string,
  entries: ShortRecord[],
): Promise<void> {
  if (!userId || entries.length === 0) return
  const db = getFirebaseFirestore()
  const shortsRef = collection(db, 'users', userId, 'shorts')
  try {
    const existingSnap = await getDocs(shortsRef)
    const existingIds = new Set<string>()
    existingSnap.forEach((item) => existingIds.add(item.id))

    for (const entry of entries) {
      if (!existingIds.has(entry.task_id)) {
        await saveShortToFirestore(userId, entry)
      }
    }
  } catch (err) {
    console.warn('Impossible de synchroniser les anciennes entrées vers Firestore :', err)
  }
}

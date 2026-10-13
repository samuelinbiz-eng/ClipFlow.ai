# ClipFlow AI

Application locale qui sélectionne un extrait YouTube, le recadre en Short vertical et génère des sous-titres mot à mot.

## Prérequis

- Python 3.12 (recommandé ; Python 3.15 peut casser la compilation de `pyyaml` dans `uvicorn`)
- Node.js 18+
- FFmpeg et `ffprobe` accessibles depuis le `PATH` (avec le filtre `subtitles`/libass)
- Une clé API Groq

## Installation

À la racine du projet :

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install --upgrade pip setuptools wheel Cython
py -m pip install -r backend\requirements.txt
npm install
Copy-Item .env.example .env
```

Renseignez `GROQ_API_KEY` dans `.env`. Le modèle Groq peut être changé avec `GROQ_MODEL` (par défaut `openai/gpt-oss-120b`). Le modèle Whisper `tiny` est utilisé par défaut ; configurez `WHISPER_MODEL=small` pour une meilleure précision au prix d'un traitement plus long et plus gourmand.

### Firebase Authentication

Les pages `/register` et `/login` proposent la connexion ou création de compte par Google, ainsi que l'e-mail et le mot de passe, via le projet Firebase Web `clipflow-ai-bba29` configuré par défaut. Dans Firebase Console, sélectionnez ce projet, activez **Authentication > Sign-in method > Google** et, si souhaité, **Email/Password**, puis ajoutez `localhost` et `127.0.0.1` aux domaines autorisés.

La configuration Web partagée est intégrée au frontend ; les variables `VITE_FIREBASE_*` du `.env` peuvent la remplacer si nécessaire. L'API key Firebase Web et les identifiants du client Web ne sont pas des clés de compte de service. Analytics n'est pas nécessaire à la connexion et n'est pas chargé.

Le backend vérifie cryptographiquement chaque jeton Firebase ID avec les clés publiques Google avant d'accepter les créations et consultations de Shorts. Si des identifiants ADC sont disponibles, il vérifie également la révocation et la désactivation des comptes. Pour ces contrôles supplémentaires, configurez `GOOGLE_APPLICATION_CREDENTIALS` vers un fichier de compte de service ou `FIREBASE_SERVICE_ACCOUNT_JSON` ; gardez ces identifiants privés et ne les commitez jamais. Le backend utilise `clipflow-ai-bba29` par défaut ; `FIREBASE_PROJECT_ID` permet de le remplacer.

La page `/subscribe` utilise le bouton PayPal fourni et le plan `P-5DV679072B532735YNLGQKHY` par défaut. Renseignez `PAYPAL_CLIENT_SECRET` dans `.env` avec le secret de l'application associée au client ID, sans le publier ni le partager. Configurez `PAYPAL_ENVIRONMENT` selon que ces identifiants et ce plan appartiennent à Sandbox ou à Live. Le serveur vérifie l'abonnement approuvé auprès de PayPal et le lie au compte Firebase qui l'a souscrit ; le statut est revérifié avant d'accorder les avantages Plus.

### Jetons de création

Chaque compte reçoit 10 jetons par jour ; un abonnement Plus PayPal actif en donne 100. Une création coûte `plafond(durée en secondes / 30)` jetons, plus 1 jeton en 1080p (720p n'a pas de supplément). Les jetons se réinitialisent à minuit UTC. Ils sont réservés au lancement du traitement, consommés si la création réussit et remboursés automatiquement si elle échoue. Les soldes, abonnements et réservations sont conservés dans `backend/data/credits.sqlite3` (ignoré par Git) ; `CREDITS_DATABASE_PATH` peut remplacer cet emplacement.

## Démarrage

Dans un terminal, lancez le backend :

```powershell
uvicorn backend.main:app --reload --port 8000
```

Dans un autre terminal, démarrez l'interface Vite :

```powershell
npm run dev
```

Ouvrez l'adresse Vite affichée dans le terminal. Le proxy transmet `/api` et `/output` à FastAPI. Le premier lancement de Whisper télécharge le modèle choisi ; il peut donc prendre plus de temps.

Vous pouvez coller un lien YouTube ou importer une vidéo locale (MP4, MOV, MKV, WEBM, AVI ou MPEG, jusqu'à 2 Go). Whisper lit directement la piste audio de la vidéo, évitant un téléchargement audio ou une conversion MP3 intermédiaire. Au montage, OpenCV suit le visage échantillonné dans l'extrait pour le recadrage vertical; si aucun visage n'est détecté, le cadrage reste centré. FFmpeg conserve et synchronise la piste audio originale dans le Short.

Les médias temporaires sont stockés dans `backend/temp/` pendant le traitement. Les Shorts générés et les fichiers `.ass` restent dans `backend/output/`, servis par FastAPI sous `/output`.

L'abonnement PayPal est vérifié côté serveur après approbation. Les paiements récurrents, renouvellements et annulations sont gérés dans le compte PayPal de l'abonné.

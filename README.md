# GemClip

GemClip sélectionne un extrait YouTube ou importé, le recadre en Short vertical et génère des sous-titres mot à mot.

## Prérequis

- Python 3.12 (recommandé ; Python 3.15 peut casser la compilation de `pyyaml` dans `uvicorn`)
- Node.js 20.19+ ou 22.12+ (requis par Vite 8)
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

Les pages `/register` et `/login` proposent la connexion ou création de compte par Google, ainsi que l'e-mail et le mot de passe, via le projet Firebase Web `clipflow-ai-bba29` configuré par défaut. Cet identifiant est celui du projet Firebase existant ; le nom visible de l'application est GemClip. Dans Firebase Console, sélectionnez ce projet, activez **Authentication > Sign-in method > Google** et, si souhaité, **Email/Password**, puis ajoutez `localhost` et `127.0.0.1` aux domaines autorisés.

La configuration Web partagée est intégrée au frontend ; les variables `VITE_FIREBASE_*` du `.env` peuvent la remplacer si nécessaire. L'API key Firebase Web et les identifiants du client Web ne sont pas des clés de compte de service. Analytics n'est pas nécessaire à la connexion et n'est pas chargé.

Le backend vérifie cryptographiquement chaque jeton Firebase ID avec les clés publiques Google avant d'accepter les créations et consultations de Shorts. Si des identifiants ADC sont disponibles, il vérifie également la révocation et la désactivation des comptes. Pour ces contrôles supplémentaires, configurez `GOOGLE_APPLICATION_CREDENTIALS` vers un fichier de compte de service ou `FIREBASE_SERVICE_ACCOUNT_JSON` ; gardez ces identifiants privés et ne les commitez jamais. Le backend utilise `clipflow-ai-bba29` par défaut ; `FIREBASE_PROJECT_ID` permet de le remplacer.

La page `/subscribe` utilise le bouton PayPal fourni et le plan `P-5DV679072B532735YNLGQKHY` par défaut. Renseignez `PAYPAL_CLIENT_SECRET` dans `.env` avec le secret de l'application associée au client ID, sans le publier ni le partager. Configurez `PAYPAL_ENVIRONMENT` selon que ces identifiants et ce plan appartiennent à Sandbox ou à Live. Le serveur vérifie l'abonnement approuvé auprès de PayPal et le lie au compte Firebase qui l'a souscrit ; le statut est revérifié avant d'accorder les avantages Plus.

### Jetons de création

Chaque compte reçoit 10 jetons par jour ; un abonnement Plus PayPal actif en donne 100. Une création coûte `plafond(durée en secondes / 30)` jetons, plus 1 jeton en 1080p (720p n'a pas de supplément). Les jetons se réinitialisent à minuit UTC. Ils sont réservés au lancement du traitement, consommés si la création réussit et remboursés automatiquement si elle échoue. Les soldes, abonnements et réservations sont conservés dans `backend/data/credits.sqlite3` (ignoré par Git) ; `CREDITS_DATABASE_PATH` peut remplacer cet emplacement.

### Historique et sous-titres

L'éditeur conserve les 50 dernières créations du compte connecté dans le même stockage SQLite : source, statut, durée, résolution, jetons dépensés et lien de téléchargement pour les vidéos terminées. L'historique reste disponible après rechargement ou redémarrage du backend.

Dans **Options > Personnaliser le format et les sous-titres**, choisissez la taille (très petite à très grande), une police (Arial, DejaVu Sans, Liberation Sans ou Noto Sans), une couleur personnalisée et la position (haut, centre ou bas). L'aperçu reflète les choix de police, de taille et de couleur ; ces réglages sont appliqués au rendu ASS/FFmpeg et mémorisés avec chaque création.

## Démarrage

Dans un terminal, lancez le backend :

```powershell
uvicorn backend.main:app --reload --port 8000
```

Dans un autre terminal, démarrez l'interface Vite :

```powershell
npm run dev
```

Ouvrez l'adresse Vite affichée dans le terminal. La page publique `/` présente GemClip ; connectez-vous ou inscrivez-vous pour accéder à l'éditeur. En local, le proxy Vite transmet `/api` et `/output` à FastAPI. Le premier lancement de Whisper télécharge le modèle choisi ; il peut donc prendre plus de temps.

Vous pouvez coller un lien YouTube ou importer une vidéo locale (MP4, MOV, MKV, WEBM, AVI ou MPEG, jusqu'à 2 Go). Whisper lit directement la piste audio de la vidéo, évitant un téléchargement audio ou une conversion MP3 intermédiaire. Au montage, OpenCV suit le visage échantillonné dans l'extrait pour le recadrage vertical; si aucun visage n'est détecté, le cadrage reste centré. FFmpeg conserve et synchronise la piste audio originale dans le Short.

En local, les médias temporaires sont stockés dans `backend/temp/` et les Shorts terminés dans `backend/output/`. `MEDIA_STORAGE_PATH` permet de déplacer ces répertoires sur un disque persistant. Les vidéos sont téléchargées par une route API authentifiée et ne sont pas exposées sous un répertoire statique public.

L'abonnement PayPal est vérifié côté serveur après approbation. Les paiements récurrents, renouvellements et annulations sont gérés dans le compte PayPal de l'abonné.

## Publication

Le frontend est conçu pour Vercel et le backend vidéo pour un service Docker Render avec un disque persistant. Le traitement utilise FFmpeg, Whisper, des tâches longues, SQLite et des fichiers locaux ; il ne doit pas être hébergé dans une fonction serverless éphémère.

1. Importez le dépôt GitHub dans Render avec le Blueprint `render.yaml`. Le service nécessite une instance payante et crée un disque persistant de 10 Go ; vérifiez les tarifs Render avant de confirmer. Le Blueprint demandera les valeurs secrètes.
2. Dans Render, configurez `GROQ_API_KEY`, `PAYPAL_ENVIRONMENT=live`, le `PAYPAL_CLIENT_ID`, le `PAYPAL_CLIENT_SECRET` et le `PAYPAL_PLAN_ID` provenant de la même application et du même environnement PayPal. Le plan doit correspondre au prix et à la devise annoncés. Ne réutilisez pas les identifiants Sandbox pour les paiements réels.
3. Notez l'URL HTTPS attribuée au service Render. Dans Vercel, importez le dépôt avec sa racine à la racine du projet, la commande `npm run build` et le répertoire de sortie `dist`. Configurez `VITE_API_BASE_URL` avec l'origine Render, par exemple `https://gemclip-api.onrender.com`, puis redéployez le frontend. Le frontend affiche une erreur explicite si cette variable est absente. Définissez aussi `CORS_ORIGINS` dans Render sur l'origine Vercel exacte ; ajoutez le domaine personnalisé et l'origine locale si nécessaire.
4. Dans Firebase Console, activez les fournisseurs d'authentification voulus, ajoutez les domaines Vercel autorisés et publiez les règles de `firestore.rules`. Gardez les secrets Firebase Admin et PayPal dans les variables du service, jamais dans Vercel ou le dépôt.
5. Vérifiez `https://<service-render>/api/health`, les parcours inscription/connexion, création et téléchargement d'une vidéo, l'historique après redémarrage, ainsi qu'un paiement PayPal réel avant d'annoncer le service.

Les créations restent sur le disque Render ; surveillez son espace disponible et mettez en place une politique de conservation/sauvegarde avant d'ouvrir le service à grande échelle. Le disque ne remplace pas un stockage objet ni une sauvegarde.

Avant la publication publique, ajoutez et faites vérifier les pages de confidentialité, conditions d'utilisation, traitement/suppression des vidéos et modalités d'abonnement/résiliation adaptées à votre activité et à votre juridiction. Configurez également un domaine public et vérifiez que le déploiement Vercel est effectivement actif.

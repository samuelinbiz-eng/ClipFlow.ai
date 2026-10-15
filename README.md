# GemClip

GemClip est un studio web francophone pour transformer une vidéo en Short vertical. Le parcours principal est actuellement un prototype de génération simulée ; l'ancienne interface de traitement réel reste accessible séparément.

## Interface prototype

Après connexion Firebase (`/login` ou `/register`), l'application ouvre le studio prototype React. Sa génération est simulée par `src/apiMock.ts` : elle affiche les étapes puis un aperçu graphique, sans télécharger ni traiter le média. L'export MP4, le partage vidéo, la traduction et le paiement Plus ne sont pas encore raccordés ; leurs points d'intégration sont marqués `TODO` dans le code. Ne présentez pas cet aperçu comme un fichier vidéo généré et ne procédez pas à un paiement réel.

Les jetons, l'historique, l'écran courant et le profil d'affichage sont conservés dans le `localStorage` de l'appareil. Les constantes de l'offre prototype (`FREE_TOKENS`, `SHORT_COST`, `PLUS_TOKENS` et `PLUS_PRICE`) sont définies dans `src/StudioApp.tsx`. Les mentions `[X]` et `[À CONFIRMER]` restent des champs à configurer.

L'ancienne interface liée au traitement réel reste accessible après connexion via `/legacy`. Elle nécessite le backend et les services configurés ci-dessous ; ses règles de crédits et son paiement sont distincts du prototype.

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
py -m pip install -r backend\worker-requirements.txt
npm install
Copy-Item .env.example .env
```

Renseignez `GROQ_API_KEY` dans `.env`. Le modèle Groq peut être changé avec `GROQ_MODEL` (par défaut `openai/gpt-oss-120b`). Le modèle Whisper `tiny` est utilisé par défaut ; configurez `WHISPER_MODEL=small` pour une meilleure précision au prix d'un traitement plus long et plus gourmand.

### Firebase Authentication

Les pages `/register` et `/login` proposent la connexion ou création de compte par Google, ainsi que l'e-mail et le mot de passe, via le projet Firebase Web `clipflow-ai-bba29` configuré par défaut. Cet identifiant est celui du projet Firebase existant ; le nom visible de l'application est GemClip. Dans Firebase Console, sélectionnez ce projet, activez **Authentication > Sign-in method > Google** et, si souhaité, **Email/Password**, puis ajoutez `localhost` et `127.0.0.1` aux domaines autorisés.

La configuration Web partagée est intégrée au frontend ; les variables `VITE_FIREBASE_*` du `.env` peuvent la remplacer si nécessaire. L'API key Firebase Web et les identifiants du client Web ne sont pas des clés de compte de service. Analytics n'est pas nécessaire à la connexion et n'est pas chargé.

Le backend vérifie cryptographiquement chaque jeton Firebase ID avec les clés publiques Google avant d'accepter les créations et consultations de Shorts. Si des identifiants ADC sont disponibles, il vérifie également la révocation et la désactivation des comptes. Pour ces contrôles supplémentaires, configurez `GOOGLE_APPLICATION_CREDENTIALS` vers un fichier de compte de service ou `FIREBASE_SERVICE_ACCOUNT_JSON` ; gardez ces identifiants privés et ne les commitez jamais. Le backend utilise `clipflow-ai-bba29` par défaut ; `FIREBASE_PROJECT_ID` permet de le remplacer.

Le prototype affiche une page d'offres sur `/subscribe` ; son action Plus est une simulation et n'appelle pas PayPal. Le backend conserve l'intégration PayPal pour l'ancienne interface : il utilise le plan `P-5DV679072B532735YNLGQKHY` par défaut. Renseignez `PAYPAL_CLIENT_SECRET` dans `.env` avec le secret de l'application associée au client ID, sans le publier ni le partager. Configurez `PAYPAL_ENVIRONMENT` selon que ces identifiants et ce plan appartiennent à Sandbox ou à Live. Le serveur vérifie l'abonnement approuvé auprès de PayPal et le lie au compte Firebase qui l'a souscrit ; le statut est revérifié avant d'accorder les avantages Plus.

### Jetons de création

Dans le prototype, le plan Gratuit démarre à 10 jetons et chaque Short simulé en coûte 3 ; Plus affiche 100 jetons quotidiens. Ce solde est local à l'appareil et l'activation Plus est simulée. Dans l'ancienne interface `/legacy`, les comptes reçoivent 10 jetons par jour ; un abonnement Plus PayPal actif en donne 100. Une création réelle coûte `plafond(durée en secondes / 30)` jetons, plus 1 jeton en 1080p (720p n'a pas de supplément). Les jetons se réinitialisent à minuit UTC. Ils sont réservés au lancement du traitement, consommés si la création réussit et remboursés automatiquement si elle échoue. En local, les données sont dans `backend/data/credits.sqlite3`; en ligne, elles sont conservées dans Neon PostgreSQL via `DATABASE_URL`.

### Historique et sous-titres

Dans le prototype, l'historique et les réglages sont conservés localement sur l'appareil. L'ancienne interface `/legacy` conserve les 50 dernières créations du compte connecté dans l'historique backend : source, statut, durée, résolution, jetons dépensés et lien de téléchargement pour les vidéos terminées. En ligne, cet historique est stocké dans Neon PostgreSQL.

Dans **Options > Personnaliser le format et les sous-titres**, choisissez la taille (très petite à très grande), une police (Arial, DejaVu Sans, Liberation Sans ou Noto Sans), une couleur personnalisée et la position (haut, centre ou bas). L'aperçu reflète les choix de police, de taille et de couleur ; ces réglages sont appliqués au rendu ASS/FFmpeg et mémorisés avec chaque création.

## Démarrage

Pour le studio prototype, le backend n'est pas nécessaire : démarrez seulement Vite :

```powershell
npm run dev
```

La page publique `/` mène à la connexion/inscription ; connectez-vous pour ouvrir le studio. Pour utiliser l'ancienne interface `/legacy`, lancez d'abord le backend dans un autre terminal :

```powershell
uvicorn backend.main:app --reload --port 8000
```

Dans un autre terminal, démarrez l'interface Vite pour accéder à l'ancienne interface :

```powershell
npm run dev
```

Ouvrez l'adresse Vite affichée dans le terminal. En local, le proxy Vite transmet `/api` et `/output` à FastAPI. Le premier lancement de Whisper télécharge le modèle choisi ; il peut donc prendre plus de temps.

Ces fonctions de traitement réel sont disponibles uniquement dans l'ancienne interface `/legacy`. Le studio prototype ne téléverse pas le fichier, ne télécharge pas le lien et ne traite pas la vidéo.

En local, les médias temporaires sont stockés dans `backend/temp/` et les Shorts terminés dans `backend/output/`. `MEDIA_STORAGE_PATH` permet de déplacer ces répertoires sur un disque persistant. Les vidéos sont téléchargées par une route API authentifiée et ne sont pas exposées sous un répertoire statique public.

L'abonnement PayPal est vérifié côté serveur après approbation. Les paiements récurrents, renouvellements et annulations sont gérés dans le compte PayPal de l'abonné.

## Publication avec GitHub et Vercel

Le déploiement utilise deux projets Vercel dans le même dépôt : `gemclip` (racine du dépôt, frontend Vite) et `backend` (répertoire `backend`, API FastAPI et fonction Node pour les jetons d'import Blob). `vercel.json` transmet `/api/*` du frontend à l'URL de production du projet backend. L'API et les médias ne sont pas réunis dans une seule fonction : le traitement vidéo s'exécute sur les runners GitHub Actions.

### Variables du backend Vercel

Reliez au projet backend le Blob privé Vercel et Neon PostgreSQL, puis configurez :

- `DATABASE_URL` : chaîne de connexion Neon.
- `GROQ_API_KEY` : clé utilisée par l'API pour l'analyse du transcript.
- `GEMCLIP_WORKER_SECRET` : secret aléatoire long, partagé uniquement avec le secret GitHub homonyme.
- `BLOB_READ_WRITE_TOKEN` : jeton Blob nécessaire à l'import navigateur et au backend.
- Les variables Firebase Admin et PayPal utilisées par les parcours existants (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PLAN_ID`, `PAYPAL_ENVIRONMENT`).

N'ajoutez pas ces valeurs dans les fichiers suivis par Git. Laissez `VITE_API_BASE_URL` vide dans le frontend de production : la règle de réécriture du dépôt utilise l'API backend. Vérifiez `https://<domaine-backend>/api/health`.

### Secrets du worker GitHub Actions

Dans les paramètres du dépôt GitHub, ajoutez ces secrets Actions :

- `GEMCLIP_API_URL` : origine HTTPS du backend, sans `/api` à la fin.
- `GEMCLIP_WORKER_SECRET` : même valeur que dans le backend Vercel.
- `BLOB_READ_WRITE_TOKEN` : jeton de lecture/écriture du Blob privé relié au backend.

Le workflow `.github/workflows/gemclip-worker.yml` se lance toutes les cinq minutes ou manuellement. Il traite la file persistante Neon avec Whisper, FFmpeg et le SDK Blob ; il ne transmet pas l'audio à Groq. Les vidéos source sont conservées au plus 24 heures et les Shorts terminés 30 jours. Les limites de ce mode d'essai sont 250 Mo par import, 100 Mo par Short et 750 Mo de stockage réservé au total. Le nettoyage est exécuté par le worker.

Les runners GitHub Actions standard sont gratuits pour les dépôts publics. Les limites d'usage de Vercel Hobby et de Blob restent applicables ; surveillez les quotas et ne présentez pas cette configuration de test comme une garantie de disponibilité ou comme une offre commerciale prête à l'échelle.

Avant une publication commerciale, faites vérifier les pages de confidentialité, les conditions d'utilisation, la politique de suppression des vidéos et les modalités d'abonnement/résiliation adaptées à votre activité et à votre juridiction. Après configuration des secrets, vérifiez l'import privé, la création depuis YouTube, le rendu, le téléchargement authentifié, le nettoyage et le déploiement des deux projets.

# Pinta

Diagnostic de maturité IA pour entreprises BTP.

## Stack

- **Frontend** : React + Vite + Tailwind CSS
- **Backend** : Firebase Firestore
- **Déploiement** : Vercel

## Installation

```bash
# Cloner le repo
git clone https://github.com/ton-username/pinta.git
cd pinta

# Installer les dépendances
npm install

# Configurer Firebase
cp .env.example .env.local
# Éditer .env.local avec tes clés Firebase

# Lancer en dev
npm run dev
```

## Configuration Firebase

1. Créer un projet sur [Firebase Console](https://console.firebase.google.com/)
2. Activer Firestore Database
3. Créer une application Web
4. Copier les clés dans `.env.local`

### Règles Firestore (à mettre dans la console Firebase)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /diagnostics/{docId} {
      allow create: if true;
      allow read, update, delete: if false;
    }
  }
}
```

## Déploiement Vercel

1. Connecter le repo GitHub à Vercel
2. Ajouter les variables d'environnement dans Vercel :
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Déployer

## Structure

```
pinta/
├── src/
│   ├── components/
│   │   ├── steps/          # Composants par étape
│   │   └── ui/             # Composants réutilisables
│   ├── config/
│   │   └── firebase.js     # Config Firebase
│   ├── hooks/              # Custom hooks
│   ├── utils/              # Validation, constantes
│   ├── App.jsx
│   └── main.jsx
├── .env.example
└── package.json
```

## Données collectées

Les diagnostics sont stockés dans Firestore collection `diagnostics` avec :
- Identité entreprise (nom, SIRET, contact)
- Répartition activité BTP
- Dépendance marchés publics
- Priorités stratégiques
- Maturité data/tech
- Priorisation IA

## Licence

Propriétaire - Tous droits réservés

# BookNest - Firebase + Tailwind Book Website

This is a simple book website where users can:

- Sign up and log in with Firebase Authentication
- Search books from a free API (Project Gutenberg via Gutendex)
- Read book formats when signed in
- Save and remove favorite books when signed in (stored in Firebase Firestore)

## Tech Stack

- HTML
- Tailwind CSS (CDN)
- Vanilla JavaScript
- Firebase Authentication + Firestore
- Project Gutenberg (Gutendex API)

## 1) Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/).
2. Add a Web App in your project settings.
3. Copy config values and replace placeholders in `app.js`:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

4. In Firebase Console:
   - Enable **Authentication > Email/Password**
   - Create **Firestore Database** in production or test mode

## 2) Firestore Rules (quick starter)

Use these rules so each user can only access their own favorites:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/favorites/{favoriteId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Firestore structure used by this app

- Collection: `users/{uid}/favorites`
- Document ID: the app's generated book ID (based on Gutenberg book `id`)

There are no SQL-style “tables” here; Firestore stores data in collections/documents.

## 3) Run Project

Because Firebase modules are imported with ES modules, run through a local server:

- VS Code Live Server, or
- `python -m http.server 5500`, or
- `npx serve .`

Then open `index.html` in browser through that server URL.

## Project Files

- `index.html` - UI layout
- `app.js` - auth, API fetch, favorites logic

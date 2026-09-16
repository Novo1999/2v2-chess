/**
 * Firebase wiring. Lazy on purpose: the hot-seat game never touches the
 * network, so nothing here runs until an online screen asks for a handle.
 */

import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type Auth,
} from 'firebase/auth';
import {
  connectDatabaseEmulator,
  getDatabase,
  type Database,
} from 'firebase/database';
import { PROJECT_CONFIG } from './config';

/** Environment overrides, only for the fields actually set. */
const ENV_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  databaseURL: 'VITE_FIREBASE_DATABASE_URL',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
} as const;

const fromEnv: FirebaseOptions = Object.fromEntries(
  Object.entries(ENV_KEYS)
    .map(([field, key]) => [field, import.meta.env[key] as string | undefined])
    .filter(([, value]) => Boolean(value)),
);

const useEmulator = import.meta.env['VITE_USE_EMULATOR'] === 'true';

/**
 * The emulator gets a demo project wholesale, never the real one. The emulators
 * are started with the same id, and the `demo-` prefix is Firebase's guarantee
 * that nothing in this mode can reach a production service by accident.
 */
const EMULATOR_PROJECT = 'demo-consultation-chess';
const EMULATOR_CONFIG: FirebaseOptions = {
  projectId: EMULATOR_PROJECT,
  apiKey: 'demo-api-key',
  databaseURL: `https://${EMULATOR_PROJECT}-default-rtdb.firebaseio.com`,
};

const options: FirebaseOptions = useEmulator
  ? EMULATOR_CONFIG
  : { ...PROJECT_CONFIG, ...fromEnv };

/** Whether an online game is even possible in this build. */
export const isConfigured = Boolean(options.databaseURL);

let app: FirebaseApp | null = null;
let db: Database | null = null;
let auth: Auth | null = null;

function ensureApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(options);
  }
  return app;
}

export function getDb(): Database {
  if (!db) {
    db = getDatabase(ensureApp());
    if (useEmulator) connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }
  return db;
}

export function getAuthClient(): Auth {
  if (!auth) {
    auth = getAuth(ensureApp());
    // Without this, anonymous sign-in would go to the real Firebase Auth and
    // fail — so the emulator path needs both emulators, not just the database.
    if (useEmulator) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
        disableWarnings: true,
      });
    }
  }
  return auth;
}

/**
 * Anonymous sign-in. The uid it returns is disposable by design — decision #8
 * is precisely the admission that this identity does not survive a new browser,
 * which is why the slot secret exists.
 */
export function signIn(): Promise<string> {
  const client = getAuthClient();
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(
      client,
      (user) => {
        if (user) {
          stop();
          resolve(user.uid);
        }
      },
      reject,
    );
    signInAnonymously(client).catch(reject);
  });
}

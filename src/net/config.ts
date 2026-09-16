/**
 * The Firebase web config for the Chesspacito project.
 *
 * Committed on purpose. None of this is a secret: it is shipped to every
 * browser that loads the app, and it only identifies which project to talk to.
 * What actually protects the data is database.rules.json (PLAN.md decision #5)
 * plus the authorised-domains list in Firebase Authentication.
 *
 * Any VITE_FIREBASE_* variable set in the environment overrides the matching
 * field here, so a fork can point at its own project without editing this file.
 */

import type { FirebaseOptions } from 'firebase/app';

export const PROJECT_CONFIG: FirebaseOptions = {
  apiKey: 'AIzaSyCRI6NVknTT9vCEEmWQ8ivjfz1p6FFMCjQ',
  authDomain: 'chesspacito.firebaseapp.com',
  databaseURL: 'https://chesspacito-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'chesspacito',
  storageBucket: 'chesspacito.firebasestorage.app',
  messagingSenderId: '720286505248',
  appId: '1:720286505248:web:1bf4f231a06c3124271f45',
  measurementId: 'G-B3RVZ3YC89',
};

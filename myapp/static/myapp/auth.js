// Sign-in with Google through Firebase. The only file that talks to Firebase.
//
// The server puts the Firebase web config into the page as JSON (id="firebase-config").
// If it's missing, sign-in is simply off and the rest of the app still works.

const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.14.1";
const CONFIG_ELEMENT_ID = "firebase-config";
const SILENT_ERRORS = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];
const ERROR_MESSAGES = {
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups for this site and try again.",
  "auth/network-request-failed": "Couldn't reach Google. Check your connection and try again.",
  "auth/unauthorized-domain": "Sign-in isn't allowed on this web address yet. Add it in Firebase → Authentication → Settings → Authorized domains.",
};

let firebase = null; // { auth, sdk } once loaded

function readConfig() {
  try {
    const config = JSON.parse(document.getElementById(CONFIG_ELEMENT_ID).textContent);
    return config && config.projectId ? config : null;
  } catch (_) {
    return null; // element missing or broken: sign-in stays off
  }
}

/** Load Firebase and call onChange(user or null) now and every time sign-in changes. */
export async function startAuth(onChange) {
  const config = readConfig();
  if (!config) return false;
  try {
    const [{ initializeApp }, sdk] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-auth.js`),
    ]);
    const auth = sdk.getAuth(initializeApp(config));
    firebase = { auth, sdk };
    sdk.onAuthStateChanged(auth, (user) =>
      onChange(user && { name: user.displayName || user.email || "You", photo: user.photoURL || "" }),
    );
    return true;
  } catch (err) {
    console.error("Firebase didn't load, so sign-in is off.", err);
    return false;
  }
}

/** Open Google's sign-in popup. Resolves true if signed in; throws a readable Error otherwise. */
export async function signIn() {
  const { auth, sdk } = firebase;
  try {
    await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
    return true;
  } catch (err) {
    if (SILENT_ERRORS.includes(err.code)) return false;
    throw new Error(ERROR_MESSAGES[err.code] || "Sign-in didn't work. Try again.");
  }
}

export function signOut() {
  return firebase.sdk.signOut(firebase.auth);
}

/** A fresh ID token to send to our API (Firebase refreshes it when needed). */
export async function getIdToken() {
  const user = firebase && firebase.auth.currentUser;
  return user ? user.getIdToken() : null;
}

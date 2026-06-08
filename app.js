// app.js — Final patched file (apply as a full replacement)
// - Ensures checkpoint markers remain visible when a route starts
// - Uses setProperty(..., 'important') to override CSS !important rules
// - Exposes runtime references for debugging and tracing
// - Adds lightweight logs in showRoute and clearRoute
// - Starts geolocation when user is signed in (and from recenter if needed)
// - Smooths auto-follow to avoid jitter
// - Makes Nearby screen truly “nearby” using distance
// - Sorts History newest → oldest
// - No other app logic changed

// ======== FIREBASE IMPORTS ========
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  addDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ======== FIREBASE CONFIG ========
const firebaseConfig = {
  apiKey: "AIzaSyCfS5a-1fg-68_gpcqpmMbSTz7bW9dEp_0",
  authDomain: "pathquest-archives.firebaseapp.com",
  projectId: "pathquest-archives",
  storageBucket: "pathquest-archives.firebasestorage.app",
  messagingSenderId: "86962049537",
  appId: "1:86962049537:web:428c8af7896716657a6600",
  measurementId: "G-TR41D17WY7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// ======== HANDLE REDIRECT RESULT (clean URL) ========
(async function handleRedirectResult() {
  try {
    const landingEl = document.getElementById("landing-screen");
  if (landingEl) landingEl.classList.add("hidden");

  const result = await getRedirectResult(auth);
    if (result && result.user) {
      console.log("Redirect login success:", result.user);
    }
  } catch (err) {
    console.warn("getRedirectResult error:", err);
  } finally {
    try {
      const url = new URL(window.location.href);
      ["code", "state", "session", "oauth", "g_csrf_token"].forEach((p) =>
        url.searchParams.delete(p)
      );
      history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    } catch (e) {
      // ignore
    }
  }
})();

// ======== BADGE SYSTEM ========
const DEFAULT_BADGE_IMAGE = "icons/default-badge.png";

async function awardBadge(badgeId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, "Users", user.uid, "badges", badgeId), {
      earnedAt: new Date(),
      name: badgeId.replace(/_/g, " "),
      image: DEFAULT_BADGE_IMAGE,
      description: "Badge earned for completing a route."
    });
  } catch (e) {
    console.error("awardBadge error", e);
  }
}

// ======== BADGE REVEAL ANIMATION ========
function showBadgeReveal(badgeName, badgeSVG) {
  const overlay      = document.getElementById("badge-reveal-overlay");
  const ring         = document.getElementById("badge-reveal-ring");
  const svgContainer = document.getElementById("badge-reveal-svg-container");
  const nameEl       = document.getElementById("badge-reveal-name");
  if (!overlay || !svgContainer || !nameEl) return;

  // Reset animation so it replays if called again
  if (ring) {
    ring.style.animation = "none";
    void ring.offsetWidth; // force reflow
    ring.style.animation = "";
  }

  // Inject badge SVG
  svgContainer.innerHTML = badgeSVG || "";
  nameEl.textContent = badgeName || "New Badge";

  // Show overlay
  overlay.classList.add("show");

  // Haptic — stamp impact feel
  if (navigator.vibrate) navigator.vibrate([0, 100, 80, 60, 40]);

  // Dismiss on tap (allow time for animation to play)
  const dismiss = () => {
    overlay.classList.remove("show");
    overlay.removeEventListener("click", dismiss);
    // Reset animated elements so they're invisible until next reveal
    [".badge-reveal-label", ".badge-reveal-name", ".badge-reveal-tap"].forEach(sel => {
      const el = overlay.querySelector(sel);
      if (el) { el.style.animation = "none"; el.style.opacity = "0"; }
    });
  };
  setTimeout(() => overlay.addEventListener("click", dismiss), 1400);
}

// ======== TITLE SYSTEM ========
function getTitleForCompletions(count) {
  if (count >= 50) return "Master Explorer";
  if (count >= 25) return "Summit Seeker";
  if (count >= 10) return "Pathfinder";
  if (count >= 3) return "Trail Rookie";
  return "New Adventurer";
}

async function updateUserTitleUI() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const historyCol = collection(db, "Users", user.uid, "routeHistory");
    const snap = await getDocs(historyCol);
    const count = snap.size;
    const title = getTitleForCompletions(count);
    const titleEl = document.getElementById("user-title");
    if (titleEl) titleEl.textContent = `Title: ${title} (${count} routes completed)`;
    // Keep menu profile title in sync
    const profileTitle = document.getElementById("menu-profile-title");
    if (profileTitle) profileTitle.textContent = title;
  } catch (e) {
    console.error("updateUserTitleUI error", e);
  }
}

// ── iOS bfcache: reset sign-in button if user hits Back from Google auth ──
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return; // normal load — nothing to fix
  // Page was restored from back-forward cache (iOS Safari).
  // The button may be stuck on "Signing in…" — reset it.
  resetSignInBtn();
  // Also make sure the landing is visible (not stuck hidden)
  const landing = document.getElementById("landing-screen");
  if (landing && !auth.currentUser) {
    landing.classList.remove("hidden", "fade-out");
  }
  // Hide the splash if it's somehow still showing
  const splash = document.getElementById("splash-screen");
  if (splash) { splash.classList.add("fade-out"); setTimeout(() => splash.classList.add("gone"), 650); }
});
// Sign-in is handled by the FAB when in signed-out state (see auth observer below)
async function handleSignIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (popupErr) {
    // User dismissed the popup (hit back / closed it) — don't redirect, just bail.
    const code = popupErr?.code || "";
    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request" ||
      code === "auth/user-cancelled"
    ) {
      console.log("Sign-in popup closed by user — no action needed.");
      return; // Let the button reset in the finally block below
    }

    // Popup genuinely blocked (e.g. desktop browser with strict settings) — fall back to redirect
    console.warn("Popup sign-in failed, falling back to redirect:", popupErr);
    try {
      await signInWithRedirect(auth, provider);
      // signInWithRedirect navigates away; code below won't run until the user returns
    } catch (redirectErr) {
      console.error("Redirect sign-in failed:", redirectErr);
      alert("Sign-in failed. Please allow popups or try again.");
    }
  }
}

// ======== LEAFLET MAP SETUP ========
const map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
  rotate: true,
  touchRotate: true,
  rotateControl: false,
  bearing: 0,
  markerZoomAnimation: true,
  zoomSnap: 0.5,
  zoomAnimationThreshold: 4,
  zoomAnimation: true
}).setView([49.25, -122.89], 13);

// Expose map early for debugging
window._map = map;

// ======== SPLASH SCREEN ========
const splashScreen   = document.getElementById("splash-screen");
const splashProgress = document.getElementById("splash-progress-bar");
const splashStatus   = document.getElementById("splash-status");

function setSplashProgress(pct, status) {
  if (splashProgress) splashProgress.style.width = pct + "%";
  if (splashStatus)   splashStatus.textContent   = status;
}

function hideSplash() {
  if (!splashScreen) return;
  splashScreen.classList.add("fade-out");
  setTimeout(() => splashScreen.classList.add("gone"), 650);
}

const landingScreen  = document.getElementById("landing-screen");
const landingSignBtn = document.getElementById("landing-signin-btn");

const SIGNIN_BTN_HTML = `<svg viewBox="0 0 24 24" width="20" height="20" style="flex-shrink:0">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg> Sign in with Google`;

function resetSignInBtn() {
  if (!landingSignBtn) return;
  landingSignBtn.disabled = false;
  landingSignBtn.classList.remove("loading");
  landingSignBtn.innerHTML = SIGNIN_BTN_HTML;
}

function showLandingScreen() {
  if (!landingScreen) return;
  landingScreen.classList.remove("hidden", "fade-out");
  resetSignInBtn();
  if (landingSignBtn) {
    landingSignBtn.onclick = async () => {
      landingSignBtn.classList.add("loading");
      landingSignBtn.textContent = "Signing in…";
      landingSignBtn.disabled = true;
      try {
        await handleSignIn();
      } catch(e) {
        // ignored — handleSignIn handles its own errors
      } finally {
        // Always reset — covers popup dismissed, errors, and any path that doesn't navigate away
        resetSignInBtn();
      }
    };
  }
}

function hideLandingScreen() {
  if (!landingScreen) return;
  landingScreen.classList.add("fade-out");
  setTimeout(() => landingScreen.classList.add("hidden"), 500);
}

// ======== STORY INTRO (one-time) ========
const STORY_INTRO_KEY = "pqa_story_intro_seen";

function maybeShowStoryIntro(onDone) {
  const screen = document.getElementById("story-intro-screen");
  if (!screen) { onDone(); return; }

  if (localStorage.getItem(STORY_INTRO_KEY)) { onDone(); return; }

  // Show it
  screen.classList.remove("hidden", "fade-out");

  function dismiss() {
    localStorage.setItem(STORY_INTRO_KEY, "1");
    screen.classList.add("fade-out");
    setTimeout(() => { screen.classList.add("hidden"); onDone(); }, 700);
  }

  const btn = document.getElementById("story-intro-btn");
  if (btn) btn.addEventListener("click", dismiss, { once: true });
  // Tap anywhere also works (after animations have had a moment)
  setTimeout(() => {
    screen.addEventListener("click", dismiss, { once: true });
  }, 2600);
}

// ======== DISCLAIMER ========
const DISCLAIMER_KEY  = "pqa_disclaimer_accepted";
const ONBOARDING_KEY  = "pqa_onboarding_done";

function showOnboarding(onComplete) {
  const backdrop = document.getElementById("onboarding-backdrop");
  const modal    = document.getElementById("onboarding-modal");
  if (!backdrop || !modal) { onComplete?.(); return; }

  backdrop.classList.remove("hidden");
  modal.classList.remove("hidden");

  function goTo(fromId, toId) {
    const from = document.getElementById(fromId);
    const to   = document.getElementById(toId);
    if (!from || !to) return;
    from.classList.add("slide-out");
    setTimeout(() => {
      from.classList.add("hidden");
      from.classList.remove("slide-out");
      to.classList.remove("hidden");
      to.classList.add("slide-in");
      setTimeout(() => to.classList.remove("slide-in"), 240);
    }, 220);
  }

  function close() {
    backdrop.classList.add("hidden");
    modal.classList.add("hidden");
    localStorage.setItem(ONBOARDING_KEY,  "1");
    localStorage.setItem(DISCLAIMER_KEY,  "1");
    onComplete?.();
  }

  document.getElementById("onboarding-next-1")?.addEventListener("click", () => {
    goTo("onboarding-step-1", "onboarding-step-2");
  }, { once: true });

  document.getElementById("onboarding-next-2")?.addEventListener("click", () => {
    goTo("onboarding-step-2", "onboarding-step-3");
  }, { once: true });

  document.getElementById("onboarding-enable-gps")?.addEventListener("click", () => {
    startGeolocationWatch();
    close();
  }, { once: true });

  document.getElementById("onboarding-skip-gps")?.addEventListener("click", () => {
    close();
  }, { once: true });
}

function maybeShowOnboarding() {
  if (!localStorage.getItem(ONBOARDING_KEY)) {
    showOnboarding();
  } else if (!localStorage.getItem(DISCLAIMER_KEY)) {
    localStorage.setItem(DISCLAIMER_KEY, "1");
  }
}

function showDisclaimer() {
  const backdrop = document.getElementById("disclaimer-backdrop");
  const modal    = document.getElementById("disclaimer-modal");
  const btn      = document.getElementById("disclaimer-accept-btn");
  if (!backdrop || !modal) return;
  backdrop.classList.remove("hidden");
  modal.classList.remove("hidden");
  btn?.addEventListener("click", () => {
    localStorage.setItem(DISCLAIMER_KEY, "1");
    backdrop.classList.add("hidden");
    modal.classList.add("hidden");
  }, { once: true });
}

function maybeShowDisclaimer() {
  if (!localStorage.getItem(DISCLAIMER_KEY)) showDisclaimer();
}

// OSM tiles — no API key required
// ⚠️ Stadia blocked by Edge tracking prevention (401/403) — do not revert to Stadia without API key
const tileLayer = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
  }
).addTo(map);

// Subtle tint: darken + desaturate the busy OSM base so game markers pop
// No hue-rotate — keeps greens/blues natural, avoids purple shift
const _applyMapFilter = () => {
  const container = tileLayer.getContainer?.();
  if (container) container.style.filter = "saturate(0.55) brightness(0.82) contrast(1.05)";
};
tileLayer.once("load", _applyMapFilter);
map.on("layeradd", (e) => { if (e.layer === tileLayer) _applyMapFilter(); });

map.on("zoom move", () => {
  if (!routeLine) return;
  routeLine.redraw();
  const renderer = routeLine._renderer;
  if (renderer && renderer._reset) renderer._reset();
});

// Apply marker pane transform in sync with tile pane during scroll zoom.
map.on("zoomend", () => {
  const zoom = map.getZoom();
  flagAnimPaused = zoom < 14;
  updateMarkersForZoom(zoom);
});

// ── JS FLAG ANIMATION (replaces CSS keyframes — iOS Safari safe) ──
const FLAG_FRAMES      = ["icons/flag1.svg","icons/flag2.svg","icons/flag3.svg","icons/flag4.svg"];
const FLAG_GOLD_FRAMES = ["icons/flag-gold1.svg","icons/flag-gold2.svg","icons/flag-gold3.svg","icons/flag-gold4.svg"];
const FLAG_INTERVAL_MS = 150; // ~6.6fps — matches original 0.6s / 4 frames
let flagAnimPaused = false;

// Shared tick counter — all flags read the same clock so they advance in sync.
// Avoids Date.now() drift where different flags land on different frames within
// the same tick, which caused the rapid flicker/flash on mobile.
let _flagTick = 0;

setInterval(() => {
  _flagTick++;
  if (flagAnimPaused) return;
  document.querySelectorAll(".flag-anim").forEach(el => {
    const frames = el.classList.contains("flag-gold") ? FLAG_GOLD_FRAMES : FLAG_FRAMES;
    const delay  = parseInt(el.dataset.delay || "0", 10);
    const frame  = (_flagTick + delay) % frames.length;
    // Only write backgroundImage when the frame actually changes — avoids the
    // browser repaint/SVG-reload that happens when the same URL is re-assigned
    // every tick even though nothing visually changed (main cause of flicker).
    const next = `url("${frames[frame]}")`;
    if (el.dataset.flagFrame !== next) {
      el.dataset.flagFrame = next;
      el.style.backgroundImage = next;
    }
  });
}, FLAG_INTERVAL_MS);

// Swap a trailhead flag to gold and add a ✓ chip when a route is completed
// mid-session — avoids a full re-render of all markers.
function markTrailheadComplete(routeName) {
  const entry = trailheadMarkers.find(t => {
    // Match by position — look up route start coords from __allRoutes
    const route = (window.__allRoutes || []).find(r => r.name === routeName);
    if (!route || !route.checkpoints?.[0]) return false;
    const lat = parseFloat(route.checkpoints[0].lat ?? route.checkpoints[0].Lat ?? route.checkpoints[0].latitude);
    const lng = parseFloat(route.checkpoints[0].lng ?? route.checkpoints[0].Lng ?? route.checkpoints[0].longitude);
    return Math.abs(t.lat - lat) < 0.00001 && Math.abs(t.lng - lng) < 0.00001;
  });
  if (!entry || !entry.marker?._icon) return;

  // Swap flag colour — add flag-gold class to inner element
  const flagEl = entry.marker._icon.querySelector(".flag-anim");
  if (flagEl && !flagEl.classList.contains("flag-gold")) {
    flagEl.classList.add("flag-gold");
  }

  // Add ✓ chip below flag if not already there
  if (!entry.marker._icon.querySelector(".trailhead-done-chip")) {
    const chip = document.createElement("div");
    chip.className = "trailhead-done-chip";
    chip.textContent = "✓";
    entry.marker._icon.appendChild(chip);
  }

  entry.isCompleted = true;
}

function updateMarkersForZoom(zoom) {
  // ── User sprite — no zoom scaling applied; always same visual size.

  // ── Trailhead flags — scale the inner .flag-anim element.
  // Leaflet writes translate() on _icon; we must not touch _icon.style.transform.
  // transform-origin matches iconAnchor [4,48] within the [36,48] element.
  const thScale = Math.max(0.15, Math.min(1.5, (zoom - 10) * 0.12));
  trailheadMarkers.forEach(({ marker }) => {
    if (!marker || !marker._icon) return;
    const el = marker._icon.querySelector(".flag-anim");
    if (!el) return;
    el.style.transformOrigin = "4px 48px";
    el.style.transform = `scale(${thScale})`;
  });

  // ── Checkpoint mini flags — scale inner .cp-flag-wrap.
  // iconAnchor [4,40] on [32,40] icon.
  const cpScale = Math.max(0.15, Math.min(1.5, (zoom - 10) * 0.08));
  const badgeSize = Math.round(Math.max(5, Math.min(28, (zoom - 10) * 3.5)) * 0.55);
  const badgeFontSize = Math.round(badgeSize * 0.55);

  if (checkpointMarkers) {
    checkpointMarkers.forEach((m) => {
      if (!m || !m._icon) return;
      const wrap = m._icon.querySelector(".cp-flag-wrap") || m._icon.querySelector(".flag-mini");
      if (!wrap) return;
      wrap.style.transformOrigin = "4px 40px";
      wrap.style.transform = `scale(${cpScale})`;
      const badge = m._icon.querySelector(".cp-flag-number");
      if (badge) { badge.style.minWidth = badgeSize + "px"; badge.style.height = badgeSize + "px"; badge.style.fontSize = badgeFontSize + "px"; }
    });
  }

  // ── POI markers — scale inner .poi-marker element.
  // iconAnchor [20,20] on [40,40] icon.
  const poiScale = Math.max(0.2, Math.min(1.2, (zoom - 10) * 0.1));
  document.querySelectorAll(".leaflet-marker-icon .poi-marker").forEach(el => {
    el.style.transformOrigin = "20px 20px";
    el.style.transform = `scale(${poiScale})`;
  });
}

// ======== CHECKPOINT PANE CREATION & STACKING FIX ========
if (!map.getPane("checkpointPane")) map.createPane("checkpointPane");
map.getPane("checkpointPane").style.zIndex = "1420";
map.getPane("checkpointPane").style.pointerEvents = "auto";

// markerPane — trailhead flags sit here, above user marker
const markerPane = map.getPane("markerPane");
if (markerPane) {
  markerPane.style.zIndex = "1410";
  markerPane.style.pointerEvents = "auto";
}

// userPane — always below flags so they stay tappable on iPhone
if (!map.getPane("userPane")) map.createPane("userPane");
map.getPane("userPane").style.zIndex = "1390";
map.getPane("userPane").style.pointerEvents = "none";

// ── Keep user marker pinned during animated zoom (incl. pinch+rotate) ──
// leaflet-rotate patches pane transforms during gestures; hooking zoomanim
// lets us nudge the marker to its correct pixel position every animation frame
// so it never visually drifts from the geographic point.
map.on("zoomanim", (e) => {
  if (!userMarker || !userLatLng) return;
  const pxMarker = map.project([userLatLng.lat, userLatLng.lng], e.zoom);
  const pxCenter = map.project(e.center, e.zoom);
  const dx = pxMarker.x - pxCenter.x;
  const dy = pxMarker.y - pxCenter.y;
  const iconEl = userMarker._icon;
  if (iconEl) {
    iconEl.style.transform = `translate(${dx}px,${dy}px)`;
  }
});

const mapEl = document.getElementById("map");
if (mapEl) mapEl.style.background = "#0b0b0b";

// ======== STATE ========
let lastPreviewRouteName = null;
let lastPreviewRouteCheckpoints = null;
let routes = [];
let activeRoute = null;
let activeRouteName    = null;
let activeRouteMode    = "guided"; // "guided" | "hunt"
let activeRouteNarrator = "";      // narrator id for the active route
let activeIndex = 0;
let userLatLng = null;
let userMarker = null;
let routeLayer = null;
let routeLine = null;

// Track lore triggers so they only fire once
let visitedLore = {};

let watchId = null;
let checkpointMarkers = [];

// Start/stop geolocation tracking only after a user gesture
function startGeolocationWatch() {
  if (watchId || !("geolocation" in navigator)) return;

  // Show GPS waiting indicator until first fix arrives
  const gpsWaiting = document.getElementById("gps-waiting");
  if (gpsWaiting && !userLatLng) gpsWaiting.style.display = "flex";

  watchId = navigator.geolocation.watchPosition(
    updateUserMarker,
    (err) => {
      console.warn("GPS error (watch):", err);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000
    }
  );
}

function stopGeolocationWatch() {
  if (!watchId) return;
  try {
    navigator.geolocation.clearWatch(watchId);
  } catch (e) {}
  watchId = null;
}

const startMarkersLayer = L.layerGroup().addTo(map);
let trailheadMarkers = [];

// ======== ICONS ========
function createStartIcon() {
  const delay = Math.floor(Math.random() * 4) + 1;

  return L.divIcon({
    html: `<div class="flag-anim" data-delay="${delay}"></div>`,
    className: "",
    iconSize: [36, 48],
    iconAnchor: [4, 48]
  });
}

function createGoldFlagIcon() {
  const delay = Math.floor(Math.random() * 4) + 1;

  return L.divIcon({
    html: `<div class="flag-anim flag-gold" data-delay="${delay}"></div>`,
    className: "",
    iconSize: [36, 48],
    iconAnchor: [4, 48]
  });
}

function createCheckpointIcon(isActive, number) {
  return L.divIcon({
    html: `
      <div class="flag-mini ${isActive ? "checkpoint-glow" : ""}">
        <div class="checkpoint-number">${number}</div>
      </div>
    `,
    className: "",
    iconSize: [32, 40],
    iconAnchor: [4, 40]
  });
}

function createUserIcon() {
  return L.divIcon({
    html: `
      <div class="user-icon-wrapper">
        <img src="icons/hiker-sprite.png" class="user-hiker-icon">
      </div>
    `,
    className: "",
    iconSize:   [48, 72],
    iconAnchor: [23, 67]
  });
}

function computeRouteDistance(checkpoints) {
  let total = 0;

  for (let i = 0; i < checkpoints.length - 1; i++) {
    const a = checkpoints[i];
    const b = checkpoints[i + 1];

    const latA = parseFloat(a.lat ?? a.Lat ?? a.latitude);
    const lngA = parseFloat(a.lng ?? a.Lng ?? a.longitude);
    const latB = parseFloat(b.lat ?? b.Lat ?? b.latitude);
    const lngB = parseFloat(b.lng ?? b.Lng ?? b.longitude);

    if (isNaN(latA) || isNaN(lngA) || isNaN(latB) || isNaN(lngB)) continue;

    total += distanceInMeters(latA, lngA, latB, lngB);
  }

  return total; // meters
}

function estimateTimeMinutes(distanceMeters) {
  const pace = 80; // meters per minute (≈ 4.8 km/h walking pace)
  return Math.round(distanceMeters / pace);
}

/* ============================================================
   JOURNAL PANEL — LOGIC
============================================================ */

const journalPanel = document.getElementById("journal-panel");
const journalBackdrop = document.getElementById("journal-backdrop");
const journalRoutesList = document.getElementById("journal-routes-list");
const journalLoreList = document.getElementById("journal-lore-list");
const journalCloseBtn = document.getElementById("journal-close-btn");

// NOTE: openJournalPanel is defined in the narrator journal block below.
// It is kept as a named alias for any legacy callers.

function openJournalRoute(routeName, entries) {
  journalLoreList.innerHTML = "";
  journalLoreList.classList.remove("hidden");

  entries.forEach(entry => {
    const div = document.createElement("div");
    div.className = "journal-lore-entry";

    div.innerHTML = `
      <div class="journal-lore-title">${entry.title}</div>
      <div class="journal-lore-preview">${entry.text.slice(0, 80)}...</div>
    `;

    div.onclick = () => openLoreCard(entry);

    journalLoreList.appendChild(div);
  });
}

function closeJournal() {
  journalBackdrop.classList.remove("show");
  journalPanel.classList.remove("show");

  setTimeout(() => {
    journalBackdrop.classList.add("hidden");
    journalPanel.classList.add("hidden");
  }, 250);
}

journalCloseBtn.onclick = closeJournal;
journalBackdrop.onclick = closeJournal;


// ======== GEO HELPERS ========
function distanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(lat1, lng1, lat2, lng2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const toDeg = (x) => (x * 180) / Math.PI;

  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(lat1 * (Math.PI / 180)) *
      Math.cos(toRad(lat2)) *
      Math.cos(dLng);

  let brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

// ======== ROUTE COMPLETION + HISTORY ========
// ── NARRATOR POI UNLOCK SYSTEM ───────────────────────────────
// After each route completion, check if the narrator's POI should unlock.
// Threshold and POI id live on the Narrator doc in Firestore.
// Unlocked POIs are stored in Users/{uid}/profile/info.unlockedPOIs.

async function checkNarratorPOIUnlock(routeName) {
  const user = auth.currentUser;
  if (!user) return;

  // Find which narrator this route belongs to
  const route = (window.__allRoutes || []).find(r => r.name === routeName);
  if (!route?.narrator) return;

  const narrator = NARRATORS.find(n => n.id === route.narrator);
  if (!narrator?.poiUnlockThreshold || !narrator?.unlockPOIId) return;

  // Already unlocked — nothing to do
  if ((window.__unlockedPOIs || []).includes(narrator.unlockPOIId)) return;

  // Count how many of this narrator's routes the player has completed
  const narratorRouteNames = (window.__allRoutes || [])
    .filter(r => r.narrator === narrator.id)
    .map(r => r.name);

  const completedNarratorRoutes = narratorRouteNames.filter(name =>
    window.__completedRoutes?.has(name)
  ).length;

  if (completedNarratorRoutes < narrator.poiUnlockThreshold) return;

  // Threshold met — unlock the POI
  window.__unlockedPOIs = [...(window.__unlockedPOIs || []), narrator.unlockPOIId];

  try {
    const profileRef = doc(db, "Users", user.uid, "profile", "info");
    await setDoc(profileRef, { unlockedPOIs: window.__unlockedPOIs }, { merge: true });
    console.log(`[POI Unlock] ${narrator.unlockPOIId} unlocked for narrator ${narrator.id}`);
  } catch (err) {
    console.error("[POI Unlock] failed to save:", err);
  }

  // Reveal the POI on the map with a brief delay so it appears after the badge reveal
  setTimeout(() => revealUnlockedPOI(narrator.unlockPOIId, narrator.name), 3500);
}

// Adds the newly unlocked POI to the map with a pulse reveal animation.
function revealUnlockedPOI(poiId, narratorName) {
  const poi = worldPOIs.find(p => p.id === poiId);
  if (!poi) return;

  const lat = parseFloat(poi.lat ?? poi.Lat ?? poi.latitude);
  const lng = parseFloat(poi.lng ?? poi.Lng ?? poi.longitude);
  if (isNaN(lat) || isNaN(lng)) return;

  // Add the marker to the map (renderWorldPOIs will also pick it up on next call)
  const marker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div class="poi-marker poi-reveal">
               <img class="poi-svg" src="icons/poi-marker.svg" alt="Point of Interest">
             </div>`,
      className: "",
      iconSize:   [40, 40],
      iconAnchor: [20, 20]
    }),
    interactive: true,
    pane: "markerPane"
  }).addTo(map);

  poiMarkers[poiId] = marker;

  // Show a toast notifying the player
  showLoreToast(`Something has appeared on the map.`);

  // Remove the reveal pulse class after animation completes
  setTimeout(() => {
    const el = marker.getElement();
    if (el) el.querySelector(".poi-marker")?.classList.remove("poi-reveal");
  }, 2000);
}

async function logRouteCompletion(routeName) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, "Users", user.uid, "routeHistory"), {
      routeName,
      completedAt: new Date()
    });
    updateUserTitleUI();
  } catch (e) {
    console.error("logRouteCompletion error", e);
  }
}

async function completeRoute() {
  if (!activeRouteName) return;
  const badgeId = `completed_${activeRouteName.replace(/\s+/g, "_")}`;
  awardBadge(badgeId);

  // Count lore entries found + snapshot route length before clearing state
  const loreCount = Object.values(visitedLore).filter(v => v).length;
  const totalLore = activeRoute.length;

  // Snapshot route + name before clearRoute nulls them
  const routeSnapshot = activeRoute;
  const routeNameSnapshot = activeRouteName;

  // Log completion — await it so the history count is accurate for stars
  await logRouteCompletion(routeNameSnapshot);

  // Optimistically update the Set so trailhead icon turns gold immediately
  if (!window.__completedRoutes) window.__completedRoutes = new Set();
  window.__completedRoutes.add(routeNameSnapshot);
  markTrailheadComplete(routeNameSnapshot);

  // ── Narrator POI unlock check ────────────────────────────────
  // After completing a route, check if the player has now hit the
  // threshold for the route's narrator. If so, unlock their POI.
  await checkNarratorPOIUnlock(routeNameSnapshot);

  // Count how many times this route has been completed (including this one)
  // by reading the routeHistory collection we just wrote to
  let completions = 1;
  try {
    const user = auth.currentUser;
    if (user) {
      const snap = await getDocs(collection(db, "Users", user.uid, "routeHistory"));
      snap.forEach(d => {
        if (d.data().routeName === routeNameSnapshot) completions++;
      });
      // snap already includes the doc we just wrote, so subtract the
      // extra 1 we started with
      completions = Math.max(1, completions - 1);
    }
  } catch (e) {
    console.warn("completeRoute: could not read history for star count", e);
  }

  const starCount = getStarCountForCompletions(completions);
  const badgeSVG = generateBadgeSVG(routeNameSnapshot, starCount);

  // Show badge reveal first, then summary after user dismisses it
  showBadgeReveal(routeNameSnapshot, badgeSVG);

  setTimeout(() => {
    showRouteSummary(routeNameSnapshot, badgeSVG, loreCount, totalLore, routeSnapshot);
  }, 2000);

  clearRoute();
  localStorage.removeItem("pqa_activeRoute");

  hidePreviewBanner();
}

// ======== clearRoute ========
function clearRoute() {
  console.log("[debug] clearRoute() called", new Error().stack);

  // Remove route polyline layer group (clearLayers first to remove children)
  if (window.__routeLineLayer) {
    window.__routeLineLayer.clearLayers();
    if (map.hasLayer(window.__routeLineLayer)) map.removeLayer(window.__routeLineLayer);
    window.__routeLineLayer = null;
  }
  routeLine = null;

  // Remove checkpoint layer group (clearLayers first to remove children)
  if (window.__checkpointLayer) {
    window.__checkpointLayer.clearLayers();
    if (map.hasLayer(window.__checkpointLayer)) map.removeLayer(window.__checkpointLayer);
    window.__checkpointLayer = null;
  }
  window.__checkpointMarkers = [];
  checkpointMarkers = [];

  // Hunt mode: remove the fog overlay
  hideHuntFog();

  // Cancel any pending dwell timers
  Object.keys(checkpointDwellTimers).forEach(k => {
    clearTimeout(checkpointDwellTimers[k]);
    delete checkpointDwellTimers[k];
  });

  // Cancel pending route completion (e.g. user exits before closing final lore card)
  pendingRouteComplete = false;
  activeRouteMode = "guided";
  hideClueCardFully();

  // ⭐ Reset route state
  activeRoute         = null;
  activeRouteName     = null;
  activeRouteNarrator = "";
  activeIndex = 0;
  visitedLore = {};
  Object.keys(_cpLastState).forEach(k => delete _cpLastState[k]);
  Object.keys(_cpLastGlow).forEach(k => delete _cpLastGlow[k]);

  // ⭐ Reset routeLayer reference
  routeLayer = null;

  // ⭐ Hide HUD if visible
  hideHUD();
}

// Expose clearRoute for console tracing
window.clearRoute = clearRoute;

// ======== ROUTE HUD ========
const hud = document.getElementById("route-hud");
const hudName = document.getElementById("hud-route-name");
const hudNext = document.getElementById("hud-next-info");
const hudFill = document.getElementById("hud-progress-fill");
const hudPause = document.getElementById("hud-pause-btn");
const hudExit = document.getElementById("hud-exit-btn");

let routePaused = false;

function updateHUD() {
  if (!hud || !activeRoute || activeRoute.length === 0) return;

  const total = activeRoute.length;
  const nextIndex = Math.min(activeIndex, total - 1);
  const cp = activeRoute[nextIndex];

  if (hudName) hudName.textContent = activeRouteName || "Route";

  if (cp && hudNext) {
    const lat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
    const lng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
    let dist = 0;
    if (userLatLng && !isNaN(lat) && !isNaN(lng)) {
      dist = Math.round(
        distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng)
      );
    }
    hudNext.textContent = `Next: CP ${nextIndex + 1} — ${dist}m`;
  }

  const visibleTotal   = activeRoute.filter(cp => !cp.hidden).length;
  const visibleVisited = activeRoute.reduce((n, cp, i) => (!cp.hidden && visitedLore[i]) ? n + 1 : n, 0);
  const pct = visibleTotal > 0 ? Math.min((visibleVisited / visibleTotal) * 100, 100) : 0;
  if (hudFill) hudFill.style.width = `${pct}%`;
}

function saveRouteProgress() {
  if (!activeRoute || !activeRouteName) {
    localStorage.removeItem("pqa_activeRoute");
    return;
  }

  const data = {
    name: activeRouteName,
    index: activeIndex,
    visited: visitedLore,
    route: activeRoute
  };

  localStorage.setItem("pqa_activeRoute", JSON.stringify(data));
}

function restoreRouteProgress() {
  const raw = localStorage.getItem("pqa_activeRoute");
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);
    if (!data || !data.route || !Array.isArray(data.route)) return false;

    // Show resume banner instead of auto-restoring
    showResumeBanner(data);
    return true;

  } catch (e) {
    console.warn("Failed to restore route progress:", e);
    return false;
  }
}

function showHUD() {
  if (!hud) return;
  hud.classList.remove("hidden");

  const findingsBtn = document.getElementById("hud-findings-btn");
  if (findingsBtn) findingsBtn.classList.remove("hidden");

  updateHUD();
}

function hideHUD() {
  if (!hud) return;
  hud.classList.add("hidden");

  const findingsBtn = document.getElementById("hud-findings-btn");
  if (findingsBtn) findingsBtn.classList.add("hidden");
}

// NOTE: findingsBtn is declared and wired in the FINDINGS DRAWER section below.

/* ============================================================
   RESUME ROUTE BANNER
   ============================================================ */

function showResumeBanner(data) {
  const banner = document.getElementById("resume-banner");
  const text = document.getElementById("resume-banner-text");
  const btnContinue = document.getElementById("resume-continue-btn");
  const btnDiscard = document.getElementById("resume-discard-btn");

  if (!banner || !text) return;

  text.textContent = `Resume your route: ${data.name}`;

  banner.classList.remove("hidden");
  requestAnimationFrame(() => banner.classList.add("show"));

  btnContinue.onclick = () => {
    banner.classList.remove("show");
    setTimeout(() => banner.classList.add("hidden"), 250);

    // Restore the route visually
    clearRoute();
    showRoute(data.route, data.name, true);

    activeIndex = data.index || 0;
    visitedLore = data.visited || {};

    updateCheckpointStates();
    updateHUD();
    updateCompass();
  };

  btnDiscard.onclick = () => {
    banner.classList.remove("show");
    setTimeout(() => banner.classList.add("hidden"), 250);
    localStorage.removeItem("pqa_activeRoute");
  };
}



/* ============================================================
   CHECKPOINT STATE SYSTEM + TAP BEHAVIOR
   ============================================================ */

/*
This system replaces the old “inactive/next” logic.
It uses the new CSS classes:
- checkpoint-locked
- checkpoint-next
- checkpoint-completed
- checkpoint-final
*/

const _cpLastState = {};

function updateCheckpointStates() {
  if (!activeRoute || !checkpointMarkers) return;
  const isHunt = activeRouteMode === "hunt";
  let visibleNum = 0;
  const visibleNumbers = activeRoute.map(cp => cp.hidden ? null : ++visibleNum);

  // All state classes we might set — used for removal
  const ALL_STATE = ["cp-locked","cp-next","cp-completed","cp-final",
                     "cp-hunt","cp-hunt-hidden","cp-hunt-invisible",
                     "cp-hunt-far","cp-hunt-near","cp-hunt-close","cp-hunt-reveal"];

  checkpointMarkers.forEach((marker, index) => {
    if (!marker || !marker._icon) return;
    const isFinal   = index === activeRoute.length - 1;
    const isVisited = visitedLore[index] === true;
    const isNext    = index === activeIndex;
    const isHidden  = !!activeRoute[index]?.hidden;
    const num       = isHidden ? "✶" : (visibleNumbers[index] ?? (index + 1));

    let stateClass;
    if (isHunt) {
      if      (isVisited) stateClass = isFinal ? "cp-final" : "cp-completed";
      else if (isNext)    stateClass = "cp-hunt cp-hunt-hidden"; // glow state updated by updateCheckpointScaling
      else                stateClass = "cp-hunt-invisible";
    } else {
      stateClass = "cp-locked";
      if (isFinal && isVisited)  stateClass = "cp-final";
      else if (isVisited)        stateClass = "cp-completed";
      else if (isNext)           stateClass = "cp-next";
    }

    if (_cpLastState[index] === stateClass) return;
    _cpLastState[index] = stateClass;

    // ── DOM mutation — never setIcon ──────────────────────────
    const wrap = marker._icon.querySelector(".cp-flag-wrap");
    if (!wrap) return;

    ALL_STATE.forEach(c => wrap.classList.remove(c));
    stateClass.split(" ").forEach(c => c && wrap.classList.add(c));

    // Sync visibility of inner elements
    const flagEl = wrap.querySelector(".flag-mini");
    const numEl  = wrap.querySelector(".cp-flag-number");

    if (stateClass === "cp-hunt-invisible") {
      // Fully invisible — hide contents, collapse marker footprint
      wrap.style.visibility = "hidden";
      wrap.style.pointerEvents = "none";
      marker._icon.style.pointerEvents = "none";
    } else {
      wrap.style.visibility = "";
      wrap.style.pointerEvents = "";
      marker._icon.style.pointerEvents = "";
    }

    if (stateClass === "cp-hunt cp-hunt-hidden") {
      // Hunt ? marker — hide flag image, show ? number
      if (flagEl) flagEl.style.display = "none";
      if (numEl)  { numEl.style.display = ""; numEl.textContent = "?"; }
    } else if (stateClass !== "cp-hunt-invisible") {
      // Normal flag + number
      if (flagEl) flagEl.style.display = "";
      if (numEl) {
        numEl.style.display = "";
        numEl.textContent = num;
        numEl.className = "cp-flag-number" + (isHidden ? " cp-secret-badge" : "");
      }
    }
  });
}

function attachCheckpointTapHandlers() {
  if (!checkpointMarkers) return;

  checkpointMarkers.forEach((marker, index) => {
    if (!marker) return; // hidden checkpoint
    marker.on("click", () => {
      if (!activeRoute) return;
      const isVisited = visitedLore[index] === true;
      const cp = activeRoute[index];

      if (!isVisited) {
        // Give feedback instead of silently ignoring
        if (index > activeIndex) {
          showHintToast("Reach the previous checkpoint first.");
        } else {
          showHintToast("Walk closer to trigger this checkpoint.");
        }
        return;
      }

      openLoreCard({
        title: cp.lore?.title || "Checkpoint " + (index + 1),
        text: cp.lore?.text || "",
        style: cp.lore?.style || "stone"
      });

      if (index === activeRoute.length - 1) {
        completeRoute().catch(console.error);
      }
    });
  });
}


// ============================================
// FINDINGS DRAWER — Route-specific discoveries
// ============================================

const findingsDrawer = document.getElementById("findings-drawer");
const findingsDrawerContent = document.getElementById("findings-drawer-content");
const findingsBtn = document.getElementById("hud-findings-btn");

// Toggle drawer open/close
function toggleFindingsDrawer() {
  if (!findingsDrawer) return;

  const isOpen = findingsDrawer.classList.contains("open");

  if (isOpen) {
    findingsDrawer.classList.remove("open");
  } else {
    populateFindingsDrawer();
    findingsDrawer.classList.add("open");
    clearFindingsPip(); // clear notification when player opens drawer
  }
}

// Build the drawer list
function populateFindingsDrawer() {
  if (!activeRoute || !Array.isArray(activeRoute)) return;

  findingsDrawerContent.innerHTML = "";

  // Hunt mode: show consumed clues at the top of findings so the
  // player can review the clue trail that led them through the route.
  if (activeRouteMode === "hunt" && _huntClueLog && _huntClueLog.length > 0) {
    const clueSection = document.createElement("div");
    clueSection.className = "findings-clue-section";
    clueSection.innerHTML = `<div class="findings-clue-header">🔍 Clues Found</div>`;
    _huntClueLog.forEach(entry => {
      const clueEl = document.createElement("div");
      clueEl.className = "findings-clue-entry";
      clueEl.innerHTML = `
        <span class="findings-clue-num">Clue ${entry.number}</span>
        <span class="findings-clue-text">${entry.text}</span>
      `;
      clueSection.appendChild(clueEl);
    });
    findingsDrawerContent.appendChild(clueSection);

    // Divider between clues and checkpoint lore entries
    const divider = document.createElement("div");
    divider.className = "findings-section-divider";
    findingsDrawerContent.appendChild(divider);
  }

  // Use the same visible number map as the map flags
  let visNum = 0;
  const visibleNumbers = activeRoute.map(cp => cp.hidden ? null : ++visNum);

  activeRoute.forEach((cp, index) => {
    const visited = visitedLore[index] === true;
    const num     = visibleNumbers[index]; // null if hidden

    if (cp.hidden) {
      // Not yet found — completely invisible, no spoilers
      if (!visited) return;

      // Found — show in correct list position with secret styling
      const title = cp.lore?.title || "Secret Discovery";
      const text  = cp.lore?.text  || "";
      const item  = document.createElement("div");
      item.className = "findings-entry findings-entry-hidden";
      item.innerHTML = `
        <div class="entry-header">
          <span class="entry-num-badge entry-num-secret">✦</span>
          <span class="entry-title">${title}</span>
        </div>
        <div class="entry-preview">${text.slice(0, 80)}${text.length > 80 ? "…" : ""}</div>
      `;
      item.addEventListener("click", () => {
        openLoreCard({ title, text, style: cp.lore?.style || "stone" });
      });
      findingsDrawerContent.appendChild(item);
      return;
    }

    // Normal visible checkpoint — number matches the map flag
    const title = cp.lore?.title || `Checkpoint ${num}`;
    const text  = cp.lore?.text  || "";

    const item = document.createElement("div");
    item.className = "findings-entry" + (visited ? "" : " locked");

    item.innerHTML = `
      <div class="entry-header">
        <span class="entry-num-badge">${num}</span>
        <span class="entry-title">${visited ? title : "Checkpoint " + num}</span>
      </div>
      ${visited
        ? `<div class="entry-preview">${text.slice(0, 80)}${text.length > 80 ? "…" : ""}</div>`
        : `<div class="entry-preview entry-locked-label">🔒 Not yet found</div>`
      }
    `;

    if (visited) {
      item.addEventListener("click", () => {
        openLoreCard({ title, text, style: cp.lore?.style || "stone" });
      });
    }

    findingsDrawerContent.appendChild(item);
  });
}

// Button click → toggle drawer
if (findingsBtn) {
  findingsBtn.addEventListener("click", toggleFindingsDrawer);
}

// Close drawer when route ends
function hideFindingsDrawer() {
  if (findingsDrawer) findingsDrawer.classList.remove("open");
  clearFindingsPip();
}

// ── Findings pip helpers ──
function showFindingsPip() {
  const btn = document.getElementById("hud-findings-btn");
  if (btn) btn.classList.add("has-new");
}

function clearFindingsPip() {
  const btn = document.getElementById("hud-findings-btn");
  if (btn) btn.classList.remove("has-new");
}

// Hook into your existing hideHUD()
const _originalHideHUD = hideHUD;
hideHUD = function () {
  _originalHideHUD();
  hideFindingsDrawer();
};

// ======== PREVIEW BANNER ========
const previewBanner = document.getElementById("preview-banner");
const previewBannerText = document.getElementById("preview-banner-text");
const previewStartBtn = document.getElementById("preview-start-btn");

function showPreviewBanner(routeName, mode = "guided") {
  if (!previewBanner || !previewBannerText) return;

  // Find route data for extra info
  const routeData = (window.__allRoutes || []).find(r => r.name === routeName);
  const cpCount = routeData ? (routeData.checkpoints || []).filter(c => !c.hidden).length : 0;
  const distM = routeData ? computeRouteDistance(routeData.checkpoints || []) : 0;
  const distStr = distM > 0 ? (distM < 1000 ? `${Math.round(distM)}m` : `${(distM/1000).toFixed(1)}km`) : "";
  const estMin = distM > 0 ? estimateTimeMinutes(distM) : 0;
  const modeTag = mode === "hunt"
    ? '<span class="route-mode-tag hunt-tag">Hunt</span>'
    : '<span class="route-mode-tag guided-tag">Guided</span>';

  // Narrator byline — look up display name from loaded registry.
  // Falls back to raw id if registry hasn't loaded yet.
  const narratorId = routeData?.narrator || "";
  const narratorName = narratorId
    ? (NARRATORS.find(n => n.id === narratorId)?.name || narratorId.replace(/_/g, " "))
    : "";
  const narratorLine = narratorName
    ? `<div class="preview-banner-narrator">Logs by ${narratorName}</div>`
    : "";

  // Completed indicator
  const isCompleted = window.__completedRoutes?.has(routeName);
  const completedChip = isCompleted
    ? `<div style="text-align:center;margin-top:2px;"><span class="preview-banner-completed">✓ Completed</span></div>`
    : "";

  // Hunt mode: show hint on its own line, distance/time stay together in meta row.
  const huntHint = mode === "hunt"
    ? `<div class="preview-banner-hunt-hint">Checkpoints are hidden — explore the trail area to find them.</div>`
    : "";
  const cpMeta = mode === "hunt"
    ? ""
    : (cpCount ? `<span>🚩 ${cpCount} checkpoints</span>` : "");

  previewBannerText.innerHTML = `
    <div class="preview-banner-name">${routeName} ${modeTag}</div>
    ${narratorLine}
    ${completedChip}
    ${huntHint}
    <div class="preview-banner-meta">
      ${cpMeta}
      ${distStr ? `<span>📏 ${distStr}</span>` : ""}
      ${estMin ? `<span>⏱ ~${estMin} min</span>` : ""}
    </div>
  `;

  // Inject exit button if not already present
  if (!document.getElementById("preview-exit-btn")) {
    const exitBtn = document.createElement("button");
    exitBtn.id = "preview-exit-btn";
    exitBtn.className = "preview-exit-btn";
    exitBtn.textContent = "Exit";
    exitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearRoute();
      lastPreviewRouteName = null;
      lastPreviewRouteCheckpoints = null;
      hidePreviewBanner();
    });
    const btnsRow = document.getElementById("preview-banner-btns");
    (btnsRow || previewBanner).appendChild(exitBtn);
  }

  previewBanner.style.display = "flex";
  previewBanner.classList.remove("hidden");
  requestAnimationFrame(() => previewBanner.classList.add("show"));
}

function hidePreviewBanner() {
  if (!previewBanner) return;
  previewBanner.classList.remove("show");
  setTimeout(() => {
    previewBanner.classList.add("hidden");
    previewBanner.style.display = "none";
  }, 250);
}

if (previewBanner) {
  previewBanner.title = "Tap to close preview";
  previewBanner.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent map click
    hidePreviewBanner(); // ⭐ no clearing
  });
}

if (previewStartBtn) {
  previewStartBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    if (!watchId && "geolocation" in navigator) {
      startGeolocationWatch();
    }

    if (!lastPreviewRouteCheckpoints || !lastPreviewRouteName) return;

    const routeData = (window.__allRoutes || []).find(r => r.name === lastPreviewRouteName);
    const routeMode = routeData?.mode || "guided";
    showRoute(lastPreviewRouteCheckpoints, lastPreviewRouteName, true, routeMode);
    hidePreviewBanner();
  });
}

// ======== EXIT ROUTE (Unified) ========
function exitRoute() {
  console.log("Exiting route...");

  // Stop and immediately restart GPS so the user dot keeps moving
  // after exiting a route without needing to tap Recenter.
  stopGeolocationWatch();
  startGeolocationWatch();

  if (routeLine && map.hasLayer(routeLine)) {
    try {
      map.removeLayer(routeLine);
    } catch (e) {}
    routeLine = null;
  }

  if (checkpointMarkers && checkpointMarkers.length) {
    checkpointMarkers.forEach((m) => {
      if (!m) return;
      try {
        if (map.hasLayer(m)) map.removeLayer(m);
      } catch (e) {}
    });
  }
  checkpointMarkers = [];
  window.__checkpointMarkers = checkpointMarkers;

  activeRoute = null;
  activeRouteName = null;
  activeIndex = 0;

  // Hunt mode: remove the fog overlay
  hideHuntFog();

  hideHUD();
  hidePreviewBanner();

  const legacyExitBtn = document.getElementById("exit-route-btn");
  if (legacyExitBtn) legacyExitBtn.classList.add("hidden");

  if (userMarker) {
    try {
      map.setView(userMarker.getLatLng(), 16);
    } catch (e) {}
  }
}

if (hudExit) hudExit.addEventListener("click", exitRoute);
const legacyExitBtn = document.getElementById("exit-route-btn");
if (legacyExitBtn) legacyExitBtn.addEventListener("click", exitRoute);

// ============================================================
// HUNT MODE — FOG OF WAR SYSTEM
// ============================================================
// Overview:
//   A full-screen div (#hunt-fog) sits over the Leaflet map.
//   Its background is a radial-gradient circle (set as an inline
//   style by updateHuntFog()) that is transparent at the route
//   start point and blends to a dark parchment fog everywhere else.
//
//   CSS custom properties drive the gradient geometry:
//     --fog-cx / --fog-cy   route start point in screen px
//     --fog-r               circle radius in px (metres → px at current zoom)
//
//   updateHuntFog() recalculates these on every map move/zoom so
//   the fog stays locked to the correct geographic area.
//
// To tweak visual appearance: edit the CSS in style.css under
//   "HUNT MODE — FOG OF WAR OVERLAY" — no JS changes needed.
// To tweak zone padding: change FOG_PADDING_M below.
// To tweak fog darkness/colour: change FOG_COLOR below.
// ============================================================

// ── Tuning constants ─────────────────────────────────────────
// Extra padding (metres) added beyond the furthest checkpoint
// so the fog wall doesn't clip right at the checkpoint edge.
const FOG_PADDING_M = 80; // ← TUNE: larger = bigger clear zone (metres)

// The dark fog colour that fills everything outside the zone.
// Format: CSS rgba string. Adjust alpha for more/less opacity.
const FOG_COLOR = "rgba(8, 6, 3, 0.86)"; // ← TUNE: fog darkness & tint

// Minimum revealed circle radius (px) — prevents the zone from
// collapsing to a tiny dot on single-checkpoint hunts.
const FOG_MIN_RADIUS_PX = 120; // ← TUNE: min clear zone size (px)
// ─────────────────────────────────────────────────────────────

// Haversine distance in metres between two lat/lng points.
// Top-level utility used by both showHuntFog and updateHuntFog.
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Create the fog overlay element once and append it to #map.
// It starts invisible; JS adds .hunt-fog-active to show it.
const _huntFogEl = (() => {
  let el = document.getElementById("hunt-fog");
  if (!el) {
    el = document.createElement("div");
    el.id = "hunt-fog";
    // Append inside #map so it is clipped to the map viewport
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.appendChild(el);
  }
  return el;
})();

// Geographic anchor for the current hunt zone (set on route start,
// cleared on exit). Used to recompute pixel positions on move/zoom.
// Centre is the route start point; radiusM is metres to furthest checkpoint
// plus FOG_PADDING_M so the fog circle feels intentional, not arbitrary.
let _huntFogZone = null; // { startLat, startLng, radiusM }

/**
 * Recompute the fog gradient geometry from _huntFogZone and
 * apply it as CSS custom properties on _huntFogEl.
 * Called on route start and on every map move / zoom event.
 *
 * The revealed zone is a circle centred on the route start point.
 * Its radius is the real-world distance (metres) from the start to
 * the furthest checkpoint, projected to pixels at the current zoom.
 * This means the circle stays geographically locked as you pan/zoom
 * and reveals nothing about where the checkpoints actually cluster.
 */
function updateHuntFog() {
  if (!_huntFogZone || !_huntFogEl.classList.contains("hunt-fog-active")) return;

  const { startLat, startLng, radiusM } = _huntFogZone;

  // Project the active route's fog circle to screen pixels
  const centre = map.latLngToContainerPoint([startLat, startLng]);
  const cx = centre.x;
  const cy = centre.y;
  const metresToDeg = radiusM / 111320;
  const edgePoint   = map.latLngToContainerPoint([startLat + metresToDeg, startLng]);
  const rPx = Math.max(FOG_MIN_RADIUS_PX, Math.abs(centre.y - edgePoint.y));

  // Write geometry as CSS custom properties so the ::after ring
  // pseudo-element (defined in style.css) can read the same values.
  _huntFogEl.style.setProperty("--fog-cx", cx + "px");
  _huntFogEl.style.setProperty("--fog-cy", cy + "px");
  _huntFogEl.style.setProperty("--fog-r",  rPx + "px");

  // ── Completed route holes ────────────────────────────────
  // For each completed route, punch a transparent hole in the fog
  // so the player can always see areas they've already explored.
  const completedHoles = [];
  const allRoutes = window.__allRoutes || [];
  const completedNames = window.__completedRoutes || new Set();

  completedNames.forEach(routeName => {
    const route = allRoutes.find(r => r.name === routeName);
    if (!route?.checkpoints?.length) return;

    // Find start point of completed route
    const startCp = route.checkpoints.find(cp => !cp.hidden) ?? route.checkpoints[0];
    const sLat = parseFloat(startCp.lat ?? startCp.Lat ?? startCp.latitude);
    const sLng = parseFloat(startCp.lng ?? startCp.Lng ?? startCp.longitude);
    if (isNaN(sLat) || isNaN(sLng)) return;

    // Compute radius to furthest checkpoint (same logic as showHuntFog)
    const latlngs = route.checkpoints.map(cp => ({
      lat: parseFloat(cp.lat ?? cp.Lat ?? cp.latitude),
      lng: parseFloat(cp.lng ?? cp.Lng ?? cp.longitude)
    })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

    const maxDistM = Math.max(...latlngs.map(p => haversineM(sLat, sLng, p.lat, p.lng)));
    const holeRadiusM = maxDistM + FOG_PADDING_M;

    // Project to screen pixels
    const holeCentre  = map.latLngToContainerPoint([sLat, sLng]);
    const holeEdge    = map.latLngToContainerPoint([sLat + holeRadiusM / 111320, sLng]);
    const holeRPx     = Math.max(FOG_MIN_RADIUS_PX, Math.abs(holeCentre.y - holeEdge.y));

    completedHoles.push({
      cx: holeCentre.x,
      cy: holeCentre.y,
      r:  holeRPx
    });
  });

  // Build layered background — completed holes first (on top), active route circle last
  // Each hole is a radial-gradient that is transparent inside and fully transparent outside
  // so it only "erases" fog where it overlaps the main fog gradient beneath it.
  const holeLayers = completedHoles.map(h =>
    `radial-gradient(circle ${h.r}px at ${h.cx}px ${h.cy}px, transparent 0%, transparent 72%, rgba(8,6,3,0.15) 85%, transparent 100%)`
  );

  const mainFog = [
    "radial-gradient(",
      `circle ${rPx}px at ${cx}px ${cy}px,`,
      "transparent              0%,",
      "transparent             68%,",
      `rgba(8,6,3,0.35)        80%,`,
      `rgba(8,6,3,0.68)        90%,`,
      `${FOG_COLOR}           100%`,
    ")"
  ].join(" ");

  // Combine: completed holes punch through on top of the main fog layer
  _huntFogEl.style.background = [...holeLayers, mainFog].join(", ");
}

/**
 * Activate the fog for a hunt route.
 * @param {Array} checkpoints — the route's checkpoint array
 *
 * The fog is a circle centred on the route start point (first
 * non-hidden checkpoint, or checkpoints[0] as fallback).
 * Its radius is the Haversine distance from the start to the
 * furthest checkpoint, plus FOG_PADDING_M, so the fog boundary
 * gives away nothing about checkpoint distribution.
 */
function showHuntFog(checkpoints) {
  // Collect all valid lat/lng values from the checkpoint list
  const latlngs = checkpoints
    .map(cp => {
      const lat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
      const lng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
      return isNaN(lat) || isNaN(lng) ? null : { lat, lng };
    })
    .filter(Boolean);

  if (!latlngs.length) return;

  // Centre on the first non-hidden checkpoint (the route start).
  // Falls back to checkpoints[0] if all are hidden (edge case).
  const startCp = checkpoints.find(cp => !cp.hidden) ?? checkpoints[0];
  const startLat = parseFloat(startCp.lat ?? startCp.Lat ?? startCp.latitude);
  const startLng = parseFloat(startCp.lng ?? startCp.Lng ?? startCp.longitude);

  // Radius = distance from start to the furthest checkpoint + padding
  const maxDistM = Math.max(...latlngs.map(p => haversineM(startLat, startLng, p.lat, p.lng)));
  const radiusM  = maxDistM + FOG_PADDING_M;

  _huntFogZone = { startLat, startLng, radiusM };

  // Initial render before the class fade-in so there's no flash
  updateHuntFog();
  _huntFogEl.classList.add("hunt-fog-active");
}

/**
 * Deactivate and reset the fog overlay.
 * Called from clearRoute() and exitRoute().
 */
function hideHuntFog() {
  _huntFogEl.classList.remove("hunt-fog-active");
  _huntFogZone = null;
  // Clear inline styles so the element is fully reset
  _huntFogEl.style.background = "";
  _huntFogEl.style.removeProperty("--fog-cx");
  _huntFogEl.style.removeProperty("--fog-cy");
  _huntFogEl.style.removeProperty("--fog-r");
}

// Keep the fog locked to the map as the user pans or zooms.
// These listeners are always registered but updateHuntFog()
// returns immediately when no hunt is active (_huntFogZone null).
map.on("move zoom", updateHuntFog);

// ── END HUNT MODE — FOG OF WAR SYSTEM ───────────────────────

// ======== showRoute ========
function showRoute(checkpoints, routeName, isActiveRoute = false, mode = "guided") {

  // ⭐ FIX: Always reset any stuck route when entering preview mode
  if (!isActiveRoute) {
    activeRoute = null;
    activeRouteName = null;
    activeRouteMode = "guided";
    activeIndex = 0;
    visitedLore = {};
  }

  console.log("[debug] showRoute()", {
    routeName,
    isActiveRoute,
    checkpointCount: checkpoints?.length ?? 0,
    time: Date.now()
  });

  clearRoute();

  const routeLineLayer = L.layerGroup().addTo(map);
  const checkpointLayer = L.layerGroup().addTo(map);

  window.__routeLineLayer = routeLineLayer;
  window.__checkpointLayer = checkpointLayer;

  // expose functions for console
  window.showRoute = showRoute;
  window.clearRoute = clearRoute;

  routeLayer = routeLineLayer;
  checkpointMarkers = [];
  window.__checkpointMarkers = checkpointMarkers;

  const latlngs = [];

  // Pre-compute visible numbers — hidden checkpoints are skipped
  let visNum = 0;
  const visibleNumbers = checkpoints.map(cp => cp.hidden ? null : ++visNum);

checkpoints.forEach((cp, index) => {
  const lat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
  const lng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
  if (isNaN(lat) || isNaN(lng)) return;

  // Hidden: starts invisible, revealed by proximity in updateCheckpointScaling
  if (cp.hidden) {
    const hiddenMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div class="cp-flag-wrap cp-hidden-secret" style="opacity:0;pointer-events:none;"><div class="flag-mini"></div><div class="cp-flag-number cp-secret-badge">✦</div></div>',
        className: "",
        iconSize:  [32, 40],
        iconAnchor:[4, 40]
      }),
      pane: "checkpointPane",
      interactive: false
    });
    checkpointLayer.addLayer(hiddenMarker);
    checkpointMarkers.push(hiddenMarker);
    return;
  }

  // Expand waypoints (path shape between checkpoints) before the checkpoint itself
  if (Array.isArray(cp.waypoints)) {
    cp.waypoints.forEach(w => {
      const wlat = parseFloat(w.lat ?? w.Lat);
      const wlng = parseFloat(w.lng ?? w.Lng);
      if (!isNaN(wlat) && !isNaN(wlng)) latlngs.push([wlat, wlng]);
    });
  }

  latlngs.push([lat, lng]);

  const lore = cp.lore || null;
  const num = visibleNumbers[index];

  const isHunt = (mode === "hunt");
  // Always render full structure — state changes use class mutation, never setIcon
  const initialClass = isHunt ? "cp-flag-wrap cp-hunt cp-hunt-hidden" : "cp-flag-wrap cp-locked";
  const flagDisplay  = isHunt ? ' style="display:none"' : '';
  const numDisplay   = isHunt ? ' style="display:none"' : '';
  const icon = L.divIcon({
    html: '<div class="' + initialClass + '"><div class="flag-mini"' + flagDisplay + '></div><div class="cp-flag-number"' + numDisplay + '>' + num + '</div></div>',
    className: "",
    iconSize:  [32, 40],
    iconAnchor:[4, 40]
  });

  const marker = L.marker([lat, lng], {
    icon,
    pane: "checkpointPane",
    interactive: true
  });

  checkpointLayer.addLayer(marker);

  if (typeof marker.setZIndexOffset === "function") {
    marker.setZIndexOffset(2000 + index);
  }

  checkpointMarkers.push(marker);
});

// After creating all markers:
window.__checkpointMarkers = checkpointMarkers;

// Apply initial states and attach tap handlers
if (typeof updateCheckpointStates === "function") updateCheckpointStates();
if (typeof attachCheckpointTapHandlers === "function") attachCheckpointTapHandlers();

  // Hunt mode: never draw the route polyline — it would reveal the path.
  // latlngs is still built above so fitBounds works correctly.
  if (latlngs.length > 0 && mode !== "hunt") {
    routeLine = L.polyline(latlngs, {
      color: "#00ff99",
      weight: 4,
      opacity: 0.7,
      className: "route-glow",
      interactive: false,
      pane: "overlayPane"
    });

    routeLineLayer.addLayer(routeLine);

    if (typeof routeLine.bringToBack === "function") {
      try {
        routeLine.bringToBack();
      } catch (e) {}
    }
  }

  // fitBounds using ALL checkpoints including hidden so preview always zooms
  const allLatLngs = checkpoints
    .map(cp => {
      const lat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
      const lng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
      return isNaN(lat) || isNaN(lng) ? null : [lat, lng];
    })
    .filter(Boolean);

  if (allLatLngs.length > 0) {
    try {
      map.fitBounds(allLatLngs, { padding: [40, 40] });
      setTimeout(() => map.setZoom(map.getZoom() + 0.5), 120);
    } catch (e) {}
  }

  routeLineLayer._isRouteLineLayer = true;
  checkpointLayer._isCheckpointLayer = true;

  // Expose again after creation
  window.__routeLineLayer = routeLineLayer;
  window.__checkpointLayer = checkpointLayer;
  window.__checkpointMarkers = checkpointMarkers;

  if (isActiveRoute) {
    activeRoute         = checkpoints;
    activeRouteName     = routeName;
    activeRouteMode     = mode;
    activeRouteNarrator = (window.__allRoutes || []).find(r => r.name === routeName)?.narrator || "";
    activeIndex = 0;

    saveRouteProgress();

    // Centre on the user when the route starts
    if (userLatLng) {
      map.flyTo([userLatLng.lat, userLatLng.lng], 17, {
        animate: true,
        duration: 1.2
      });
    }

    hidePreviewBanner();
    showHUD();

    // Reset findings drawer for the new route
    hideFindingsDrawer();
    if (findingsDrawerContent) findingsDrawerContent.innerHTML = "";

    // Hunt mode: activate fog overlay over the map
    if (mode === "hunt") {
      showHuntFog(checkpoints);
    }

    // Hunt mode: first clue is shown on proximity to CP0, not immediately.
    // showClueInHUD() is called by the checkpoint-found flow (step 9 below).
    // Initialise the HUD clue row so it's ready but empty.
    if (mode === "hunt") {
      initHudClueRow();
    }

    // Fire immediately if already standing inside a checkpoint
    setTimeout(checkCheckpointsNow, 500);
  } else {
    activeRoute = null;
    activeRouteName = null;
    activeIndex = 0;

    lastPreviewRouteName = routeName;
    lastPreviewRouteCheckpoints = checkpoints;

    hideHUD();
    // Hunt preview: show fog and pass mode so banner shows hunt copy
    if (mode === "hunt") {
      showHuntFog(checkpoints);
    }
    showPreviewBanner(routeName, mode);
  }
}

// ======== HUD Pause / Resume ========
if (hudPause) {
  hudPause.addEventListener("click", () => {
    routePaused = !routePaused;
    hudPause.textContent = routePaused ? "Resume" : "Pause";

    if (routePaused && watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    } else if (!routePaused && !watchId && "geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        updateUserMarker,
        (err) => {
          console.warn("GPS error (resume):", err);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 20000
        }
      );
    }
  });
}

window.__completedRoutes = new Set();

async function loadCompletedRoutes() {
  const user = auth.currentUser;
  if (!user) return;

  const snap = await getDocs(collection(db, "Users", user.uid, "routeHistory"));
  snap.forEach(doc => {
    const name = doc.data().routeName;
    if (name) window.__completedRoutes.add(name);
  });
}

/* ============================================================
   LOAD ROUTES (from Firestore — collection: Hikes)
============================================================ */

async function loadAllRoutes() {
  setSplashProgress(60, "Loading routes…");

  const snap = await getDocs(collection(db, "Hikes"));

  const data = snap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      name:       d.Name,
      checkpoints: d.Checkpoints,
      mode:       d.mode     || "guided",
      narrator:   d.narrator || ""        // narrator id — matches NARRATORS registry
    };
  });

  console.log(`Routes loaded from Firestore: ${data.length} routes.`);
  window.__allRoutes = data;

  setSplashProgress(85, "Placing markers…");
  renderAllRoutes(data);

  setSplashProgress(100, "Ready!");
  setTimeout(hideSplash, 400);

  return data;
}

// ======== RENDER ALL ROUTES — populate routes[] + place trailhead markers ========
function renderAllRoutes(data) {
  if (!data || !Array.isArray(data)) return;

  // Clear existing state
  routes = [];
  startMarkersLayer.clearLayers();
  trailheadMarkers = [];

  data.forEach((route) => {
    if (!route || !Array.isArray(route.checkpoints) || route.checkpoints.length === 0) return;

    // Apply auto lore styles so checkpoints have style/title/text set
    applyAutoLoreStylesToRoute(route.name, route.checkpoints);

    // Add to routes array (used by nearby detection)
    routes.push(route);

    // Place trailhead start marker at first checkpoint
    const start = route.checkpoints[0];
    const lat = parseFloat(start.lat ?? start.Lat ?? start.latitude);
    const lng = parseFloat(start.lng ?? start.Lng ?? start.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const isCompleted = window.__completedRoutes?.has(route.name);
    const icon = isCompleted ? createGoldFlagIcon() : createStartIcon();

    const marker = L.marker([lat, lng], { icon, interactive: true })
      .addTo(startMarkersLayer);
    trailheadMarkers.push({ marker, isCompleted, lat, lng });

    // Add ✓ chip for already-completed routes.
    // Short defer ensures Leaflet has inserted the icon into the DOM.
    if (isCompleted) {
      setTimeout(() => {
        if (marker._icon && !marker._icon.querySelector(".trailhead-done-chip")) {
          const chip = document.createElement("div");
          chip.className = "trailhead-done-chip";
          chip.textContent = "✓";
          marker._icon.appendChild(chip);
        }
      }, 100);
    }

    marker.on("click", () => {
      // Don't allow previewing another route while one is active
      if (activeRoute) return;
      showRoute(route.checkpoints, route.name, false, route.mode || "guided");
    });
  });

  console.log(`[renderAllRoutes] ${routes.length} routes rendered on map.`);
  if (userLatLng) updateRouteDistanceClasses();
}

const ROUTE_VISIBLE_M = 15000;
const ROUTE_FOG_M     = 30000;

function updateRouteDistanceClasses() {
  if (!userLatLng || !trailheadMarkers.length) return;
  trailheadMarkers.forEach(({ marker, lat, lng }) => {
    if (!marker || !marker._icon) return;
    if (isNaN(lat) || isNaN(lng)) return;
    const dist = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
    const el   = marker._icon.querySelector(".flag-anim");
    if (!el) return;
    el.classList.remove("route-fog", "route-hidden");
    marker.options.interactive = true;
    if (dist > ROUTE_FOG_M) {
      el.classList.add("route-hidden");
      marker.options.interactive = false;
    } else if (dist > ROUTE_VISIBLE_M) {
      el.classList.add("route-fog");
      const t = (dist - ROUTE_VISIBLE_M) / (ROUTE_FOG_M - ROUTE_VISIBLE_M);
      el.style.opacity = Math.max(0.08, 1 - t * 0.92).toFixed(2);
      marker.options.interactive = false;
    } else {
      el.style.opacity = "";
    }
  });
}

// Routes are loaded inside onAuthStateChanged so they only run once,
// after the user is confirmed signed in. Removed top-level call here
// to prevent duplicate trailhead markers on the map.

// ======================================================
// ⭐ ROUTE BUILDER — Auto‑Assign Lore Styles
// ======================================================

// Styles your lore card already supports
const AUTO_LORE_STYLES = [
  "stone",
  "forest",
  "ember",
  "metal",
  "parchment",
  "rune"
];

// Pick a style for a route (consistent per route)
function pickStyleForRoute(routeName) {
  // Stable hash → consistent style per route
  let hash = 0;
  for (let i = 0; i < routeName.length; i++) {
    hash = (hash + routeName.charCodeAt(i) * (i + 1)) % 9999;
  }
  return AUTO_LORE_STYLES[hash % AUTO_LORE_STYLES.length];
}

// Apply auto‑styles to checkpoints
function applyAutoLoreStylesToRoute(routeName, checkpoints) {
  const routeStyle = pickStyleForRoute(routeName);

  checkpoints.forEach((cp, index) => {
    // Ensure cp.lore exists
    if (!cp.lore) cp.lore = {};

    // Assign style only if not already set
    if (!cp.lore.style) {
      cp.lore.style = routeStyle;
    }

    // Auto‑generate a title if missing
    if (!cp.lore.title) {
      cp.lore.title = `Checkpoint ${index + 1}`;
    }

    // Ensure text exists (empty string allowed)
    if (!cp.lore.text) {
      cp.lore.text = "";
    }
  });

  return checkpoints;
}


// ======== COMPASS / HEADING ========
const compassEl = document.getElementById("compass");

// Tap compass to snap map back to north
if (compassEl) {
  compassEl.style.cursor = "pointer";
  compassEl.addEventListener("click", () => {
    if (!map.setBearing) return;
    // Disable gyro-driven rotation so the map stays north-up after tap
    if (map.compassBearing && map.compassBearing.enabled()) {
      map.compassBearing.disable();
    }
    userHeading = 0;
    map.setBearing(0);
    compassEl.style.transform = "rotate(0deg)";
  });
}

function updateCompass() {
  // Compass rotation is handled entirely by handleOrientation and map bearing changes.
  // Nothing to do here — kept as a no-op so existing callers don't break.
}

const _cpLastGlow = {};

function updateCheckpointScaling() {
  if (!userLatLng || !activeRoute) return;
  const isHunt = activeRouteMode === "hunt";
  let visNum = 0;
  const visibleNumbers = activeRoute.map(cp => cp.hidden ? null : ++visNum);

  checkpointMarkers.forEach((m, i) => {
    if (!m || !m._icon) return;
    const cp = activeRoute[i];
    if (!cp) return;
    const isVisited = visitedLore[i] === true;
    const isNext    = i === activeIndex;
    const num       = visibleNumbers[i] ?? (i + 1);
    // Hidden checkpoints — proximity-based materialise effect
    if (cp.hidden && !isVisited) {
      const el = m._icon?.querySelector(".cp-hidden-secret");
      if (!el) return;
      const cpLat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
      const cpLng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
      const d = distanceInMeters(userLatLng.lat, userLatLng.lng, cpLat, cpLng);

      let hiddenState;
      if      (d <= 15) hiddenState = "reveal";
      else if (d <= 40) hiddenState = "near";
      else              hiddenState = "hidden";

      if (_cpLastGlow[`h${i}`] === hiddenState) return;
      _cpLastGlow[`h${i}`] = hiddenState;

      if (hiddenState === "hidden") {
        el.style.opacity = "0";
        el.style.filter  = "";
        m.options.interactive = false;
        if (m._icon) m._icon.style.pointerEvents = "none";
      } else if (hiddenState === "near") {
        // Ghost — greyscale, translucent, animated float
        el.style.opacity = "0.35";
        el.style.filter  = "grayscale(1) brightness(0.7)";
        el.classList.remove("cp-hidden-reveal");
        el.classList.add("cp-hidden-near");
        m.options.interactive = false;
        if (m._icon) m._icon.style.pointerEvents = "none";
      } else {
        // Full gold reveal — tappable
        el.style.opacity = "1";
        el.style.filter  = "";
        el.classList.remove("cp-hidden-near");
        el.classList.add("cp-hidden-reveal");
        m.options.interactive = true;
        if (m._icon) m._icon.style.pointerEvents = "auto";
      }
      return;
    }

    if (isVisited) return;
    if (!isNext) return;

    const lat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
    const lng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
    const d   = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
    // Use ✦ for hidden checkpoints, never a number
    const displayNum = cp.hidden ? "✶" : num;
    const badgeClass = cp.hidden ? " cp-secret-badge" : "";

    if (isHunt) {
      let huntState;
      if      (d <= 8)  huntState = "cp-hunt-reveal";
      else if (d <= 20) huntState = "cp-hunt-close";
      else if (d <= 40) huntState = "cp-hunt-near";
      else              huntState = "cp-hunt-far";

      if (_cpLastGlow[i] === huntState) return;
      _cpLastGlow[i] = huntState;

      const wrap = m._icon.querySelector(".cp-flag-wrap");
      if (!wrap) return;
      const flagEl = wrap.querySelector(".flag-mini");
      const numEl  = wrap.querySelector(".cp-flag-number");

      // Remove previous hunt proximity classes
      ["cp-hunt","cp-hunt-hidden","cp-hunt-far","cp-hunt-near","cp-hunt-close","cp-hunt-reveal"].forEach(c => wrap.classList.remove(c));

      if (huntState === "cp-hunt-far") {
        wrap.style.visibility = "hidden";
        wrap.style.pointerEvents = "none";
        m._icon.style.pointerEvents = "none";
      } else if (huntState === "cp-hunt-near") {
        // Ambient glow only — no flag, no ?
        wrap.style.visibility = "";
        wrap.style.pointerEvents = "none";
        m._icon.style.pointerEvents = "none";
        wrap.classList.add("cp-hunt", "cp-hunt-near");
        if (flagEl) flagEl.style.display = "none";
        if (numEl)  numEl.style.display  = "none";
      } else if (huntState === "cp-hunt-close") {
        // Show ? badge
        wrap.style.visibility = "";
        wrap.style.pointerEvents = "none";
        m._icon.style.pointerEvents = "none";
        wrap.classList.add("cp-hunt", "cp-hunt-close");
        if (flagEl) flagEl.style.display = "none";
        if (numEl)  { numEl.style.display = ""; numEl.textContent = "?"; }
      } else {
        // Reveal — show full flag with number
        wrap.style.visibility = "";
        wrap.style.pointerEvents = "";
        m._icon.style.pointerEvents = "";
        wrap.classList.add("cp-next", "cp-glow-close");
        if (flagEl) flagEl.style.display = "";
        if (numEl)  { numEl.style.display = ""; numEl.textContent = displayNum; numEl.className = "cp-flag-number" + badgeClass; }
      }
      return;
    }

    // Guided — mutate glow class only, no setIcon
    let glowClass = (d < 20) ? "cp-glow-close" : "";
    if (_cpLastGlow[i] === glowClass) return;
    _cpLastGlow[i] = glowClass;
    const wrap = m._icon.querySelector(".cp-flag-wrap");
    if (!wrap) return;
    wrap.classList.remove("cp-glow-close");
    if (glowClass) wrap.classList.add(glowClass);
  });
}

let userHeading = 0;

if (window.DeviceOrientationEvent) {
  // iOS 13+ requires permission
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === "granted") {
        window.addEventListener("deviceorientation", handleOrientation);
      }
    }).catch(console.error);
  } else {
    window.addEventListener("deviceorientation", handleOrientation);
  }
}

function handleOrientation(ev) {
  if (ev.alpha === null) return;
  userHeading = ev.alpha;
  // Rotate the map to face the direction the user is heading
  if (map.setBearing) map.setBearing(userHeading);
  // Compass counter-rotates so N always faces screen-north
  if (compassEl) compassEl.style.transform = `rotate(${-userHeading}deg)`;
}

// Keep compass in sync when map is rotated manually (two-finger twist)
// Also suppress marker transitions during rotation so pins stay locked.
map.on("rotatestart", () => map.getContainer().classList.add("map-moving"));
map.on("rotateend",   () => map.getContainer().classList.remove("map-moving"));
map.on("rotate", () => {
  const bearing = map.getBearing ? map.getBearing() : 0;
  if (compassEl) compassEl.style.transform = `rotate(${-bearing}deg)`;
});

// ======== USER LOCATION WATCH ========
function checkCheckpointsNow() {
  if (!activeRoute || !Array.isArray(activeRoute) || !userLatLng) return;
  activeRoute.forEach((cp, i) => {
    if (visitedLore[i]) return;
    const cpLat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
    const cpLng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
    if (isNaN(cpLat) || isNaN(cpLng)) return;
    const dist   = distanceInMeters(userLatLng.lat, userLatLng.lng, cpLat, cpLng);
    const radius = parseFloat(cp.radius) || 25;
    if (dist <= radius && !checkpointDwellTimers[i]) {
      checkpointDwellTimers[i] = setTimeout(() => {
        const confirmDist = distanceInMeters(userLatLng.lat, userLatLng.lng, cpLat, cpLng);
        if (confirmDist <= radius && !visitedLore[i]) {
          if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
          checkpointSound.currentTime = 0;
          checkpointSound.play().catch(() => {});
          if (cp.lore?.text) {
            triggerCheckpointLore(i, { title: cp.lore.title || `Checkpoint ${i + 1}`, text: cp.lore.text || "", style: cp.lore.style || "stone", author: activeRouteNarrator });
          } else {
            visitedLore[i] = true;

            // Grant item immediately — no lore card is open so toast fires right away
            if (cp?.item) grantItem(cp.item, false, !!cp.oneTimeItem);

            const lastVisIdx = activeRoute.reduce((last, cp, idx) => cp.hidden ? last : idx, -1);
            const isFinal = i === lastVisIdx;
            if (activeIndex === i && !isFinal) { activeIndex = i + 1; saveRouteProgress(); }
            if (isFinal) pendingRouteComplete = true;
            const msg = LORE_DISCOVERY_MESSAGES[Math.floor(Math.random() * LORE_DISCOVERY_MESSAGES.length)];
            showLoreToast(`${msg} — Checkpoint ${i + 1}`);
            if (typeof updateCheckpointStates === "function") updateCheckpointStates();
            updateHUD(); updateCompass();
          }
        }
        delete checkpointDwellTimers[i];
      }, CHECKPOINT_DWELL_MS);
    }
  });
}

function updateUserMarker(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const firstFix = !userLatLng;
  userLatLng = { lat, lng };

  // Fly to user on first GPS fix so the map centres on where they actually are.
  // Only do this if no route is active (don't interrupt a route flyTo).
  if (firstFix && !activeRoute) {
    map.flyTo([lat, lng], 15, { animate: true, duration: 1.0 });
  }

  // Render POI markers on first GPS fix — they were intentionally
  // withheld until we know the player's position.
  if (firstFix && worldPOIs.length > 0) {
    renderWorldPOIs();
  }

  // Hide GPS waiting indicator once we have a fix
  const gpsWaiting = document.getElementById("gps-waiting");
  if (gpsWaiting) gpsWaiting.style.display = "none";

  if (!userMarker) {
    userMarker = L.marker([lat, lng], {
      icon: createUserIcon(),
      interactive: false,
      pane: "userPane"
    }).addTo(map);
    // Force pointer-events off on the Leaflet icon DOM node — iOS Safari
    // ignores interactive:false for touch events without this.
    if (userMarker._icon) {
      userMarker._icon.style.pointerEvents = "none";
    }
    updateMarkersForZoom(map.getZoom());
  }

  // Keep pointer-events off after every update (Leaflet can reset it)
  if (userMarker._icon) userMarker._icon.style.pointerEvents = "none";

  userMarker.setLatLng([lat, lng]);

  // Smooth auto-follow: only recenter when user drifts away from map center
  if (!userIsPanning) {
    const center = map.getCenter();
    const distFromCenter = distanceInMeters(center.lat, center.lng, lat, lng);
    if (distFromCenter > 40) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16), {
        animate: true,
        duration: 1.0
      });
    }
  }

  updateCompass();
  updateHUD();
  updateCheckpointScaling();

  // ============================
  // ⭐ PROXIMITY-BASED LORE TRIGGER (with dwell timer)
  // ============================
  if (activeRoute && Array.isArray(activeRoute)) {
    activeRoute.forEach((cp, i) => {
      if (visitedLore[i] || !cp.lore) return;

      const lat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
      const lng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const dist = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
      const radius = parseFloat(cp.radius) || 25;

      if (dist <= radius) {
        // User is inside radius — start dwell timer if not already running
        if (!checkpointDwellTimers[i]) {
          checkpointDwellTimers[i] = setTimeout(() => {
            // Confirm still inside radius when timer fires
            const confirmLat = parseFloat(cp.lat ?? cp.Lat ?? cp.latitude);
            const confirmLng = parseFloat(cp.lng ?? cp.Lng ?? cp.longitude);
            const confirmDist = distanceInMeters(userLatLng.lat, userLatLng.lng, confirmLat, confirmLng);
            if (confirmDist <= radius && !visitedLore[i]) {
              // Haptic feedback
              if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
              // Sound
              checkpointSound.currentTime = 0;
              checkpointSound.play().catch(() => {});
              // Trigger lore
              triggerCheckpointLore(i, {
                title:  cp.lore.title || `Checkpoint ${i + 1}`,
                text:   cp.lore.text  || "",
                style:  cp.lore.style || "stone",
                author: activeRouteNarrator
              });
            }
            delete checkpointDwellTimers[i];
          }, CHECKPOINT_DWELL_MS);
        }
      } else {
        // User left radius — cancel dwell timer
        if (checkpointDwellTimers[i]) {
          clearTimeout(checkpointDwellTimers[i]);
          delete checkpointDwellTimers[i];
        }
      }
    });
  }

  // ============================
  // ⭐ WORLD POI PROXIMITY CHECK
  // ============================
  checkPOIProximity();
  updatePOIDistanceClasses();
  updateRouteDistanceClasses();
}

// ======== AUTO-FOLLOW + RECENTER ========
let userIsPanning = false;
let recenterTimeout = null;

// ======== CHECKPOINT ARRIVAL STATE ========
// Tracks how long the user has been inside each checkpoint radius (dwell detection)
const checkpointDwellTimers = {};

// Flag: final checkpoint lore was shown — complete route after lore card closes
let pendingRouteComplete = false;
let pendingItemToast     = null;  // {name, iconSrc, rarity} — shown after lore card closes
const CHECKPOINT_DWELL_MS = 1500; // must stay inside radius for 1.5s to trigger
const checkpointSound = new Audio("audio/checkpoint-found.mp3");
const pageFlipSound    = new Audio("audio/page-flip.mp3");
const parchmentSound   = new Audio("audio/parchment-open.mp3");

const recenterBtn = document.getElementById("recenter-btn");
if (recenterBtn) {
  map.on("movestart", () => {
    userIsPanning = true;
    recenterBtn.style.display = "flex";
    if (recenterTimeout) clearTimeout(recenterTimeout);
    // Don't add map-moving during zoom or flyTo animation — it suppresses
    // marker transitions that Leaflet needs for smooth repositioning.
    if (!map._animatingZoom && !map._flying) map.getContainer().classList.add("map-moving");
  });

  map.on("moveend", () => {
    if (recenterTimeout) clearTimeout(recenterTimeout);
    recenterTimeout = setTimeout(() => {
      userIsPanning = false;
      recenterBtn.style.display = "none";
    }, 4000);
    map.getContainer().classList.remove("map-moving");
  });

  map.on("click", () => {
    if (!watchId && "geolocation" in navigator) {
      startGeolocationWatch();
    }
  });


  recenterBtn.addEventListener("click", () => {
    // Ensure GPS is running if user explicitly wants to recenter
    if (!watchId && "geolocation" in navigator) {
      startGeolocationWatch();
    }
    if (userLatLng) {
      map.flyTo([userLatLng.lat, userLatLng.lng], 17.5, {
        animate: true,
        duration: 1.2
      });
    }
    userIsPanning = false;
    recenterBtn.style.display = "none";
  });
}

// ======== NEARBY START HELPERS ========
const NEARBY_MAX_DIST_M = 15000; // 15km — show routes within this radius
const START_TRIGGER_RADIUS = 60;
const START_BUFFER = 20;

function getAllRoutesWithDistance() {
  if (!userLatLng || !routes || routes.length === 0) return [];

  const results = [];
  routes.forEach((r) => {
    const start = r.checkpoints?.[0];
    if (!start) return;
    const lat = parseFloat(start.lat ?? start.Lat ?? start.latitude);
    const lng = parseFloat(start.lng ?? start.Lng ?? start.longitude);
    if (isNaN(lat) || isNaN(lng)) return;
    const d = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
    if (d <= NEARBY_MAX_DIST_M) results.push({ route: r, dist: d });
  });

  results.sort((a, b) => a.dist - b.dist);
  return results;
}

function getStartableRoutesWithinRadius() {
  if (!userLatLng || !routes || routes.length === 0) return [];
  const maxDist = START_TRIGGER_RADIUS + START_BUFFER;
  return routes
    .filter(r => {
      const start = r.checkpoints?.[0];
      if (!start) return false;
      const lat = parseFloat(start.lat ?? start.Lat ?? start.latitude);
      const lng = parseFloat(start.lng ?? start.Lng ?? start.longitude);
      if (isNaN(lat) || isNaN(lng)) return false;
      return distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng) <= maxDist;
    })
    .map(r => {
      const start = r.checkpoints[0];
      const lat = parseFloat(start.lat ?? start.Lat ?? start.latitude);
      const lng = parseFloat(start.lng ?? start.Lng ?? start.longitude);
      return { route: r, dist: distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng) };
    })
    .sort((a, b) => a.dist - b.dist);
}

// ======== ROUTE PREVIEW MODAL FOR NEARBY START ========
const routePreviewBackdrop = document.getElementById("route-preview-backdrop");
const routePreviewModal = document.getElementById("route-preview-modal");
const routePreviewList = document.getElementById("route-preview-list");
const closeRoutePreview = document.getElementById("close-route-preview");

function openRoutePreviewForNearbyStart() {
  if (!routePreviewModal || !routePreviewBackdrop || !routePreviewList) {
    const startables = getStartableRoutesWithinRadius();
    if (startables.length === 0) {
      alert("No routes within starting range yet. Move closer to a trailhead.");
      return;
    }
    const first = startables[0];
    clearRoute();
    showRoute(first.route.checkpoints, first.route.name, true);
    return;
  }

  routePreviewList.innerHTML = "";

  const startables = getStartableRoutesWithinRadius();
  if (startables.length === 0) {
    routePreviewList.innerHTML =
      "<p style='color:#ddd;'>No routes within starting range yet.</p>";
  } else {
    startables.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "route-preview-item";
      btn.textContent = `${item.route.name} — ${Math.round(
        item.dist
      )}m away`;
      btn.addEventListener("click", () => {
        clearRoute();
        showRoute(item.route.checkpoints, item.route.name, true);
        closeRoutePreviewModal();
      });
      routePreviewList.appendChild(btn);
    });
  }

  if (routePreviewBackdrop) routePreviewBackdrop.classList.remove("hidden");
  if (routePreviewModal) routePreviewModal.classList.remove("hidden");
}

function closeRoutePreviewModal() {
  if (routePreviewBackdrop) routePreviewBackdrop.classList.add("hidden");
  if (routePreviewModal) routePreviewModal.classList.add("hidden");
}

if (closeRoutePreview) {
  closeRoutePreview.addEventListener("click", closeRoutePreviewModal);
}
if (routePreviewBackdrop) {
  routePreviewBackdrop.addEventListener("click", (e) => {
    if (e.target === routePreviewBackdrop) closeRoutePreviewModal();
  });
}

// ======== BADGE LOADING ========
async function loadBadges() {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(collection(db, "Users", user.uid, "badges"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("loadBadges error", e);
    return [];
  }
}

// ======== DOM ELEMENTS (safe access) ========
const badgesModal = document.getElementById("badges-modal");
const badgeGrid = document.getElementById("badge-grid");
const closeBadgesModal = document.getElementById("close-badges-modal");

const menuFab = document.getElementById("menu-fab");
const menuSheet = document.getElementById("menu-sheet");
const menuBackdrop = document.getElementById("menu-backdrop");

const settingsScreen = document.getElementById("settings-screen");
const logoutBtn = document.getElementById("logout-btn");
const closeSettings = document.getElementById("close-settings");

const nearbyScreen = document.getElementById("nearby-screen");
const nearbyList = document.getElementById("nearby-list");
const closeNearby = document.getElementById("close-nearby");

const historyScreen = document.getElementById("history-screen");
const historyList = document.getElementById("history-list");
const closeHistory = document.getElementById("close-history");

// ======== MENU: open/close + panel swap ========
function showMenuMainPanel() {
  const main = document.getElementById("menu-main");
  const settings = document.getElementById("menu-settings");
  if (main) main.classList.remove("hidden");
  if (settings) settings.classList.add("hidden");
}
function showMenuSettingsPanel() {
  const main = document.getElementById("menu-main");
  const settings = document.getElementById("menu-settings");
  if (main) main.classList.add("hidden");
  if (settings) settings.classList.remove("hidden");
}

// ============================
// MENU OPEN / CLOSE (BOTTOM-LEFT SHEET)
// ============================

function openMenu() {
  // Always reset to the main menu panel when opening
  showMenuMainPanel();

  if (menuBackdrop) {
    menuBackdrop.classList.add("show");
    menuBackdrop.classList.remove("hidden");
  }
  if (menuSheet) {
    menuSheet.classList.add("show");
    menuSheet.classList.remove("hidden");
    menuSheet.setAttribute("aria-hidden", "false");
  }
}

function closeMenu() {
  if (menuBackdrop) {
    menuBackdrop.classList.remove("show");
    setTimeout(() => menuBackdrop.classList.add("hidden"), 200);
  }
  if (menuSheet) {
    menuSheet.classList.remove("show");
    setTimeout(() => menuSheet.classList.add("hidden"), 200);
    menuSheet.setAttribute("aria-hidden", "true");
  }
}

// FAB opens menu
if (menuFab) menuFab.addEventListener("click", openMenu);

// Backdrop closes menu
if (menuBackdrop) {
  menuBackdrop.addEventListener("click", (e) => {
    if (e.target === menuBackdrop) closeMenu();
  });
}

// Delegated menu click handler
if (menuSheet) {
  menuSheet.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item, .menu-item-small");
    if (!btn) return;

    const action = btn.dataset.action || "";
    if (action) {
      switch (action) {
        case "nearby":
          closeMenu();
          openNearbyRoutesScreen();
          break;
        case "view-badges":
          closeMenu();
          openBadgesModal();
          break;
        case "open-settings":
          showMenuSettingsPanel();
          break;
        case "history":
          closeMenu();
          openHistoryScreen();
          break;
        case "open-inventory":
          closeMenu();
          openInventoryScreen();
          break;
        case "open-journal":
          closeMenu();
          openJournalScreen();
          break;
      }
      return;
    }

    const id = btn.id || "";
    if (id === "menu-settings-back") {
      showMenuMainPanel();
      return;
    }
    if (id === "menu-logout-btn") {
      signOut(auth)
        .then(() => {
          closeMenu();
          closeSettingsScreen();
        })
        .catch((err) => console.error("Logout error (menu):", err));
      return;
    }
    if (id === "menu-open-settings-screen") {
      closeMenu();
      openSettingsScreen();
      return;
    }
  });
}

// ======== COMPASS VISIBILITY — hide when any screen is open ========
const compassEl2 = document.getElementById("compass");
function hideCompass() { if (compassEl2) compassEl2.style.display = "none"; }
function showCompass() { if (compassEl2) compassEl2.style.display = ""; }

// ======== CLOSE ALL SCREENS (call before opening any screen) ========
// ======== INVENTORY SCREEN ========
const inventoryScreen   = document.getElementById("inventory-screen");
const inventoryGrid     = document.getElementById("inventory-grid");
const closeInventoryBtn = document.getElementById("close-inventory");

function rarityClass(rarity) {
  return "rarity-" + (rarity || "common").toLowerCase();
}

async function openInventoryScreen() {
  closeAllScreens();
  hideCompass();
  if (!inventoryScreen || !inventoryGrid) return;
  inventoryScreen.classList.remove("hidden");
  inventoryScreen.setAttribute("aria-hidden", "false");
  inventoryGrid.innerHTML = `<div class="inventory-empty">Loading…</div>`;

  const user = auth.currentUser;
  if (!user) return;

  try {
    const invSnap = await getDocs(collection(db, "Users", user.uid, "inventory"));
    if (invSnap.empty) {
      inventoryGrid.innerHTML = `<div class="inventory-empty">🎒 Your inventory is empty.<br><span>Find hidden checkpoints and world points to collect items.</span></div>`;
      return;
    }

    const entries = [];
    invSnap.forEach(d => entries.push({ id: d.id, ...d.data() }));

    const defs = await Promise.all(
      entries.map(e =>
        getDoc(doc(db, "Items", e.id))
          .then(s => s.exists() ? { id: e.id, ...s.data() } : { id: e.id, name: e.id })
          .catch(() => ({ id: e.id, name: e.id }))
      )
    );

    inventoryGrid.innerHTML = "";
    entries.forEach((inv, i) => {
      const def     = defs[i] || {};
      const name    = def.name        || inv.id;
      const rarity  = def.rarity      || "common";
      const icon    = def.icon        || null;
      const qty     = inv.quantity    || 1;
      const flavour = def.flavourText || "";
      const desc    = def.description || "";

      const iconHtml = icon
        ? `<img src="${icon}" class="inventory-card-icon" alt="${name}">`
        : `<div class="inventory-card-icon">📦</div>`;

      const card = document.createElement("div");
      card.className = "inventory-card";
      card.innerHTML = `
        ${iconHtml}
        <div class="inventory-card-name">${name}</div>
        <div class="inventory-card-rarity ${rarityClass(rarity)}">${rarity}</div>
        ${qty > 1 ? `<div class="inventory-card-qty">×${qty}</div>` : ""}
      `;
      card.addEventListener("click", () => showItemDetail({ name, rarity, icon, flavour, desc }));
      inventoryGrid.appendChild(card);
    });
  } catch (err) {
    console.error("Inventory load error:", err);
    inventoryGrid.innerHTML = `<div class="inventory-empty">Failed to load inventory.</div>`;
  }
}

function closeInventoryScreen() {
  if (!inventoryScreen) return;
  inventoryScreen.classList.add("hidden");
  inventoryScreen.setAttribute("aria-hidden", "true");
}
closeInventoryBtn?.addEventListener("click", closeInventoryScreen);

function showItemDetail({ name, rarity, icon, flavour, desc }) {
  const backdrop = document.getElementById("item-detail-backdrop");
  const modal    = document.getElementById("item-detail-modal");
  if (!backdrop || !modal) return;
  document.getElementById("item-detail-icon").innerHTML = icon ? `<img src="${icon}" alt="${name}">` : "📦";
  document.getElementById("item-detail-rarity").textContent = rarity || "common";
  document.getElementById("item-detail-rarity").className = `item-detail-rarity ${rarityClass(rarity)}`;
  document.getElementById("item-detail-name").textContent = name;
  document.getElementById("item-detail-flavour").textContent = flavour;
  document.getElementById("item-detail-desc").textContent = desc;
  backdrop.classList.remove("hidden");
  modal.classList.remove("hidden");
}

document.getElementById("item-detail-close")?.addEventListener("click", () => {
  document.getElementById("item-detail-backdrop")?.classList.add("hidden");
  document.getElementById("item-detail-modal")?.classList.add("hidden");
});
document.getElementById("item-detail-backdrop")?.addEventListener("click", () => {
  document.getElementById("item-detail-backdrop")?.classList.add("hidden");
  document.getElementById("item-detail-modal")?.classList.add("hidden");
});

function closeAllScreens() {
  closeSettingsScreen();
  closeBadgesModalFn();
  closeNearbyScreen();
  closeHistoryScreen();
  closeInventoryScreen();
  if (journalScreen) journalScreen.classList.add("hidden");
  if (journalRouteDetail) journalRouteDetail.classList.add("hidden");
  closeJournal();
  showCompass();
}

// ======== MENU: open full settings screen and close handlers ========
async function openSettingsScreen() {
  closeAllScreens();
  hideCompass();
  if (!settingsScreen) return;
  settingsScreen.classList.remove("hidden");
  settingsScreen.setAttribute("aria-hidden", "false");

  const user = auth.currentUser;
  const content = document.getElementById("settings-content");
  if (!content) return;

  if (user) {
    // Load stats
    let routeCount = 0, badgeCount = 0, itemCount = 0;
    try {
      const [histSnap, badgeSnap, itemSnap] = await Promise.all([
        getDocs(collection(db, "Users", user.uid, "routeHistory")),
        getDocs(collection(db, "Users", user.uid, "badges")),
        getDocs(collection(db, "Users", user.uid, "inventory"))
      ]);
      routeCount = histSnap.size;
      badgeCount = badgeSnap.size;
      itemCount  = itemSnap.size;
    } catch (e) {}

    const title = getTitleForCompletions(routeCount);
    const avatarStyle = user.photoURL ? `background-image:url(${user.photoURL})` : "";

    content.innerHTML = `
      <div class="settings-profile">
        <div class="settings-avatar" style="${avatarStyle}"></div>
        <div class="settings-profile-info">
          <div class="settings-profile-name">${user.displayName || "Adventurer"}</div>
          <div class="settings-profile-title">${title}</div>
        </div>
      </div>
      <div class="settings-stats">
        <div class="settings-stat"><div class="settings-stat-val">${routeCount}</div><div class="settings-stat-label">Routes</div></div>
        <div class="settings-stat"><div class="settings-stat-val">${badgeCount}</div><div class="settings-stat-label">Badges</div></div>
        <div class="settings-stat"><div class="settings-stat-val">${itemCount}</div><div class="settings-stat-label">Items</div></div>
      </div>
      <div class="settings-divider"></div>
      <div class="settings-row">
        <span>Account</span><span class="settings-row-val">${user.email || ""}</span>
      </div>
      <div class="settings-row">
        <span>Version</span><span class="settings-row-val">1.0.0</span>
      </div>
    `;
  } else {
    content.innerHTML = `<div style="color:#ddd;margin:12px 0;">Not signed in.</div>`;
  }
}
function closeSettingsScreen() {
  if (settingsScreen) {
    settingsScreen.classList.add("hidden");
    settingsScreen.setAttribute("aria-hidden", "true");
  }
}

const menuSettingsBack = document.getElementById("menu-settings-back");
if (menuSettingsBack)
  menuSettingsBack.addEventListener("click", showMenuMainPanel);

if (closeSettings) closeSettings.addEventListener("click", closeSettingsScreen);

// ======== SETTINGS LOGOUT (full screen) ========
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      closeSettingsScreen();
    } catch (e) {
      console.error("Logout error:", e);
    }
  });
}

/* ============================================================
   ROUTE COMPLETION SUMMARY SCREEN
   ============================================================ */

function showRouteSummary(routeName, badgeSVG, loreCount, totalLore, routeSnapshot) {
  const backdrop = document.getElementById("route-summary-backdrop");
  const modal = document.getElementById("route-summary-modal");
  const title = document.getElementById("route-summary-title");
  const badge = document.getElementById("route-summary-badge");
  const details = document.getElementById("route-summary-details");
  const btnJournal = document.getElementById("route-summary-journal-btn");
  const btnClose = document.getElementById("route-summary-close-btn");

  if (!modal || !backdrop) return;

  // Compute distance + time using snapshot (activeRoute may already be null)
  const distance = computeRouteDistance(routeSnapshot || []);
  const km = (distance / 1000).toFixed(2);
  const minutes = estimateTimeMinutes(distance);

  const percent = Math.round((loreCount / totalLore) * 100);

  title.textContent = `Route Completed: ${routeName}`;
  badge.innerHTML = badgeSVG;

  details.innerHTML = `
    <div>Completed on: ${new Date().toLocaleDateString()}</div>
    <div>Lore Found: ${loreCount} / ${totalLore} (${percent}%)</div>
    <div>Distance: ${km} km</div>
    <div>Estimated Time: ${minutes} min</div>
  `;

  backdrop.classList.remove("hidden");
  modal.classList.remove("hidden");

  requestAnimationFrame(() => {
    backdrop.classList.add("show");
    modal.classList.add("show");
  });

  btnJournal.onclick = () => {
    modal.classList.remove("show");
    backdrop.classList.remove("show");
    setTimeout(() => {
      modal.classList.add("hidden");
      backdrop.classList.add("hidden");
      openJournalScreen();
    }, 250);
  };

  btnClose.onclick = () => {
    modal.classList.remove("show");
    backdrop.classList.remove("show");
    setTimeout(() => {
      modal.classList.add("hidden");
      backdrop.classList.add("hidden");
    }, 250);
  };
}



// ===============================
// BADGE SYSTEM HELPERS + SVG GENERATOR (METALLIC SHIELD + STARS)
// ===============================

// Map completion count → star count
function getStarCountForCompletions(completions) {
  if (!completions || completions <= 1) return 0;
  if (completions >= 2 && completions <= 4) return 1;
  if (completions >= 5 && completions <= 9) return 2;
  return 3; // 10+
}

// Initials from route name
function getRouteInitials(name) {
  return name
    .split(" ")
    .map((w) => w[0]?.toUpperCase())
    .join("")
    .slice(0, 3);
}

// Generate positions for stars in a top arc
function getStarPositions(starCount) {
  if (starCount === 0) return [];
  const positions = [];
  const centerX = 45;
  const baseY = 26;
  const spacing = 16;

  if (starCount === 1) {
    positions.push({ x: centerX, y: baseY });
  } else if (starCount === 2) {
    positions.push({ x: centerX - spacing, y: baseY });
    positions.push({ x: centerX + spacing, y: baseY });
  } else {
    positions.push({ x: centerX - spacing, y: baseY });
    positions.push({ x: centerX, y: baseY - 4 });
    positions.push({ x: centerX + spacing, y: baseY });
  }

  return positions;
}

// Metallic shield with engraved initials + gold stars
function generateBadgeSVG(routeName, starCount = 0) {
  const initials = getRouteInitials(routeName);
  const stars = getStarPositions(starCount)
    .map(
      (p) => `
      <text x="${p.x}" y="${p.y}" text-anchor="middle"
            fill="#ffd54a" font-size="16" font-family="system-ui, sans-serif"
            filter="drop-shadow(0 1px 3px rgba(180,120,0,0.7))">
        ★
      </text>`
    )
    .join("");

  return `
    <svg width="90" height="110" viewBox="0 0 90 110" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Polished steel gradient -->
        <linearGradient id="shieldMetal" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#f5f7fa"/>
          <stop offset="35%" stop-color="#d0d4da"/>
          <stop offset="70%" stop-color="#a4a9b1"/>
          <stop offset="100%" stop-color="#7b8088"/>
        </linearGradient>

        <!-- Inner dark plate -->
        <linearGradient id="shieldInner" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#3b3f46"/>
          <stop offset="100%" stop-color="#1f2227"/>
        </linearGradient>

        <!-- Engraved text effect -->
        <filter id="engrave">
          <feOffset dx="0.5" dy="0.5" result="shadow"/>
          <feGaussianBlur in="shadow" stdDeviation="0.6" result="blur"/>
          <feComposite in="blur" in2="SourceAlpha" operator="arithmetic"
                       k2="-1" k3="1" result="innerShadow"/>
          <feMerge>
            <feMergeNode in="innerShadow"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Outer shield shape (rim) -->
      <path d="M45 5 L78 22 L78 60 Q45 90 45 105 Q45 90 12 60 L12 22 Z"
            fill="url(#shieldMetal)"
            stroke="#ffffff"
            stroke-width="2.5" />

      <!-- Inner plate -->
      <path d="M45 12 L72 26 L72 57 Q45 82 45 96 Q45 82 18 57 L18 26 Z"
            fill="url(#shieldInner)"
            stroke="#cfd3da"
            stroke-width="1.5" />

      <!-- Gold stars in top arc -->
      ${stars}

      <!-- Engraved initials -->
      <text x="50%" y="63%" text-anchor="middle"
            fill="#e0e3ea"
            font-size="24"
            font-weight="700"
            font-family="system-ui, sans-serif"
            filter="url(#engrave)">
        ${initials}
      </text>
    </svg>
  `;
}

// ===============================
// BADGES MODAL (METALLIC SHIELDS + STARS)
// ===============================
async function openBadgesModal() {
  closeAllScreens();
  hideCompass();
  if (!badgesModal) return;
  if (badgeGrid) badgeGrid.innerHTML = "";

  const user = auth.currentUser;
  if (!user) {
    badgeGrid.innerHTML = "<p style='color:#ddd;padding:24px'>Sign in to view badges.</p>";
    badgesModal.classList.remove("hidden");
    badgesModal.setAttribute("aria-hidden", "false");
    return;
  }

  // Load badges
  const badges = await loadBadges();

  // Load route history once and build completion counts
  let completionCounts = {};
  try {
    const historySnap = await getDocs(
      collection(db, "Users", user.uid, "routeHistory")
    );
    historySnap.forEach((docSnap) => {
      const data = docSnap.data();
      const name = data.routeName;
      if (!name) return;
      completionCounts[name] = (completionCounts[name] || 0) + 1;
    });
  } catch (e) {
    console.error("Error loading route history for badges:", e);
  }

  if (!badges || badges.length === 0) {
    badgeGrid.innerHTML = "<p style='color:#ddd;'>No badges earned yet.</p>";
  } else {
    badges.forEach((b) => {
      const item = document.createElement("div");
      item.className = "badge-item";

      // Derive route name from badge id/name
      const rawId = b.id || b.name || "";
      let routeName = rawId.replace(/^completed_/, "").replace(/_/g, " ").trim();
      if (!routeName) routeName = "Unknown Route";

      const completions = completionCounts[routeName] || 1;
      const starCount = getStarCountForCompletions(completions);

      const svg = generateBadgeSVG(routeName, starCount);

      item.innerHTML = `
        <div class="badge-svg-container">
          ${svg}
        </div>
        <div class="badge-route-name">${routeName}</div>
      `;

      badgeGrid.appendChild(item);
    });
  }

  badgesModal.classList.remove("hidden");
  badgesModal.setAttribute("aria-hidden", "false");
  if (closeBadgesModal) closeBadgesModal.focus();
}

// ===============================
// CLOSE BADGES MODAL
// ===============================

function closeBadgesModalFn() {
  if (!badgesModal) return;
  badgesModal.classList.add("hidden");
  badgesModal.setAttribute("aria-hidden", "true");
  showCompass();
}

if (closeBadgesModal) {
  closeBadgesModal.addEventListener("click", closeBadgesModalFn);
}

// ======== NEARBY / HISTORY screens ========
function openNearbyRoutesScreen() {
  closeAllScreens();
  hideCompass();
  if (!nearbyScreen || !nearbyList) return;
  nearbyScreen.classList.remove("hidden");
  nearbyScreen.setAttribute("aria-hidden", "false");
  nearbyList.innerHTML = "";

  if (!userLatLng) {
    nearbyList.innerHTML = `<div class="nearby-empty">📡 Waiting for your location…<br><span>Make sure location is enabled.</span></div>`;
    return;
  }

  const allRoutes = getAllRoutesWithDistance();

  if (allRoutes.length === 0) {
    nearbyList.innerHTML = `<div class="nearby-empty">🗺 No routes found within 15km.<br><span>More routes coming soon!</span></div>`;
    return;
  }

  allRoutes.forEach((item) => {
    const r = item.route;
    const distM = Math.round(item.dist);
    const distStr = distM < 1000 ? `${distM}m away` : `${(distM / 1000).toFixed(1)}km away`;
    const isCompleted = window.__completedRoutes?.has(r.name);
    const cpCount = (r.checkpoints || []).filter(c => !c.hidden).length;
    const distTotal = computeRouteDistance(r.checkpoints || []);
    const kmTotal = (distTotal / 1000).toFixed(1);
    const modeLabel = r.mode === "hunt" ? "Hunt" : "Guided";
    const modeClass = r.mode === "hunt" ? "mode-hunt" : "mode-guided";
    const canStart = item.dist <= START_TRIGGER_RADIUS + START_BUFFER;

    const narratorName = r.narrator
      ? (NARRATORS.find(n => n.id === r.narrator)?.name || r.narrator.replace(/_/g, " "))
      : "";

    const el = document.createElement("div");
    el.className = "nearby-item" + (isCompleted ? " nearby-completed" : "");
    el.innerHTML = `
      <div class="nearby-item-top">
        <div class="nearby-item-name">${r.name}${isCompleted ? ' <span class="nearby-done-badge">✓ Done</span>' : ""}</div>
        <span class="nearby-mode-tag ${modeClass}">${modeLabel}</span>
      </div>
      ${narratorName ? `<div class="nearby-item-narrator">Logs by ${narratorName}</div>` : ""}
      <div class="nearby-item-meta">
        <span>📍 ${distStr}</span>
        <span>🚩 ${cpCount} checkpoints</span>
        <span>📏 ${kmTotal}km</span>
      </div>
      ${!canStart ? `<div class="nearby-item-hint">Walk to the trailhead to start</div>` : ""}
    `;
    el.addEventListener("click", () => {
      clearRoute();
      showRoute(r.checkpoints, r.name, false, r.mode || "guided");
      closeNearbyScreen();
      closeMenu();
    });
    nearbyList.appendChild(el);
  });
}
function closeNearbyScreen() {
  if (!nearbyScreen) return;
  nearbyScreen.classList.add("hidden");
  nearbyScreen.setAttribute("aria-hidden", "true");
}
if (closeNearby) closeNearby.addEventListener("click", closeNearbyScreen);

function openHistoryScreen() {
  closeAllScreens();
  hideCompass();
  if (!historyScreen || !historyList) return;
  historyScreen.classList.remove("hidden");
  historyScreen.setAttribute("aria-hidden", "false");
  historyList.innerHTML = "";

  const user = auth.currentUser;
  if (!user) return;

  getDocs(collection(db, "Users", user.uid, "routeHistory")).then((snap) => {
    const entries = [];
    snap.forEach((d) => entries.push(d.data()));

    entries.sort((a, b) => {
      const aSec = a.completedAt?.seconds || 0;
      const bSec = b.completedAt?.seconds || 0;
      return bSec - aSec;
    });

    if (entries.length === 0) {
      historyList.innerHTML = `<div class="history-empty">🥾 No completed routes yet.<br><span>Start exploring to build your history.</span></div>`;
      return;
    }

    // Build completion count map for streak display
    const countMap = {};
    entries.forEach(e => { if (e.routeName) countMap[e.routeName] = (countMap[e.routeName] || 0) + 1; });

    entries.forEach((data) => {
      const completedAt = data.completedAt;
      let dateStr = "";
      if (completedAt?.seconds) {
        const d = new Date(completedAt.seconds * 1000);
        dateStr = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      }

      const routeData = (window.__allRoutes || []).find(r => r.name === data.routeName);
      const cpCount = routeData ? (routeData.checkpoints || []).filter(c => !c.hidden).length : null;
      const distM = routeData ? computeRouteDistance(routeData.checkpoints || []) : 0;
      const distStr = distM > 0 ? (distM < 1000 ? `${Math.round(distM)}m` : `${(distM/1000).toFixed(1)}km`) : null;
      const count = countMap[data.routeName] || 1;

      const el = document.createElement("div");
      el.className = "history-item";
      el.innerHTML = `
        <div class="history-item-top">
          <div class="history-item-name">${data.routeName || "Unknown Route"}</div>
          ${count > 1 ? `<span class="history-streak">×${count}</span>` : ""}
        </div>
        <div class="history-item-meta">
          <span>📅 ${dateStr}</span>
          ${cpCount ? `<span>🚩 ${cpCount} checkpoints</span>` : ""}
          ${distStr ? `<span>📏 ${distStr}</span>` : ""}
        </div>
      `;
      historyList.appendChild(el);
    });
  });
}
function closeHistoryScreen() {
  if (!historyScreen) return;
  historyScreen.classList.add("hidden");
  historyScreen.setAttribute("aria-hidden", "true");
}
if (closeHistory) closeHistory.addEventListener("click", closeHistoryScreen);

// ======== OFFLINE DETECTION + WRITE QUEUE ========
const offlineBanner     = document.getElementById("offline-banner");
const offlineBannerText = document.getElementById("offline-banner-text");
let _backOnlineTimer = null;

function setOfflineUI(isOffline) {
  if (!offlineBanner) return;
  if (_backOnlineTimer) { clearTimeout(_backOnlineTimer); _backOnlineTimer = null; }

  if (isOffline) {
    if (offlineBannerText) offlineBannerText.textContent = "📡 No connection — progress will sync when back online";
    offlineBanner.classList.remove("back-online");
    offlineBanner.classList.remove("hidden");
  } else {
    // Show a brief "back online" confirmation then fade out
    if (offlineBannerText) offlineBannerText.textContent = "✓ Back online — syncing progress";
    offlineBanner.classList.add("back-online");
    offlineBanner.classList.remove("hidden");
    _backOnlineTimer = setTimeout(() => {
      offlineBanner.classList.add("hidden");
      offlineBanner.classList.remove("back-online");
    }, 2500);
  }
}

window.addEventListener("online",  () => {
  setOfflineUI(false);
  // Ask SW to flush any queued writes back to us
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "flush-queue" });
  }
});
window.addEventListener("offline", () => setOfflineUI(true));

// Set initial state in case page loads without connection
if (!navigator.onLine) setOfflineUI(true);

// Handle queued writes replayed by the SW on reconnect
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", async (event) => {
    if (event.data?.type === "queued-writes" && Array.isArray(event.data.writes)) {
      for (const write of event.data.writes) {
        try {
          const ref = doc(db, ...write.path);
          await setDoc(ref, write.data, { merge: true });
          console.log("[offline-queue] Replayed write to", write.path.join("/"));
        } catch (err) {
          console.error("[offline-queue] Failed to replay write:", err);
        }
      }
    }
  });
}

// Helper: wrap a Firestore setDoc so it queues to SW if offline
async function setDocWithOfflineQueue(path, data, options = {}) {
  try {
    const ref = doc(db, ...path);
    await setDoc(ref, data, options);
  } catch (err) {
    if (!navigator.onLine && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "queue-write",
        payload: { path, data }
      });
      console.log("[offline-queue] Queued write for", path.join("/"));
    } else {
      throw err;
    }
  }
}

// ======== COMPASS / HEADING UPDATE LOOP ========
setInterval(() => {
  updateCompass();
}, 500);

// ======== AUTH STATE OBSERVER (placed near end so helpers exist) ========
onAuthStateChanged(auth, async (user) => {
  const fab = document.getElementById("menu-fab");
  const fabIcon = document.getElementById("menu-fab-icon");
  const profileCard = document.getElementById("menu-profile-card");
  const profileAvatar = document.getElementById("menu-profile-avatar");
  const profileName = document.getElementById("menu-profile-name");
  const profileTitle = document.getElementById("menu-profile-title");

  const signinCard = document.getElementById("menu-signin-card");
  const signinBtn  = document.getElementById("menu-signin-btn");

  if (!user) {
    // Close any screens left open from the previous user
    closeAllScreens();
    // Show sign-in card, hide profile card
    if (signinCard) signinCard.style.display = "";
    if (profileCard) profileCard.classList.add("hidden");
    if (signinBtn) signinBtn.onclick = handleSignIn;
    // FAB stays as plain ☰
    if (fab) { fab.classList.remove("has-avatar"); fab.setAttribute("aria-label", "Open menu"); }
    if (fabIcon) { fabIcon.style.backgroundImage = ""; fabIcon.textContent = "☰"; }
    stopGeolocationWatch();
    setSplashProgress(100, "Sign in to begin");
    setTimeout(() => { hideSplash(); maybeShowStoryIntro(() => showLandingScreen()); }, 600);
    return;
  }

  // Signed in — close any screens from a previous user session, then set up
  closeAllScreens();
  hideLandingScreen();
  if (signinCard) signinCard.style.display = "none";

  // FAB becomes avatar
  if (fab && fabIcon && user.photoURL) {
    fabIcon.style.backgroundImage = `url(${user.photoURL})`;
    fabIcon.textContent = "";
    fab.classList.add("has-avatar");
  } else {
    if (fabIcon) fabIcon.textContent = "☰";
    if (fab) fab.classList.remove("has-avatar");
  }

  // Populate menu profile card
  if (profileCard) {
    if (profileAvatar && user.photoURL) profileAvatar.style.backgroundImage = `url(${user.photoURL})`;
    if (profileName) profileName.textContent = user.displayName || "Adventurer";
    profileCard.classList.remove("hidden");
  }

  // Profile title updated after history loads (updateUserTitleUI handles it)
  if (profileTitle) {
    const count = window.__completedRoutes?.size || 0;
    profileTitle.textContent = getTitleForCompletions(count);
  }

  try {
    const profileRef = doc(db, "Users", user.uid, "profile", "info");
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      await setDoc(profileRef, {
        name: user.displayName,
        photoURL: user.photoURL,
        createdAt: new Date()
      });
      window.__unlockedPOIs = [];
      window.__unlockedBioFragments = {};
    } else {
      window.__unlockedPOIs = snap.data().unlockedPOIs || [];
      window.__unlockedBioFragments = snap.data().unlockedBioFragments || {}; // {narratorId: [itemId, ...0]}
    }
  } catch (err) {
    console.error("Error ensuring profile doc:", err);
    window.__unlockedPOIs = [];
    window.__unlockedBioFragments = {};
  }

  setSplashProgress(30, "Signing in…");
  const isReturning = !!localStorage.getItem(ONBOARDING_KEY);
  if (isReturning) requestAnimationFrame(() => startGeolocationWatch());
  updateUserTitleUI();

  setSplashProgress(45, "Loading your progress…");
  loadCompletedRoutes()
    .then(loadAllRoutes)
    .then(() => maybeShowOnboarding());

  loadNarrators().catch(console.error);

  // Fetch POI data now but defer rendering until first GPS fix
  // so POIs stay hidden until we know the player's distance.
  loadVisitedPOIs().then(loadWorldPOIsData).catch(console.error);

  restoreRouteProgress();

});

// ======================================================
// ⭐ LORE SYSTEM — Journal Save + Toast + Lore Card
// ======================================================

// Randomized discovery messages
const LORE_DISCOVERY_MESSAGES = [
  "You found a torn note…",
  "You found a scrap of paper…",
  "You found a weathered fragment…",
  "You found a faded message…",
  "You found something tucked under a stone…",
  "You found a crumpled page…",
  "You found a brittle parchment scrap…"
];

// DOM refs
const loreToast = document.getElementById("lore-toast");
const loreToastText = document.getElementById("lore-toast-text");
const loreCardOverlay = document.getElementById("lore-card-overlay");
const loreCard = document.getElementById("lore-card");
const loreCardTitle = document.getElementById("lore-card-title");
const loreCardText = document.getElementById("lore-card-text");
const loreCardClose = document.getElementById("lore-card-close");

// ── Lore card close ──
function closeLoreCard() {
  if (!loreCardOverlay || !loreCard) return;
  loreCard.style.animation = "loreCardDismiss 0.3s cubic-bezier(0.4,0,1,1) forwards";
  setTimeout(() => {
    loreCardOverlay.classList.add("hidden");
    loreCard.style.animation = "";

    // Restore journal z-index
    const journalScreenEl = document.getElementById("journal-screen");
    const journalDetailEl = document.getElementById("journal-route-detail");
    if (journalScreenEl) journalScreenEl.style.zIndex = "";
    if (journalDetailEl) journalDetailEl.style.zIndex = "";

    // Restore compass if we're back on the map (journal not open)
    const journalVisible = journalScreenEl && !journalScreenEl.classList.contains("hidden");
    const detailVisible  = journalDetailEl && !journalDetailEl.classList.contains("hidden");
    if (!journalVisible && !detailVisible) showCompass();

    // Show deferred item toast now that the card is gone
    if (pendingItemToast) {
      const { name, iconSrc, rarity } = pendingItemToast;
      pendingItemToast = null;
      setTimeout(() => showItemToast(name, iconSrc, rarity), 80);
    }

    // If this was the final checkpoint lore, fire route completion sequence
    if (pendingRouteComplete) {
      pendingRouteComplete = false;
      showRouteCompleteTransition(async () => {
        try { await completeRoute(); } catch (e) { console.error("completeRoute error:", e); }
      });
    }
  }, 300);
}

// Brief cinematic beat between lore close and badge reveal
function showRouteCompleteTransition(onDone) {
  const toast = document.createElement("div");
  toast.textContent = "Route Complete";
  toast.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "background:rgba(0,0,0,0.82)",
    "color:#fff",
    "font-size:22px",
    "font-weight:700",
    "letter-spacing:0.08em",
    "text-transform:uppercase",
    "padding:18px 36px",
    "border-radius:14px",
    "backdrop-filter:blur(10px)",
    "border:1px solid rgba(255,255,255,0.12)",
    "z-index:10200",
    "opacity:0",
    "transition:opacity 0.35s ease",
    "pointer-events:none"
  ].join(";");
  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
  });

  // Hold then fade out → trigger completion
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.remove();
      onDone();
    }, 350);
  }, 900);
}

if (loreCardClose) {
  loreCardClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeLoreCard();
  });
}

// Tap backdrop to close
if (loreCardOverlay) {
  loreCardOverlay.addEventListener("click", (e) => {
    if (e.target === loreCardOverlay) closeLoreCard();
  });
}

// Toast click → open lore card
if (loreToast) {
  loreToast.addEventListener("click", () => {
    loreToast.classList.add("hidden");
    loreCardOverlay.classList.remove("hidden");
  });
}

// ======================================================
// ⭐ Show Toast
// ======================================================
function showLoreToast(message) {
  if (!loreToast || !loreToastText) return;

  loreToastText.textContent = message;
  loreToast.classList.remove("hidden");
  loreToast.classList.add("show");

  setTimeout(() => {
    loreToast.classList.remove("show");
    setTimeout(() => loreToast.classList.add("hidden"), 300);
  }, 3000);
}

let _hintToastTimer = null;
function showHintToast(message) {
  const el   = document.getElementById("hint-toast");
  const text = document.getElementById("hint-toast-text");
  if (!el || !text) return;

  text.textContent = message;
  el.classList.remove("hidden");
  // Force reflow so transition fires even on repeat calls
  void el.offsetWidth;
  el.classList.add("show");

  if (_hintToastTimer) clearTimeout(_hintToastTimer);
  _hintToastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.classList.add("hidden"), 200);
    _hintToastTimer = null;
  }, 2500);
}

// ======================================================
// ⭐ Open Lore Card
// ======================================================
function openLoreCard(payload) {
  if (!loreCardOverlay || !loreCardTitle || !loreCardText) return;

  loreCardTitle.textContent = payload.title || "Checkpoint";
  loreCardText.textContent = payload.text || "";
  loreCard.setAttribute("data-style", payload.style || "stone");
  loreCard.style.animation = "";

  // Parchment open sound (page-flip reserved for journal)
  parchmentSound.currentTime = 0;
  parchmentSound.play().catch(() => {});

  // Temporarily lower journal screens below lore card while it's open
  const journalScreenEl = document.getElementById("journal-screen");
  const journalDetailEl = document.getElementById("journal-route-detail");
  if (journalScreenEl) journalScreenEl.style.zIndex = "10150";
  if (journalDetailEl) journalDetailEl.style.zIndex = "10150";

  loreCardOverlay.classList.remove("hidden");
}

// ======================================================
// ⭐ Save Lore to Firestore (Journal)
// ======================================================
async function saveLoreToJournal(routeName, checkpointIndex, payload) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    // Ensure the parent route document exists (queued if offline)
    await setDocWithOfflineQueue(
      ["Users", user.uid, "LoreJournal", routeName],
      { routeName, updatedAt: new Date() },
      { merge: true }
    );

    // Write the entry (queued if offline)
    await setDocWithOfflineQueue(
      ["Users", user.uid, "LoreJournal", routeName, "entries", String(checkpointIndex)],
      {
        checkpointIndex,
        title:      payload.title  || "",
        text:       payload.text   || "",
        style:      payload.style  || "stone",
        author:     payload.author || "",   // narrator id — empty = anonymous
        unlockedAt: new Date(),
        read:       false
      }
    );

  } catch (err) {
    console.error("saveLoreToJournal error:", err);
  }
}

async function markLoreAsRead(routeName, checkpointIndex) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const entryRef = doc(
      db,
      "Users",
      user.uid,
      "LoreJournal",
      routeName,
      "entries",
      String(checkpointIndex)
    );

    await setDoc(entryRef, { read: true }, { merge: true });

    // Decrement the menu badge (don't go below 0)
    const badge = document.getElementById("journal-unread-badge");
    if (badge && !badge.classList.contains("hidden")) {
      const current = parseInt(badge.textContent) || 0;
      updateJournalBadge(Math.max(0, current - 1));
    }

  } catch (err) {
    console.error("markLoreAsRead error:", err);
  }
}

// ======================================================
// ⭐ NARRATOR SYSTEM
// Narrators are the characters whose lore entries populate
// the journal. Each route has one narrator; entries are
// tagged with their authorId on write. The journal home
// screen shows narrator cards — locked until first entry found.
// ======================================================

// Hardcoded narrator registry — add new characters here.
// loreStyle matches the card style used for their entries.
// descriptor is one line shown on their dossier card.
// Narrator registry — populated from Firestore Narrators collection on load.
// Falls back to empty array until fetch completes; loadNarrators() is called
// early in the auth flow so it's ready before the journal is opened.
let NARRATORS = [];

async function loadNarrators() {
  try {
    const snap = await getDocs(collection(db, "Narrators"));
    NARRATORS = snap.docs.map(d => ({
      id:                  d.id,
      name:                d.data().name                || d.id,
      descriptor:          d.data().descriptor          || "",
      loreStyle:           d.data().loreStyle           || "stone",
      hideName:            d.data().hideName            || false,
      portrait:            d.data().portrait            || "",
      bioFragments:        d.data().bioFragments        || [],
      poiUnlockThreshold:  d.data().poiUnlockThreshold  || null,
      unlockPOIId:         d.data().unlockPOIId         || null
    }));
    window.__narrators = NARRATORS;
    console.log(`[Narrators] loaded ${NARRATORS.length} from Firestore`);
  } catch (err) {
    console.error("[Narrators] failed to load:", err);
  }
}

// Look up a narrator by id — returns undefined if not found
function getNarrator(id) {
  return NARRATORS.find(n => n.id === id);
}
function triggerCheckpointLore(index, payload) {
  if (!activeRouteName || !activeRoute) return;

  // isFinal = last non-hidden checkpoint (hidden CPs must not block route completion)
  const lastVisibleIndex = activeRoute.reduce((last, cp, i) => cp.hidden ? last : i, -1);
  const isFinal = index === lastVisibleIndex;

  // 1. Random discovery message
  const msg =
    LORE_DISCOVERY_MESSAGES[
      Math.floor(Math.random() * LORE_DISCOVERY_MESSAGES.length)
    ];

  // 2. (toast suppressed — lore card is the discovery moment; toast would overlap the card)
  const cp = activeRoute[index];

  // 3. Save to Journal
  saveLoreToJournal(activeRouteName, index, payload);

  // 4. Open lore card immediately
  openLoreCard(payload);

  // 5. ⭐ Mark checkpoint as visited
  visitedLore[index] = true;

  // 5b. ⭐ Grant item — Firestore write now, toast deferred until lore card closes
  if (cp?.item) grantItem(cp.item, /* deferToast */ true, !!cp.oneTimeItem);

  // 6. ⭐ Auto‑advance activeIndex
  // Only advance if this checkpoint is the current "next" one
  if (activeIndex === index && !isFinal) {
    activeIndex = index + 1;
    saveRouteProgress();
  }

  // 7. ⭐ Update visuals + HUD + compass
  if (typeof updateCheckpointStates === "function") updateCheckpointStates();
  updateHUD();
  updateCompass();
  updateCheckpointScaling();
  populateFindingsDrawer();

  // Show pip on Findings button instead of forcing the drawer open
  showFindingsPip();

  // 8. ⭐ Final checkpoint — set flag so route completes after lore card closes
  if (isFinal) {
    pendingRouteComplete = true;
  }

  // 9. Hunt mode: save the consumed clue for this checkpoint into findings,
  //    then show the next checkpoint's clue in the HUD row.
  if (activeRouteMode === "hunt") {
    // Save the clue that led to this checkpoint into findings
    if (cp?.clue) {
      saveClueToFindings(cp.clue, index + 1);
    }

    if (!isFinal) {
      const nextCp = activeRoute[index + 1];
      if (nextCp?.clue) {
        // Small delay so it slides in after the checkpoint celebration
        setTimeout(() => showClueInHUD(nextCp.clue, index + 2), 600);
      }
    } else {
      // Final checkpoint found — clear the clue row
      hideHudClueRow();
    }
  }
}


// ======================================================
// ⭐ HUNT MODE — HUD CLUE ROW SYSTEM
// ======================================================
// Clues now live in the HUD top bar (#hud-clue-row) rather
// than a floating overlay card. This keeps the map unobstructed
// and makes clues feel like a persistent navigation aid.
//
// Flow:
//   initHudClueRow()     — called on hunt route start; readies row
//   showClueInHUD()      — called on checkpoint found; updates text
//   hideHudClueRow()     — called on route exit / final checkpoint
//   saveClueToFindings() — persists consumed clue into findings drawer
//
// The row is tappable to expand long clue text (CSS handles animation).
// The old clue-card DOM elements are kept hidden so legacy refs don't throw.
// ======================================================

// Track clues that have been consumed (shown) this session.
// Array of { number, text } objects — appended to findings drawer.
let _huntClueLog = [];

// Currently active clue — stored so the reclue button can re-show it.
let _currentClue = null; // { text, number } | null

const _reclueBtn = document.getElementById("reclue-btn");
if (_reclueBtn) {
  _reclueBtn.addEventListener("click", () => {
    if (!_currentClue) return;
    // Re-show the HUD clue row with the current clue
    showClueInHUD(_currentClue.text, _currentClue.number);
  });
}

/** Ready the HUD clue row for a new hunt — clear any previous state. */
function initHudClueRow() {
  const row  = document.getElementById("hud-clue-row");
  const text = document.getElementById("hud-clue-text");
  if (!row) return;
  _huntClueLog = [];
  _currentClue = null;
  if (_reclueBtn) _reclueBtn.classList.add("hidden");
  if (text) text.textContent = "";
  row.classList.remove("hud-clue-expanded", "clue-row-enter");
  row.classList.add("hidden");
}

/**
 * Show a clue in the HUD row with a slide-in animation.
 * Called when a checkpoint is found and the next clue is ready.
 * @param {string} clueText
 * @param {number} checkpointNumber — 1-based number of the checkpoint this clue leads to
 */
function showClueInHUD(clueText, checkpointNumber) {
  const row   = document.getElementById("hud-clue-row");
  const label = document.getElementById("hud-clue-label");
  const text  = document.getElementById("hud-clue-text");
  if (!row || !text) return;

  // Store so reclue button can re-show it
  _currentClue = { text: clueText, number: checkpointNumber };

  // Show reclue button
  if (_reclueBtn) _reclueBtn.classList.remove("hidden");

  // Update content
  if (label) label.childNodes[0] && (label.childNodes[0].textContent = "🔍 Clue " + checkpointNumber + " ");
  text.textContent = clueText;

  // Reset expand state so new clue always starts collapsed
  row.classList.remove("hud-clue-expanded", "clue-row-enter");
  row.classList.remove("hidden");

  // Force reflow so the animation re-triggers on subsequent clues
  void row.offsetWidth;
  row.classList.add("clue-row-enter");
  setTimeout(() => row.classList.remove("clue-row-enter"), 400);
}

/** Hide the HUD clue row (route ended or final checkpoint reached). */
function hideHudClueRow() {
  const row = document.getElementById("hud-clue-row");
  if (row) {
    row.classList.add("hidden");
    row.classList.remove("hud-clue-expanded");
  }
  _currentClue = null;
  if (_reclueBtn) _reclueBtn.classList.add("hidden");
}

/**
 * Save a consumed clue into the findings log so the player can
 * review the hunt's clue trail after completion.
 * @param {string} clueText
 * @param {number} checkpointNumber — 1-based number of the checkpoint found
 */
function saveClueToFindings(clueText, checkpointNumber) {
  _huntClueLog.push({ number: checkpointNumber, text: clueText });
  // findings drawer is rebuilt on next open via populateFindingsDrawer()
}

// Tap the clue row to toggle expand/collapse for long clue text
const _hudClueRow = document.getElementById("hud-clue-row");
if (_hudClueRow) {
  _hudClueRow.addEventListener("click", () => {
    _hudClueRow.classList.toggle("hud-clue-expanded");
  });
}

// ── Backwards-compat stubs ───────────────────────────────────
// Legacy calls to showClueCard / hideClueCard / hideClueCardFully
// are redirected so nothing breaks if other code still calls them.
let clueCardDismissed = false; // kept for any external checks
function showClueCard(clueText, checkpointNumber) {
  showClueInHUD(clueText, checkpointNumber);
}
function hideClueCard() {
  // No-op — HUD clue row is persistent, not dismissible mid-hunt
}
function resummonClueCard() {
  const row = document.getElementById("hud-clue-row");
  if (row) row.classList.remove("hidden");
}
function hideClueCardFully() {
  hideHudClueRow();
  _huntClueLog = [];
}

// ======================================================
// ⭐ JOURNAL SYSTEM — Load Routes + Load Checkpoints + UI
// ======================================================

// DOM refs
// ======================================================
// ⭐ JOURNAL — NARRATOR-FIRST UI
// Home: narrator dossier cards (locked until first entry found)
// Tap narrator → see all their entries across all routes
// Tap entry → open lore card
// ======================================================

const journalScreen      = document.getElementById("journal-screen");
const journalRouteList   = document.getElementById("journal-route-list");    // repurposed as narrator list
const journalRouteDetail = document.getElementById("journal-route-detail");  // repurposed as narrator detail
const journalCheckpointList = document.getElementById("journal-checkpoint-list");
const journalBackBtn     = document.getElementById("journal-back-btn");
const routeDetailBackBtn = document.getElementById("route-detail-back-btn");
const routeDetailTitle   = document.getElementById("route-detail-title");

function openJournalPanel() { openJournalScreen(); }

async function openJournalScreen() {
  closeAllScreens();
  hideCompass();
  if (!auth.currentUser) return;
  pageFlipSound.currentTime = 0;
  pageFlipSound.play().catch(() => {});
  journalScreen.classList.remove("hidden");
  journalRouteDetail.classList.add("hidden");
  await loadNarratorDossiers();
}

if (journalBackBtn) {
  journalBackBtn.addEventListener("click", () => {
    journalScreen.classList.add("hidden");
    journalRouteList.innerHTML = "";
    showCompass();
  });
}

// ── Home: narrator dossier cards ──────────────────────────────
async function loadNarratorDossiers() {
  const user = auth.currentUser;
  if (!user) return;
  journalRouteList.innerHTML = "";

  // Gather all entries the player has found, keyed by author
  let allEntries = [];
  try {
    const routeSnaps = await getDocs(collection(db, "Users", user.uid, "LoreJournal"));
    await Promise.all(routeSnaps.docs.map(async (routeDoc) => {
      const entrySnaps = await getDocs(collection(db, "Users", user.uid, "LoreJournal", routeDoc.id, "entries"));
      entrySnaps.docs.forEach(d => {
        allEntries.push({ routeName: routeDoc.id, ...d.data() });
      });
    }));
  } catch (err) {
    console.error("loadNarratorDossiers error:", err);
    journalRouteList.innerHTML = `<div style="color:#f66;margin-top:12px;">Could not load journal. Check your connection.</div>`;
    return;
  }

  if (allEntries.length === 0) {
    journalRouteList.innerHTML = `<div style="color:#ccc;margin-top:12px;">No journal entries yet.</div>`;
    return;
  }

  // Group by author
  const byAuthor = {};
  allEntries.forEach(e => {
    const key = e.author || "__anonymous";
    if (!byAuthor[key]) byAuthor[key] = [];
    byAuthor[key].push(e);
  });

  // Render known narrators first (in registry order), then anonymous
  const renderedIds = new Set();

  NARRATORS.forEach(narrator => {
    const entries = byAuthor[narrator.id] || [];
    renderedIds.add(narrator.id);
    renderNarratorCard(narrator, entries);
  });

  // Anonymous / unrecognised authors
  Object.keys(byAuthor).forEach(key => {
    if (renderedIds.has(key)) return;
    const anonNarrator = { id: key, name: "Unknown", descriptor: "Author unidentified", loreStyle: "stone" };
    renderNarratorCard(anonNarrator, byAuthor[key]);
  });

  // Update the menu button badge with total unread count
  const totalUnread = allEntries.filter(e => e.read === false).length;
  updateJournalBadge(totalUnread);
}

// Updates the unread dot/count on the Journal menu button.
// Call after loading entries or marking one as read.
function updateJournalBadge(count) {
  const badge = document.getElementById("journal-unread-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function renderNarratorCard(narrator, entries) {
  if (entries.length === 0) return; // don't show undiscovered narrators

  const isRevealed  = (window.__unlockedPOIs || []).includes(narrator.unlockPOIId);
  const showName    = !narrator.hideName || isRevealed;
  const displayName = showName ? narrator.name : "???";
  const unread      = entries.filter(e => e.read === false).length;

  // Bio fragments unlocked so far
  const allUnlocked    = window.__unlockedBioFragments?.[narrator.id] || [];
  const visibleFragments = (narrator.bioFragments || []).filter(f => {
    const key = f.unlocksAfter === 0 ? "__initial" : f.unlocksAfter;
    return allUnlocked.includes(key);
  });

  const card = document.createElement("div");
  card.className = "narrator-card" + (isRevealed ? " narrator-revealed" : " narrator-discovered");
  card.dataset.narratorId = narrator.id;

  // Portrait
  const portraitHtml = isRevealed && narrator.portrait
    ? `<img class="narrator-portrait" src="${narrator.portrait}" alt="${narrator.name}">`
    : `<div class="narrator-portrait-placeholder">${showName ? "👤" : "?"}</div>`;

  // Bio fragments
  const bioHtml = visibleFragments.length
    ? `<div class="narrator-bio">
        ${visibleFragments.map(f => `<p class="narrator-bio-fragment">${f.text}</p>`).join("")}
       </div>`
    : "";

  const totalFragments = (narrator.bioFragments || []).length;
  const fragmentCount  = visibleFragments.length;
  const bioProgress    = totalFragments > 0 && isRevealed
    ? `<div class="narrator-bio-progress">${fragmentCount} of ${totalFragments} bio entries unlocked</div>`
    : "";

  card.innerHTML = `
    <div class="narrator-card-inner">
      ${portraitHtml}
      <div class="narrator-card-content">
        <div class="narrator-card-name">${displayName}</div>
        ${showName ? `<div class="narrator-card-descriptor">${narrator.descriptor}</div>` : ""}
        <div class="narrator-card-meta">
          ${entries.length} ${entries.length === 1 ? "entry" : "entries"} found
          ${unread > 0 ? `<span class="narrator-unread-badge">${unread} unread</span>` : ""}
        </div>
      </div>
    </div>
    ${bioHtml}
    ${bioProgress}
  `;

  card.addEventListener("click", () => openNarratorDetail(narrator, entries));
  journalRouteList.appendChild(card);
}

// ── Narrator detail: all their entries ───────────────────────
async function openNarratorDetail(narrator, entries) {
  journalScreen.classList.add("hidden");
  journalRouteDetail.classList.remove("hidden");
  routeDetailTitle.textContent = narrator.name;

  // Wire Mark All Read to mark all entries for this narrator
  const markAllBtn = document.getElementById("markAllReadBtn");
  if (markAllBtn) {
    markAllBtn.style.display = "";
    markAllBtn.onclick = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const routeSnaps = await getDocs(collection(db, "Users", user.uid, "LoreJournal"));
        const batch = writeBatch(db);
        await Promise.all(routeSnaps.docs.map(async (routeDoc) => {
          const entrySnaps = await getDocs(
            collection(db, "Users", user.uid, "LoreJournal", routeDoc.id, "entries")
          );
          entrySnaps.forEach(d => {
            if (d.data().author === narrator.id) {
              batch.set(d.ref, { read: true }, { merge: true });
            }
          });
        }));
        await batch.commit();
        document.querySelectorAll(".unread-dot").forEach(dot => dot.remove());
        updateJournalBadge(0);
      } catch (err) {
        console.error("markAllRead narrator error:", err);
      }
    };
  }

  journalCheckpointList.innerHTML = "";

  // Sort by discovery time
  const sorted = [...entries].sort((a, b) => {
    const ta = a.unlockedAt?.toMillis?.() ?? 0;
    const tb = b.unlockedAt?.toMillis?.() ?? 0;
    return ta - tb;
  });

  sorted.forEach(entry => {
    const isUnread  = entry.read === false;
    const item      = document.createElement("div");
    item.className  = "checkpoint-item";

    const displayTitle = entry.title || `Entry`;
    const routeLabel   = entry.routeName ? `<span class="entry-route-label">${entry.routeName}</span>` : "";

    item.innerHTML = `
      <div class="checkpoint-title">
        ${displayTitle}
        ${isUnread ? `<span class="unread-dot"></span>` : ""}
      </div>
      ${routeLabel}
      <div class="checkpoint-preview">"${entry.text.slice(0, 60)}..."</div>
    `;

    item.addEventListener("click", () => {
      markLoreAsRead(entry.routeName, entry.checkpointIndex);
      openLoreCard({ title: displayTitle, text: entry.text, style: entry.style });
      item.querySelector(".unread-dot")?.remove();
    });

    journalCheckpointList.appendChild(item);
  });
}

if (routeDetailBackBtn) {
  routeDetailBackBtn.addEventListener("click", () => {
    journalRouteDetail.classList.add("hidden");
    journalScreen.classList.remove("hidden");
    // compass stays hidden while journal is open — no showCompass here
  });
}

// ── Mark all read — narrator scoped (detail screen) ──────────
async function markAllLoreAsRead(routeName) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const entriesCol = collection(
      db,
      "Users",
      user.uid,
      "LoreJournal",
      routeName,
      "entries"
    );

    const entrySnaps = await getDocs(entriesCol);

    const batch = writeBatch(db);
    entrySnaps.forEach((docSnap) => {
      const ref = docSnap.ref;
      batch.set(ref, { read: true }, { merge: true });
    });

    await batch.commit();

    document.querySelectorAll(".unread-dot").forEach((dot) => dot.remove());
    updateJournalBadge(0);
    console.log(`All lore entries for ${routeName} marked as read.`);
  } catch (err) {
    console.error("markAllLoreAsRead error:", err);
  }
}

// ── Mark all read — global (Sources home screen) ─────────────
async function markAllLoreAsReadGlobal() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const routeSnaps = await getDocs(collection(db, "Users", user.uid, "LoreJournal"));
    const batch = writeBatch(db);

    await Promise.all(routeSnaps.docs.map(async (routeDoc) => {
      const entrySnaps = await getDocs(
        collection(db, "Users", user.uid, "LoreJournal", routeDoc.id, "entries")
      );
      entrySnaps.forEach(d => batch.set(d.ref, { read: true }, { merge: true }));
    }));

    await batch.commit();
    document.querySelectorAll(".unread-dot").forEach(dot => dot.remove());
    document.querySelectorAll(".narrator-unread-badge").forEach(b => b.remove());
    updateJournalBadge(0);
    console.log("All lore entries marked as read globally.");
  } catch (err) {
    console.error("markAllLoreAsReadGlobal error:", err);
  }
}

// Wire global button
const markAllReadGlobalBtn = document.getElementById("markAllReadGlobalBtn");
if (markAllReadGlobalBtn) {
  markAllReadGlobalBtn.addEventListener("click", markAllLoreAsReadGlobal);
}



// ======================================================
// ⭐ WORLD POI SYSTEM
// Loads WorldPOIs from Firestore, places amber markers,
// detects proximity, handles requiresItem + oneTime logic,
// grants items, shows lore card or toast.
// ======================================================

// State
let worldPOIs = [];           // raw POI data from Firestore
const poiMarkers = {};        // poiId → Leaflet marker
const poiDwellTimers = {};    // poiId → setTimeout handle
const visitedPOIs = new Set();// poiIds triggered this session (oneTime guard)

const POI_DWELL_MS = 1200;    // slightly snappier than checkpoints

// ── Load + render ──────────────────────────────────────

function normalisePOI(poi) {
  if (poi["0"] && typeof poi["0"] === "object") {
    Object.assign(poi, poi["0"]);
    delete poi["0"];
  }
  return poi;
}

// Fetches POI data without rendering — markers are held back
// until the first GPS fix so POIs stay secret until nearby.
async function loadWorldPOIsData() {
  try {
    const snap = await getDocs(collection(db, "WorldPOIs"));
    worldPOIs = snap.docs.map(d => normalisePOI({ id: d.id, ...d.data() }));
    console.log(`[WorldPOIs] loaded ${worldPOIs.length} POIs — awaiting GPS fix to render`);
  } catch (err) {
    console.error("[WorldPOIs] load error:", err);
  }
}

// Full load + render (used when GPS is already known, e.g. route builder preview)
async function loadWorldPOIs() {
  await loadWorldPOIsData();
  if (userLatLng) renderWorldPOIs();
}

function renderWorldPOIs() {
  Object.values(poiMarkers).forEach(m => {
    if (map.hasLayer(m)) map.removeLayer(m);
  });
  Object.keys(poiMarkers).forEach(k => delete poiMarkers[k]);

  worldPOIs.forEach(poi => {
    // If this POI is narrator-gated, only show it if it's been unlocked
    if (poi.narratorGated && !(window.__unlockedPOIs || []).includes(poi.id)) return;

    const lat = parseFloat(poi.lat ?? poi.Lat ?? poi.latitude);
    const lng = parseFloat(poi.lng ?? poi.Lng ?? poi.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const alreadyVisited = visitedPOIs.has(poi.id);
    const visitedClass   = alreadyVisited ? " poi-visited" : "";

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: `<div class="poi-marker${visitedClass}">
                 <img class="poi-svg" src="icons/poi-marker.svg" alt="Point of Interest">
               </div>`,
        className: "",
        iconSize:   [40, 40],
        iconAnchor: [20, 20]
      }),
      interactive: true,
      pane: "markerPane"
    }).addTo(map);

    marker.on("click", () => {
      if (!userLatLng) return;
      const dist   = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
      const radius = parseFloat(poi.radius) || 20;
      if (dist > radius * 3) {
        showHintToast(`${poi.name || "Point of Interest"} — walk closer to interact`);
      }
    });

    poiMarkers[poi.id] = marker;
  });

  if (userLatLng) updatePOIDistanceClasses();
}

function updatePOIDistanceClasses() {
  if (!userLatLng || !worldPOIs.length) return;
  worldPOIs.forEach(poi => {
    const marker = poiMarkers[poi.id];
    if (!marker) return;
    const lat = parseFloat(poi.lat ?? poi.Lat ?? poi.latitude);
    const lng = parseFloat(poi.lng ?? poi.Lng ?? poi.longitude);
    if (isNaN(lat) || isNaN(lng)) return;
    const dist = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
    const el   = marker.getElement();
    if (!el) return;
    const div = el.querySelector(".poi-marker");
    if (!div) return;
    div.classList.remove("poi-far", "poi-distant");
    if      (dist > 2000) div.classList.add("poi-distant");
    else if (dist > 1000) div.classList.add("poi-far");
  });
}

// ── Item grant ──────────────────────────────────────────

async function grantItem(itemId, deferToast = false, oneTimeItem = false) {
  const user = auth.currentUser;
  if (!user || !itemId) return;

  try {
    // Fetch item definition
    const defSnap = await getDoc(doc(db, "Items", itemId));
    const def = defSnap.exists() ? defSnap.data() : null;

    // Write to inventory (increment qty if already owned)
    const invRef = doc(db, "Users", user.uid, "inventory", itemId);
    const invSnap = await getDoc(invRef);
    const currentQty = invSnap.exists() ? (invSnap.data().quantity || 1) : 0;

    // One-time items: silently skip if the player already has one
    if (oneTimeItem && currentQty >= 1) {
      console.log(`[grantItem] skipping ${itemId} — oneTimeItem already owned`);
      return;
    }

    await setDoc(invRef, {
      foundAt:  invSnap.exists() ? invSnap.data().foundAt : new Date(),
      quantity: currentQty + 1
    }, { merge: true });

    const toastName   = def?.name   || itemId;
    const toastIcon   = def?.icon   || null;
    const toastRarity = def?.rarity || "common";

    if (deferToast) {
      // Lore card is open — queue the toast so it fires after the card closes
      pendingItemToast = { name: toastName, iconSrc: toastIcon, rarity: toastRarity };
    } else {
      showItemToast(toastName, toastIcon, toastRarity);
    }

    console.log(`[grantItem] granted ${itemId} to ${user.uid}`);
    updatePOIBioGlow().catch(console.error);
  } catch (err) {
    console.error("[grantItem] error:", err);
  }
}

// ── Item toast ──────────────────────────────────────────

let itemToastTimer = null;

function showItemToast(name, iconSrc, rarity) {
  const toast    = document.getElementById("item-toast");
  const titleEl  = document.getElementById("item-toast-title");
  const nameEl   = document.getElementById("item-toast-name");
  const iconEl   = document.getElementById("item-toast-icon");
  if (!toast) return;

  // Icon — image or emoji fallback
  if (iconSrc) {
    iconEl.innerHTML = `<img src="${iconSrc}" alt="${name}">`;
  } else {
    iconEl.textContent = "📦";
  }

  titleEl.textContent = "Item Found";
  nameEl.textContent  = name;

  // Rarity tint on border
  const rarityColors = {
    common:    "rgba(255,170,40,0.55)",
    uncommon:  "rgba(100,220,100,0.55)",
    rare:      "rgba(80,160,255,0.65)",
    epic:      "rgba(180,80,255,0.65)",
    legendary: "rgba(255,180,0,0.8)"
  };
  toast.style.borderColor = rarityColors[(rarity || "common").toLowerCase()] || rarityColors.common;

  toast.classList.remove("hidden");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("show"));
  });

  if (itemToastTimer) clearTimeout(itemToastTimer);
  itemToastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 3500);
}

// ── POI trigger ─────────────────────────────────────────

async function triggerPOI(poi) {
  const user = auth.currentUser;
  if (!user) return;

  // requiresItem check — does player have the needed item?
  if (poi.requiresItem) {
    try {
      const invSnap = await getDoc(doc(db, "Users", user.uid, "inventory", poi.requiresItem));
      if (!invSnap.exists()) {
        showHintToast(`You need an item to interact with this.`);
        const m = poiMarkers[poi.id];
        if (m && m.getElement()) {
          const div = m.getElement().querySelector(".poi-marker");
          if (div) {
            div.classList.add("poi-locked");
            if (!div.querySelector(".poi-lock-badge")) {
              const badge = document.createElement("span");
              badge.className = "poi-lock-badge";
              badge.textContent = "🔒";
              div.appendChild(badge);
            }
          }
        }
        return;
      }
    } catch (err) {
      console.error("[triggerPOI] requiresItem check error:", err);
      return;
    }
  }

  // Mark visited in session
  visitedPOIs.add(poi.id);

  // Haptic
  if (navigator.vibrate) navigator.vibrate([60, 30, 80]);

  // Gold visited state if oneTime
  if (poi.oneTime) {
    const m = poiMarkers[poi.id];
    if (m && m.getElement()) {
      const div = m.getElement().querySelector(".poi-marker");
      if (div) {
        div.classList.remove("poi-far", "poi-distant");
        div.classList.add("poi-visited");
      }
    }
    // Persist visited state so it survives session (best-effort)
    try {
      await setDoc(
        doc(db, "Users", user.uid, "visitedPOIs", poi.id),
        { visitedAt: new Date() },
        { merge: true }
      );
    } catch (e) { /* non-critical */ }
  }

  // Show lore card if POI has lore, otherwise a simple toast
  if (poi.lore?.text) {
    openLoreCard({
      title: poi.lore.title || poi.name || "Point of Interest",
      text:  poi.lore.text,
      style: poi.lore.style || "stone"
    });
  } else if (poi.description) {
    showLoreToast(poi.description);
  } else {
    showLoreToast(poi.name || "You discovered a point of interest.");
  }

  // Grant item if configured — oneTime POIs only grant once (same guard as checkpoint items)
  if (poi.item) {
    setTimeout(() => grantItem(poi.item, false, !!poi.oneTime), poi.lore?.text ? 800 : 0);
  }

  // ── Bio fragment unlock check ─────────────────────────────
  // If this POI is tied to a narrator, check the player's inventory
  // against bioFragments and unlock any newly eligible fragments.
  await checkBioFragmentUnlocks(poi);
}

// ── BIO FRAGMENT UNLOCK SYSTEM ───────────────────────────────
// When a narrator-gated POI is visited, check which bioFragments
// are now unlockable based on the player's inventory. Write newly
// unlocked fragments to the user profile and update the Sources card.

async function checkBioFragmentUnlocks(poi) {
  const user = auth.currentUser;
  if (!user) return;

  // Find narrator whose unlockPOIId matches this POI
  const narrator = NARRATORS.find(n => n.unlockPOIId === poi.id);
  if (!narrator?.bioFragments?.length) return;

  const alreadyUnlocked = window.__unlockedBioFragments?.[narrator.id] || [];
  const newlyUnlocked = [];

  // Check each fragment
  for (const fragment of narrator.bioFragments) {
    const key = fragment.unlocksAfter === 0 ? "__initial" : fragment.unlocksAfter;
    if (alreadyUnlocked.includes(key)) continue;

    // Initial fragment unlocks on first POI visit (unlocksAfter: 0)
    if (fragment.unlocksAfter === 0) {
      newlyUnlocked.push(key);
      continue;
    }

    // Item-gated fragment — check inventory
    try {
      const invSnap = await getDoc(doc(db, "Users", user.uid, "inventory", fragment.unlocksAfter));
      if (invSnap.exists()) newlyUnlocked.push(key);
    } catch (err) {
      console.error("[bioFragments] inventory check error:", err);
    }
  }

  if (!newlyUnlocked.length) return;

  // Update local state
  window.__unlockedBioFragments = window.__unlockedBioFragments || {};
  window.__unlockedBioFragments[narrator.id] = [...alreadyUnlocked, ...newlyUnlocked];

  // Persist to Firestore
  try {
    const profileRef = doc(db, "Users", user.uid, "profile", "info");
    await setDoc(profileRef, { unlockedBioFragments: window.__unlockedBioFragments }, { merge: true });
    console.log(`[bioFragments] ${newlyUnlocked.length} new fragment(s) unlocked for ${narrator.id}`);
  } catch (err) {
    console.error("[bioFragments] save error:", err);
  }

  // Show toast for new fragment
  showLoreToast(`New entry unlocked in Sources.`);
}

// Check if a narrator POI marker should pulse because new bio fragments
// are available based on current inventory. Called after items are granted.
async function updatePOIBioGlow() {
  const user = auth.currentUser;
  if (!user) return;

  for (const narrator of NARRATORS) {
    if (!narrator.unlockPOIId || !narrator.bioFragments?.length) continue;
    if (!(window.__unlockedPOIs || []).includes(narrator.unlockPOIId)) continue;

    const alreadyUnlocked = window.__unlockedBioFragments?.[narrator.id] || [];
    let hasNew = false;

    for (const fragment of narrator.bioFragments) {
      const key = fragment.unlocksAfter === 0 ? "__initial" : fragment.unlocksAfter;
      if (alreadyUnlocked.includes(key)) continue;
      if (fragment.unlocksAfter === 0) continue;

      try {
        const invSnap = await getDoc(doc(db, "Users", user.uid, "inventory", fragment.unlocksAfter));
        if (invSnap.exists()) { hasNew = true; break; }
      } catch { continue; }
    }

    const marker = poiMarkers[narrator.unlockPOIId];
    if (marker?.getElement()) {
      const el = marker.getElement().querySelector(".poi-marker");
      if (el) el.classList.toggle("poi-bio-ready", hasNew);
    }
  }
}

// ── POI proximity loop (called from updateUserMarker) ───

function checkPOIProximity() {
  if (!userLatLng || !worldPOIs.length) return;

  worldPOIs.forEach(poi => {
    const poiId = poi.id;

    // Already triggered this session for a oneTime POI
    if (poi.oneTime && visitedPOIs.has(poiId)) return;

    const lat = parseFloat(poi.lat ?? poi.Lat ?? poi.latitude);
    const lng = parseFloat(poi.lng ?? poi.Lng ?? poi.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const dist   = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
    const radius = parseFloat(poi.radius) || 20;

    if (dist <= radius) {
      if (!poiDwellTimers[poiId]) {
        poiDwellTimers[poiId] = setTimeout(async () => {
          // Confirm still inside when timer fires
          const confirmDist = distanceInMeters(userLatLng.lat, userLatLng.lng, lat, lng);
          if (confirmDist <= radius) {
            // Don't re-trigger a oneTime POI already visited
            if (poi.oneTime && visitedPOIs.has(poiId)) return;
            await triggerPOI(poi);
          }
          delete poiDwellTimers[poiId];
        }, POI_DWELL_MS);
      }
    } else {
      // Left radius — cancel pending dwell
      if (poiDwellTimers[poiId]) {
        clearTimeout(poiDwellTimers[poiId]);
        delete poiDwellTimers[poiId];
      }
    }
  });
}

// ── Load visited POIs from Firestore on sign-in ─────────

async function loadVisitedPOIs() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snap = await getDocs(collection(db, "Users", user.uid, "visitedPOIs"));
    snap.forEach(d => visitedPOIs.add(d.id));
    console.log(`[WorldPOIs] ${visitedPOIs.size} previously visited POIs restored`);
  } catch (e) { /* non-critical */ }
}

// ============================================================
// iOS BACKGROUND / FOREGROUND HANDLING
// Restart GPS when app becomes visible again (iOS kills it on hide)
// ============================================================

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // App came back to foreground — restart GPS if user is signed in
    if (auth.currentUser && !watchId && "geolocation" in navigator) {
      console.log("[iOS] App resumed — restarting GPS watch");
      startGeolocationWatch();
    }
  }
});

// ======== FINAL NOTES ========
// Pane z-indexes are set via .style.zIndex (no !important) so Leaflet retains compositing control.
// Exposes runtime references for debugging and logs showRoute/clearRoute lifecycle events.
// Additional updates:
// - Geolocation starts when user signs in (and stops on sign-out)
// - Recenter button can bootstrap GPS if it wasn't running
// - Auto-follow is smoothed to avoid jitter
// - Nearby screen uses distance-based filtering
// - History is sorted newest → oldest
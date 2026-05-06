import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCarnulDTSjprYcbXN15Hc_dCMV2gGsEuA",
  authDomain: "library-de0d8.firebaseapp.com",
  projectId: "library-de0d8",
  storageBucket: "library-de0d8.firebasestorage.app",
  messagingSenderId: "334059141260",
  appId: "1:334059141260:web:f011c7b1bea772d4f3e3a9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

// DOM Elements (must exist in index.html)
const appSection = document.getElementById("appSection");
const userDisplay = document.getElementById("userDisplay");
const loggedOutLinks = document.getElementById("loggedOutLinks");
const loggedInLinks = document.getElementById("loggedInLinks");
const logoutBtn = document.getElementById("logoutBtn");

// Auth modal elements (login/signup are injected into authFormContainer)
const authModal = document.getElementById("authModal");
const authFormContainer = document.getElementById("authFormContainer");
const modalTitle = document.getElementById("modalTitle");
const toggleText = document.getElementById("toggleText");
const toggleAuthMode = document.getElementById("toggleAuthMode");

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const booksGrid = document.getElementById("booksGrid");
const favoritesGrid = document.getElementById("favoritesGrid");
const favoritesSection = document.getElementById("favoritesSection");
const toast = document.getElementById("toast");

let currentUser = null;
let favoritesMap = new Map();
let latestBooks = [];
let unsubscribeFavorites = null;
let hasShownFavoritesPermissionError = false;
let isSigningOutForExpiry = false;

const AUTH_SESSION_KEY = "booknest_auth_session";
const AUTH_SESSION_ACTIVE_KEY = "booknest_auth_active";
const AUTH_TTL_DAYS = 7;

const PAGE_SIZE = 9;
let currentQuery = "classic";
let currentPage = 1;
let totalPages = 1;

const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");

if (window.location.protocol === "file:") {
  alert(
    "This app must run on a local server (http://localhost), not file://. Start a server and reopen from the localhost URL."
  );
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Auth persistence setup error:", error);
});

function saveAuthSession(user) {
  if (!user) return;
  const now = Date.now();
  const expiresAt = now + AUTH_TTL_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(
    AUTH_SESSION_KEY,
    JSON.stringify({
      uid: user.uid,
      email: user.email || "",
      createdAt: now,
      expiresAt
    })
  );
  // Keep a lightweight marker in sessionStorage for current tab/session use.
  sessionStorage.setItem(AUTH_SESSION_ACTIVE_KEY, "1");
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_ACTIVE_KEY);
}

function getStoredAuthSession() {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    clearAuthSession();
    return null;
  }
}

function isStoredSessionExpired(user) {
  const session = getStoredAuthSession();
  if (!session) return false;
  if (session.uid !== user.uid) return true;
  return Date.now() > Number(session.expiresAt || 0);
}

function showToast(message, type = "info") {
  const normalizedType = typeof type === "boolean" ? (type ? "error" : "info") : type;
  const toneClasses =
    normalizedType === "success"
      ? "border border-emerald-400/40 bg-emerald-500/85"
      : normalizedType === "error"
        ? "border border-rose-400/40 bg-rose-600/90"
        : "border border-sky-300/40 bg-sky-500/85";

  toast.textContent = message;
  toast.className = `fixed top-6 right-6 z-50 rounded-2xl px-6 py-3 text-sm font-medium text-white shadow-xl backdrop-blur-md transition-all duration-300 ${toneClasses} hidden`;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2500);
}

function updatePaginationUI(page) {
  if (!pageInfo) return;
  pageInfo.textContent =
    totalPages > 1 ? `Page ${page} of ${totalPages}` : `Page 1`;

  if (prevPageBtn) prevPageBtn.disabled = page <= 1;
  if (nextPageBtn) nextPageBtn.disabled = page >= totalPages;
}

function getCoverUrl(book) {
  const coverId = book.cover_i;
  if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
  return "https://via.placeholder.com/300x420?text=No+Cover";
}

function getReadUrl(book) {
  // Open Library uses URLs like /works/OL... /authors/OL... etc.
  if (book.key) return `https://openlibrary.org${book.key}`;
  return "https://openlibrary.org/";
}

function getBookId(book) {
  // Prefer stable Open Library keys, fallback to title.
  return String(book.key || book.id || book.title || "").replaceAll("/", "_");
}

function userFavoritesCollection(uid) {
  return collection(db, "users", uid, "favorites");
}

function userFavoritesDoc(bookId) {
  return doc(db, "users", currentUser.uid, "favorites", bookId);
}

function getAuthorText(book) {
  const authors = book.author_name || [];
  if (Array.isArray(authors) && authors.length) return authors.join(", ");
  return "Unknown author";
}

// --- AUTH MODAL (login/signup) ---
window.toggleAuthModal = (mode = "login") => {
  if (!authModal || !authFormContainer) return;

  const isHidden = authModal.classList.contains("hidden");
  if (isHidden) {
    authModal.classList.remove("hidden");
    renderAuthForm(mode);
  } else {
    authModal.classList.add("hidden");
  }
};

function renderAuthForm(mode) {
  const isLogin = mode === "login";

  if (modalTitle) modalTitle.innerText = isLogin ? "Welcome Back" : "Create Account";
  if (toggleText)
    toggleText.innerText = isLogin ? "Don't have an account?" : "Already have an account?";
  if (toggleAuthMode) toggleAuthMode.innerText = isLogin ? "Sign Up" : "Login";

  if (toggleAuthMode) {
    toggleAuthMode.onclick = () => renderAuthForm(isLogin ? "signup" : "login");
  }

  authFormContainer.innerHTML = `
    <form id="authActionForm" data-mode="${mode}" class="space-y-4">
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Email Address</label>
        <input
          type="email"
          id="authEmail"
          required
          class="w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 outline-none focus:border-violet-500 transition-all"
        />
      </div>
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Password</label>
        <input
          type="password"
          id="authPassword"
          required
          minlength="6"
          class="w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 outline-none focus:border-violet-500 transition-all"
        />
      </div>
      <button
        type="submit"
        class="w-full rounded-xl bg-violet-600 py-3 font-bold text-white hover:bg-violet-500 transition-all active:scale-[0.98] shadow-lg shadow-violet-600/20"
      >
        ${isLogin ? "Sign In" : "Join BookNest"}
      </button>
    </form>
  `;
}

// Handle submits from the injected auth form
authFormContainer?.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form || !(form instanceof HTMLFormElement)) return;
  e.preventDefault();

  const mode = form.dataset.mode;
  const emailEl = document.getElementById("authEmail");
  const passwordEl = document.getElementById("authPassword");

  const email = emailEl?.value?.trim();
  const password = passwordEl?.value?.trim();
  if (!email || !password) return;

  try {
    if (mode === "signup") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      saveAuthSession(credential.user);
      showToast("Account created successfully!", "success");
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      saveAuthSession(credential.user);
      showToast("Welcome back!", "success");
    }
    window.toggleAuthModal();
  } catch (error) {
    console.error("Auth error:", error);
    showToast(
      `${error?.code ? error.code + ": " : ""}${error?.message || "Auth failed"}`,
      "error"
    );
  }
});

function requireSignIn(message = "Please sign in first.") {
  if (currentUser) return true;
  showToast(message, "error");
  if (typeof window.toggleAuthModal === "function") {
    window.toggleAuthModal("login");
  }
  return false;
}

function renderBooks(books) {
  latestBooks = books;

  if (!books.length) {
    booksGrid.innerHTML =
      '<p class="col-span-full rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-400">No books found for this search.</p>';
    return;
  }

  // Favorites first on the current page (stable ordering within each group).
  const ordered = books
    .map((book, idx) => {
      const id = getBookId(book);
      const isFavorite = favoritesMap.has(id);
      return {
        book,
        idx,
        id,
        isFavorite,
        readUrl: getReadUrl(book),
        title: book.title || "Untitled",
        authorText: getAuthorText(book),
        year: book.first_publish_year || "",
      };
    })
    .sort((a, b) => {
      const favDiff = Number(b.isFavorite) - Number(a.isFavorite);
      if (favDiff !== 0) return favDiff;
      return a.idx - b.idx;
    });

  booksGrid.innerHTML = ordered
    .map(({ id, isFavorite, readUrl, title, authorText, year, book }) => {
      return `
      <article class="group flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 transition-all hover:border-violet-500/40 hover:bg-slate-900/55">
        <div class="relative">
          <div class="aspect-[3/4] w-full overflow-hidden bg-slate-950">
            <img
              src="${getCoverUrl(book)}"
              alt="${title}"
              class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          </div>
          <div class="absolute left-3 top-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-semibold text-violet-200 backdrop-blur">
            ${year ? year : "Book"}
          </div>
        </div>
        <div class="flex flex-1 flex-col gap-3 p-4">
          <h3 class="line-clamp-2 text-base font-bold text-white">${title}</h3>
          <p class="line-clamp-1 text-sm text-slate-400">${authorText}</p>
          <div class="mt-auto flex gap-2">
            <button
              data-read-url="${readUrl || ""}"
              class="read-btn flex-1 rounded-xl bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-blue-500"
            >
              Read
            </button>
            <button
              data-book-id="${id}"
              class="favorite-btn flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${
                isFavorite
                  ? "bg-amber-400 text-slate-950 hover:bg-amber-300"
                  : "bg-violet-600 hover:bg-violet-500"
              }"
            >
              ${isFavorite ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </article>
    `;
    })
    .join("");
}

function renderFavorites() {
  const favorites = [...favoritesMap.values()];
  if (!favorites.length) {
    if (favoritesSection) favoritesSection.classList.add("hidden");
    favoritesGrid.innerHTML =
      '<p class="col-span-full rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-400">No favorite books yet.</p>';
    return;
  }

  if (favoritesSection) favoritesSection.classList.remove("hidden");
  favoritesGrid.innerHTML = favorites
    .map((book) => {
      return `
      <article class="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-4">
        <img src="${book.coverUrl}" alt="${book.title}" class="mb-3 h-64 w-full rounded-lg object-cover" />
        <h3 class="line-clamp-2 text-base font-semibold">${book.title}</h3>
        <p class="mt-1 text-sm text-slate-400">${book.author}</p>
        <div class="mt-4 flex gap-2">
          <a href="${book.readUrl}" target="_blank" rel="noopener noreferrer" class="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-semibold hover:bg-blue-500">Read</a>
          <button data-book-id="${book.id}" class="remove-favorite-btn flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold hover:bg-rose-500">
            Remove
          </button>
        </div>
      </article>
    `;
    })
    .join("");
}

function renderBookSkeletons(count = PAGE_SIZE) {
  const skeletonCards = Array.from({ length: count }, (_, idx) => {
    return `
      <article class="skeleton-card overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div class="skeleton-shimmer aspect-[3/4] w-full rounded-xl bg-slate-800/80"></div>
        <div class="mt-4 space-y-3">
          <div class="skeleton-shimmer h-4 w-5/6 rounded-md bg-slate-800/80"></div>
          <div class="skeleton-shimmer h-3 w-2/3 rounded-md bg-slate-800/70"></div>
          <div class="mt-5 grid grid-cols-2 gap-2">
            <div class="skeleton-shimmer h-9 rounded-xl bg-slate-800/70"></div>
            <div class="skeleton-shimmer h-9 rounded-xl bg-slate-800/70"></div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  booksGrid.innerHTML = skeletonCards;
}

async function searchBooks(query, page = 1) {
  currentQuery = query;
  currentPage = page;

  renderBookSkeletons();
  try {
    // Open Library tends to respond quickly and avoids Gutendex format requirements.
    const offset = (page - 1) * PAGE_SIZE;
    const response = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!response.ok) throw new Error(`Open Library HTTP ${response.status}`);
    const data = await response.json();

    const docs = data.docs || [];
    const numFound = typeof data.numFound === "number" ? data.numFound : 0;
    totalPages = Math.max(1, Math.ceil(numFound / PAGE_SIZE));
    updatePaginationUI(page);

    renderBooks(docs);
  } catch (error) {
    booksGrid.innerHTML =
      '<p class="col-span-full rounded-lg border border-rose-700 bg-rose-950/50 p-4 text-rose-300">Could not load books. Please try again.</p>';
    showToast(error.message || "Failed to load books", "error");
  }
}

function startFavoritesListener(uid) {
  if (unsubscribeFavorites) unsubscribeFavorites();

  unsubscribeFavorites = onSnapshot(
    userFavoritesCollection(uid),
    (snapshot) => {
      favoritesMap = new Map();
      snapshot.forEach((docSnap) => {
        favoritesMap.set(docSnap.id, docSnap.data());
      });
      renderFavorites();
      renderBooks(latestBooks);
    },
    (error) => {
      // Most common reason: Firestore security rules deny access.
      console.error("Favorites listener error:", error);
      if (error?.code === "permission-denied") {
        if (!hasShownFavoritesPermissionError) {
          hasShownFavoritesPermissionError = true;
          showToast(
            "Favorites permission denied. Publish Firestore rules for users/{uid}/favorites.",
            "error"
          );
        }
        return;
      }
      showToast(`Favorites listener failed: ${error?.message || "unknown error"}`, "error");
    }
  );
}

function stopFavoritesListener() {
  if (unsubscribeFavorites) {
    unsubscribeFavorites();
    unsubscribeFavorites = null;
  }
  favoritesMap = new Map();
  renderFavorites();
  renderBooks(latestBooks);
}

async function saveFavorite(bookId) {
  if (!currentUser) return;
  const source = latestBooks.find((book) => getBookId(book) === bookId);
  if (!source) return;

  const payload = {
    id: bookId,
    title: source.title || "Untitled",
    author: getAuthorText(source),
    coverUrl: getCoverUrl(source),
    readUrl: getReadUrl(source),
    savedAt: Date.now()
  };

  await setDoc(userFavoritesDoc(bookId), payload);
  showToast("Saved to favorites", "success");
}

async function removeFavorite(bookId) {
  if (!currentUser) return;
  await deleteDoc(userFavoritesDoc(bookId));
  showToast("Removed from favorites", "error");
}

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    clearAuthSession();
    showToast("Logged out", "info");
  } catch (error) {
    console.error("Logout error:", error);
    showToast(`${error?.code ? error.code + ": " : ""}${error?.message || "Logout failed"}`, "error");
  }
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  searchBooks(query, 1);
});

prevPageBtn?.addEventListener("click", () => {
  if (!currentQuery) return;
  if (currentPage <= 1) return;
  searchBooks(currentQuery, currentPage - 1);
});

nextPageBtn?.addEventListener("click", () => {
  if (!currentQuery) return;
  if (currentPage >= totalPages) return;
  searchBooks(currentQuery, currentPage + 1);
});

booksGrid.addEventListener("click", async (event) => {
  const readButton = event.target.closest(".read-btn");
  if (readButton) {
    if (!requireSignIn("Please sign in to read books.")) return;
    const url = readButton.dataset.readUrl;
    if (!url) {
      showToast("No readable format available for this book.", "error");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const target = event.target.closest(".favorite-btn");
  if (!target) return;
  if (!requireSignIn("Please sign in to save favorites.")) return;

  const bookId = target.dataset.bookId;
  try {
    if (favoritesMap.has(bookId)) {
      await removeFavorite(bookId);
    } else {
      await saveFavorite(bookId);
    }
  } catch (error) {
    console.error("Favorite update error:", error);
    showToast(
      `${error?.code ? error.code + ": " : ""}${error?.message || "Favorite update failed"}`,
      "error"
    );
  }
});

favoritesGrid.addEventListener("click", async (event) => {
  const target = event.target.closest(".remove-favorite-btn");
  if (!target || !currentUser) return;
  try {
    await removeFavorite(target.dataset.bookId);
  } catch (error) {
    console.error("Favorite removal error:", error);
    showToast(
      `${error?.code ? error.code + ": " : ""}${error?.message || "Favorite removal failed"}`,
      "error"
    );
  }
});

onAuthStateChanged(auth, (user) => {
  hasShownFavoritesPermissionError = false;

  if (user && isStoredSessionExpired(user)) {
    if (!isSigningOutForExpiry) {
      isSigningOutForExpiry = true;
      showToast("Session expired. Please sign in again.", "error");
      signOut(auth).finally(() => {
        isSigningOutForExpiry = false;
      });
    }
    return;
  }

  currentUser = user;
  if (user) {
    saveAuthSession(user);
    if (authModal && !authModal.classList.contains("hidden")) {
      authModal.classList.add("hidden");
    }
    loggedOutLinks?.classList.add("hidden");
    loggedInLinks?.classList.remove("hidden");
    logoutBtn?.classList.remove("hidden");
    userDisplay.textContent = user.email;
    startFavoritesListener(user.uid);
  } else {
    loggedOutLinks?.classList.remove("hidden");
    loggedInLinks?.classList.add("hidden");
    logoutBtn?.classList.add("hidden");
    userDisplay.textContent = "";
    stopFavoritesListener();
    clearAuthSession();
  }
});

appSection?.classList.remove("hidden");
searchBooks("classic", 1);
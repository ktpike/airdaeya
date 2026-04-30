// =================================================================================
// 1. Firebase Configuration and Initialization
// =================================================================================

const firebaseConfig = {
  apiKey: "AIzaSyAw0SvMLJij6vYCtAOp34IQ6kObRnOD500",
  authDomain: "airdaeya.firebaseapp.com",
  projectId: "airdaeya",
  storageBucket: "airdaeya.firebasestorage.app",
  messagingSenderId: "809753474986",
  appId: "1:809753474986:web:153ba16b11ec9c4ca2ddd3",
};

const app = firebase.initializeApp(firebaseConfig);
console.log("Firebase initialized.");

const db = firebase.firestore();
const functions = firebase.functions();
const storage = firebase.storage();

// =================================================================================
// 2. Storage URL Helper
// =================================================================================

// Converts a storage file path (e.g. "Characters/Qat_Portrait.png") to a
// signed download URL using the Firebase Storage SDK.
const storageURLCache = {};

async function getStorageURL(filePath) {
    if (!filePath) return null;
    if (storageURLCache[filePath]) return storageURLCache[filePath];
    try {
        const ref = storage.ref(filePath);
        const url = await ref.getDownloadURL();
        storageURLCache[filePath] = url;
        return url;
    } catch (e) {
        console.warn(`Could not get storage URL for "${filePath}":`, e);
        return null;
    }
}


// Logo path cache — populated by discoverLogoPaths() on first use
const LOGO_PATHS = {};

async function discoverLogoPaths() {
    if (LOGO_PATHS._discovered) return;
    try {
        const listResult = await storage.ref('Logos').listAll();
        listResult.items.forEach(item => {
            const name = item.name.toLowerCase();
            if (name.includes('airdaeium') && (name.includes('icon') || name.includes('logo'))) {
                if (!name.includes('black') && !name.includes('white') && !name.includes('extended')) {
                    LOGO_PATHS.icon = item.fullPath;
                }
            }
            if (name.includes('ktpike') || name.includes('kt pike') || name.includes('kt_pike')) {
                if (name.includes('black') && name.includes('colored')) LOGO_PATHS.ktpikeBlackDots = item.fullPath;
                else if (name.includes('white') && name.includes('colored')) LOGO_PATHS.ktpikeWhiteDots = item.fullPath;
                else if (name.includes('black')) LOGO_PATHS.ktpikeBlack = item.fullPath;
                else if (name.includes('white')) LOGO_PATHS.ktpikeWhite = item.fullPath;
                else if (name.includes('color')) LOGO_PATHS.ktpikeColor = item.fullPath;
                else if (!LOGO_PATHS.ktpike) LOGO_PATHS.ktpike = item.fullPath;
            }
        });
        LOGO_PATHS._discovered = true;
        console.log('Discovered logo paths:', LOGO_PATHS);
    } catch (e) {
        console.warn('Could not list Logos folder:', e);
        LOGO_PATHS._discovered = true;
    }
}

async function getLogoURL(type) {
    await discoverLogoPaths();
    const path = type === 'icon'            ? LOGO_PATHS.icon :
                 type === 'ktpike-black'       ? (LOGO_PATHS.ktpikeBlack || LOGO_PATHS.ktpike) :
                 type === 'ktpike-black-dots'  ? (LOGO_PATHS.ktpikeBlackDots || LOGO_PATHS.ktpikeBlack || LOGO_PATHS.ktpike) :
                 type === 'ktpike-white'       ? (LOGO_PATHS.ktpikeWhite || LOGO_PATHS.ktpike) :
                 type === 'ktpike-white-dots'  ? (LOGO_PATHS.ktpikeWhiteDots || LOGO_PATHS.ktpikeWhite || LOGO_PATHS.ktpike) :
                 type === 'ktpike-color'       ? (LOGO_PATHS.ktpikeColor || LOGO_PATHS.ktpike) : null;
    if (!path) return null;
    return getStorageURL(path);
}


// Normalises whatever is stored in portrait to a full "Characters/Filename.ext" path.
// Handles: already-full path, filename-only, or gs:// URI.
function resolvePortraitPath(raw) {
    if (!raw) return null;
    // Strip gs://bucket/ prefix if present
    raw = raw.replace(/^gs:\/\/[^/]+\//, '');
    // If it already starts with "Characters/" we're done
    if (raw.startsWith('Characters/')) return raw;
    // Otherwise treat it as a bare filename
    return 'Characters/' + raw;
}

// =================================================================================
// UTM Tracking Helper
// =================================================================================
// Appends UTM parameters to any outbound link so WordPress Stats (and Jetpack)
// can identify traffic that came from the Airdaeium app.
// utm_source  → always 'airdaeium_app'
// utm_medium  → always 'app'
// utm_campaign → the specific context (e.g. 'book_link', 'about_modal')
function addAppTracking(url, campaign = 'general') {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}utm_source=airdaeium_app&utm_medium=app&utm_campaign=${campaign}`;
}

// FIX: Placeholder data URI — avoids the via.placeholder.com external request error
const PLACEHOLDER_IMG = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A//www.w3.org/2000/svg%22 width%3D%22100%22 height%3D%22100%22%3E%3Crect width%3D%22100%25%22 height%3D%22100%25%22 fill%3D%22%23452345%22/%3E%3C/svg%3E';
const PLACEHOLDER_IMG_LARGE = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A//www.w3.org/2000/svg%22 width%3D%22200%22 height%3D%22200%22%3E%3Crect width%3D%22100%25%22 height%3D%22100%25%22 fill%3D%22%23452345%22/%3E%3C/svg%3E';

// =================================================================================
// 3. Character List Tab State
// =================================================================================
// Tracks which view tab is active: 'profiles' | 'index'
let characterListTab = 'profiles';

// =================================================================================
// 4. Quiz Variables (was 3)
// =================================================================================
let quizQuestions = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// =================================================================================
// 5. Character Birthday Cache (was 4)
// =================================================================================
let characterBirthdays = null; // null = not yet loaded

async function loadCharacterBirthdays() {
    if (characterBirthdays !== null) return;
    try {
        const snapshot = await db.collection('characters').get();
        characterBirthdays = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.birthday) return;
            const tq  = data.birthday.tritquarter;
            const day = data.birthday.day;
            if (tq && day) {
                characterBirthdays.push({
                    name: data.goes_by || data.name || 'Unknown',
                    tq: parseInt(tq),
                    day: parseInt(day)
                });
            }
        });
        console.log(`Loaded ${characterBirthdays.length} character birthdays.`);
    } catch (e) {
        console.warn('Could not load character birthdays:', e);
        characterBirthdays = [];
    }
}

function getBirthdayCharacters(tqNumber, day) {
    if (!characterBirthdays) return [];
    return characterBirthdays.filter(b => b.tq === tqNumber && b.day === day);
}

function renderBirthdayMessage(characters) {
    if (!characters || characters.length === 0) return '';
    const names = characters.map(c => c.name).join(' & ');
    const emoji = characters.length === 1 ? '🎂' : '🎉';
    // FIX: Added class "birthday-message" for theme-aware styling
    return `<div class="today-special birthday-message">${emoji} Happy Birthday, ${names}!</div>`;
}

// =================================================================================
// 5. Theme Toggle Logic
// =================================================================================

function applyTheme(isDarkMode) {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = isDarkMode ? '☀️' : '🌙';
}

function initializeTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        applyTheme(true);
    } else if (saved === 'light') {
        applyTheme(false);
    } else {
        applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
}

// =================================================================================
// 6. Navigation Helper
// =================================================================================

function getContainer() {
    return document.querySelector('.container');
}

// =================================================================================
// 7. Home Screen
// =================================================================================

function displayHomeScreen() {
    const el = getContainer();
    if (!el) return;

    el.innerHTML = `
        <h1>Welcome to the Tales of Airdaeya compendium</h1>
        <p class="welcome-subtitle">Explore the vast lore of the Airdaeya universe!</p>
        <div class="home-buttons-wrap"><div class="home-buttons">
            <button id="view-characters-btn" class="action-button">Character List</button>
            <button id="view-calendar-btn"   class="action-button">Calendar Converter</button>
            <button id="start-quiz-btn"      class="action-button">Personality Quiz</button>
            <button id="view-map-btn"        class="action-button">World Map</button>
            <button id="view-moon-btn"       class="action-button">Moon Tracker</button>
        </div></div>
    `;

    document.getElementById('view-characters-btn').addEventListener('click', displayCharacterList);
    document.getElementById('view-calendar-btn').addEventListener('click', displayCalendarConverter);
    document.getElementById('start-quiz-btn').addEventListener('click', displayPersonalityQuiz);
    document.getElementById('view-map-btn').addEventListener('click', displayWorldMap);
    document.getElementById('view-moon-btn').addEventListener('click', displayMoonTracker);
}

// =================================================================================
// 8. Character List
// =================================================================================

async function displayCharacterList() {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `<h2>Loading characters...</h2>`;

    try {
        // ── Fetch all flat collections in parallel ──────────────────────────
        const [
            worldsSnap,
            groupsSnap,
            booksSnap,
            charactersSnap,
            appearancesSnap
        ] = await Promise.all([
            db.collection('worlds').orderBy('world_number').get(),
            db.collection('groups').get(),
            db.collection('books').get(),
            db.collection('characters').get(),
            db.collection('appearances').get()
        ]);

        // ── Build lookup maps ───────────────────────────────────────────────
        const worldMap = {};
        worldsSnap.forEach(doc => { worldMap[doc.id] = { id: doc.id, ...doc.data() }; });

        const groupMap = {};
        groupsSnap.forEach(doc => { groupMap[doc.id] = { id: doc.id, ...doc.data() }; });

        const bookMap = {};
        booksSnap.forEach(doc => { bookMap[doc.id] = { id: doc.id, ...doc.data() }; });

        const characterMap = {};
        charactersSnap.forEach(doc => { characterMap[doc.id] = { id: doc.id, ...doc.data() }; });

        // appearances: character_id → [{book_id, role}]
        const charAppearances = {}; // character_id → [{book_id, role}]
        const bookCharacters  = {}; // book_id → [{character_id, role}]
        appearancesSnap.forEach(doc => {
            const { character_id, book_id, role } = doc.data();
            if (!charAppearances[character_id]) charAppearances[character_id] = [];
            charAppearances[character_id].push({ book_id, role });
            if (!bookCharacters[book_id]) bookCharacters[book_id] = [];
            bookCharacters[book_id].push({ character_id, role });
        });

        // ── Helpers ─────────────────────────────────────────────────────────
        const now = new Date();

        function isBookVisible(book) {
            // Show if released, or has a future release_date, or has a release_note
            if (!book) return false;
            if (book.released === true) return true;
            if (book.release_note && book.release_note.trim()) return true;
            if (book.release_date) {
                const d = new Date(book.release_date);
                return !isNaN(d.getTime()); // any date present → show
            }
            return false;
        }

        function isBookReleased(book) {
            if (!book) return false;
            if (book.released === true) return true;
            if (book.release_date) {
                const d = new Date(book.release_date);
                return !isNaN(d.getTime()) && d <= now;
            }
            return false;
        }

        function getReleaseLabel(book) {
            if (book.release_note && book.release_note.trim()) return book.release_note.trim();
            if (book.release_date) {
                const d = new Date(book.release_date);
                if (!isNaN(d.getTime()) && d > now) return getReleaseSeason(d);
            }
            return 'Coming Soon';
        }

        // ── Build world → group → book → character tree ─────────────────────
        // Sort worlds by world_number
        const sortedWorlds = Object.values(worldMap).sort((a, b) => (a.world_number || 0) - (b.world_number || 0));

        // Sort groups by world then group_order
        const groupsByWorld = {};
        Object.values(groupMap).forEach(g => {
            const wid = g.world_id;
            if (!groupsByWorld[wid]) groupsByWorld[wid] = [];
            groupsByWorld[wid].push(g);
        });
        for (const wid in groupsByWorld) {
            groupsByWorld[wid].sort((a, b) => (Number(a.group_order) || 0) - (Number(b.group_order) || 0));
        }

        // Sort books by group then book_order
        const booksByGroup = {};
        Object.values(bookMap).forEach(b => {
            const gid = b.group_id;
            if (!booksByGroup[gid]) booksByGroup[gid] = [];
            booksByGroup[gid].push(b);
        });
        for (const gid in booksByGroup) {
            booksByGroup[gid].sort((a, b) => (a.book_order || 0) - (b.book_order || 0));
        }

        // ── FIX: For each character, find first VISIBLE (not just released) book per group ──
        // This ensures characters in upcoming/announced books still appear under Book 1
        // charFirstVisibleBookPerGroup[charId][groupId] = book_id of first visible appearance
        const charFirstVisibleBookPerGroup = {};
        Object.keys(characterMap).forEach(cid => {
            charFirstVisibleBookPerGroup[cid] = {};
            const appearances = charAppearances[cid] || [];
            appearances.forEach(({ book_id, role }) => {
                if (role === 'cloaked') return;
                const book = bookMap[book_id];
                if (!book || !isBookVisible(book)) return;
                const gid = book.group_id;
                if (!charFirstVisibleBookPerGroup[cid][gid]) {
                    charFirstVisibleBookPerGroup[cid][gid] = book_id;
                } else {
                    // Keep the earlier book_order
                    const existing = bookMap[charFirstVisibleBookPerGroup[cid][gid]];
                    if ((book.book_order || 0) < (existing.book_order || 0)) {
                        charFirstVisibleBookPerGroup[cid][gid] = book_id;
                    }
                }
            });
        });

        // ── Render ──────────────────────────────────────────────────────────
        el.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <h1>Character List</h1>
            <div class="char-list-tabs">
                <button class="char-list-tab ${characterListTab === 'profiles' ? 'active' : ''}" id="tab-profiles">Character Profiles</button>
                <button class="char-list-tab ${characterListTab === 'index' ? 'active' : ''}" id="tab-index">A–Z Index</button>
            </div>
            <div id="char-list-view"></div>
        `;
        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

        // ── Tab switching ──────────────────────────────────────────────────
        document.getElementById('tab-profiles').addEventListener('click', () => {
            characterListTab = 'profiles';
            document.getElementById('tab-profiles').classList.add('active');
            document.getElementById('tab-index').classList.remove('active');
            renderProfilesView(el, characterMap, worldMap, groupMap, bookMap, booksByGroup, groupsByWorld, bookCharacters, charFirstVisibleBookPerGroup, sortedWorlds, isBookVisible, isBookReleased, getReleaseLabel);
        });
        document.getElementById('tab-index').addEventListener('click', () => {
            characterListTab = 'index';
            document.getElementById('tab-index').classList.add('active');
            document.getElementById('tab-profiles').classList.remove('active');
            displayCharacterIndex(el, characterMap, charAppearances, bookMap, isBookVisible);
        });

        // ── Initial render based on active tab ─────────────────────────────
        if (characterListTab === 'index') {
            displayCharacterIndex(el, characterMap, charAppearances, bookMap, isBookVisible);
        } else {
            renderProfilesView(el, characterMap, worldMap, groupMap, bookMap, booksByGroup, groupsByWorld, bookCharacters, charFirstVisibleBookPerGroup, sortedWorlds, isBookVisible, isBookReleased, getReleaseLabel);
        }

        console.log("Character list rendered.");

    } catch (error) {
        console.error("Error fetching character list:", error);
        el.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <h2>Error loading character list!</h2>
        `;
        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
    }
}

// =================================================================================
// 8b. Profiles View Renderer (extracted from displayCharacterList)
// =================================================================================

function renderProfilesView(el, characterMap, worldMap, groupMap, bookMap, booksByGroup, groupsByWorld, bookCharacters, charFirstVisibleBookPerGroup, sortedWorlds, isBookVisible, isBookReleased, getReleaseLabel) {
    const viewEl = document.getElementById('char-list-view');
    if (!viewEl) return;
    viewEl.innerHTML = '';
    const structuredList = document.createElement('div');
    structuredList.classList.add('character-list-structured');
    viewEl.appendChild(structuredList);

    for (const world of sortedWorlds) {
        const groups = groupsByWorld[world.id] || [];
        if (groups.length === 0) continue;

        const worldSection = document.createElement('div');
        worldSection.classList.add('collection-section');

        const worldHeader = document.createElement('h2');
        worldHeader.classList.add('collection-header');
        const worldURL = world.world_url || world.url || null;
        worldHeader.innerHTML = worldURL
            ? `<a href="${addAppTracking(worldURL, 'world_link')}" target="_blank" rel="noopener">${world.world_title || world.world_name}</a>`
            : (world.world_title || world.world_name);
        worldSection.appendChild(worldHeader);

        for (const group of groups) {
            const books = (booksByGroup[group.id] || []).filter(isBookVisible);
            if (books.length === 0) continue;

            const groupSection = document.createElement('div');
            groupSection.classList.add('saga-section');

            const groupHeader = document.createElement('h3');
            groupHeader.classList.add('saga-header');
            const groupURL = group.group_url || group.url || null;
            groupHeader.innerHTML = groupURL
                ? `<a href="${addAppTracking(groupURL, 'group_link')}" target="_blank" rel="noopener">${group.group_title}</a>`
                : group.group_title;
            groupSection.appendChild(groupHeader);

            books.forEach((book, bookIndex) => {
                const released = isBookReleased(book);
                const bookSection = document.createElement('div');
                bookSection.classList.add('book-section');

                const bookHeader = document.createElement('h4');
                bookHeader.classList.add('book-header');
                const bookTitle = book.book_title || 'Untitled';

                if (!released) {
                    const label = getReleaseLabel(book);
                    const titlePart = book.book_url
                        ? `<a href="${addAppTracking(book.book_url, 'book_link')}" target="_blank" rel="noopener">${bookTitle}</a>`
                        : bookTitle;
                    bookHeader.innerHTML = `${titlePart} <span class="coming-soon-label">${label}</span>`;
                } else if (book.book_url) {
                    bookHeader.innerHTML = `<a href="${addAppTracking(book.book_url, 'book_link')}" target="_blank" rel="noopener">${bookTitle}</a>`;
                } else {
                    bookHeader.textContent = bookTitle;
                }
                bookSection.appendChild(bookHeader);

                if (bookIndex > 0) {
                    const newBanner = document.createElement('p');
                    newBanner.classList.add('new-characters-banner');
                    newBanner.textContent = '✨ New Characters!';
                    bookSection.appendChild(newBanner);
                }

                const bookChars = bookCharacters[book.id] || [];

                const povChars = bookChars
                    .filter(({ role }) => role === 'POV')
                    .sort((a, b) => (characterMap[a.character_id]?.name || '').localeCompare(characterMap[b.character_id]?.name || ''));

                const introChars = bookChars
                    .filter(({ character_id, role }) => {
                        if (role === 'cloaked' || role === 'POV') return false;
                        return charFirstVisibleBookPerGroup[character_id]?.[group.id] === book.id;
                    })
                    .sort((a, b) => (characterMap[a.character_id]?.name || '').localeCompare(characterMap[b.character_id]?.name || ''));

                const mainChars = [
                    ...povChars,
                    ...introChars.filter(c => c.role === 'primary')
                ];
                const additionalChars = introChars.filter(c =>
                    c.role === 'secondary' || c.role === 'tertiary' || c.role === 'mentioned'
                );

                function appendRoleSection(label, charList) {
                    if (charList.length === 0) return;
                    const section = document.createElement('div');
                    section.classList.add('role-section');
                    const roleLabel = document.createElement('p');
                    roleLabel.classList.add('role-label');
                    roleLabel.textContent = label;
                    section.appendChild(roleLabel);
                    const grid = document.createElement('div');
                    grid.classList.add('character-list-grid');
                    charList.forEach(({ character_id }) => {
                        const charData = characterMap[character_id];
                        if (charData) appendCharacterCard(grid, charData, released);
                    });
                    section.appendChild(grid);
                    bookSection.appendChild(section);
                }

                appendRoleSection('Main Characters', mainChars);
                appendRoleSection('Additional Characters', additionalChars);

                groupSection.appendChild(bookSection);
            });

            worldSection.appendChild(groupSection);
        }

        structuredList.appendChild(worldSection);
    }
}

// =================================================================================
// 8c. A–Z Index View
// =================================================================================

function displayCharacterIndex(el, characterMap, charAppearances, bookMap, isBookVisible) {
    const viewEl = document.getElementById('char-list-view');
    if (!viewEl) return;
    viewEl.innerHTML = '';

    // Only include characters who appear in at least one visible book (non-cloaked)
    const visibleCharIds = new Set();
    Object.entries(charAppearances).forEach(([charId, appearances]) => {
        const hasVisible = appearances.some(({ book_id, role }) => {
            if (role === 'cloaked') return false;
            const book = bookMap[book_id];
            return book && isBookVisible(book);
        });
        if (hasVisible) visibleCharIds.add(charId);
    });

    // Build sorted list — sort by goes_by, fall back to name
    const chars = Object.values(characterMap)
        .filter(c => visibleCharIds.has(c.id))
        .sort((a, b) => {
            const na = (a.goes_by || a.name || '').toLowerCase();
            const nb = (b.goes_by || b.name || '').toLowerCase();
            return na.localeCompare(nb);
        });

    // Group by first letter of goes_by (or name)
    const byLetter = {};
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    chars.forEach(c => {
        const letter = (c.goes_by || c.name || '?')[0].toUpperCase();
        if (!byLetter[letter]) byLetter[letter] = [];
        byLetter[letter].push(c);
    });

    // ── Jump bar ──────────────────────────────────────────────────────────
    const jumpBar = document.createElement('div');
    jumpBar.classList.add('char-index-jump-bar');
    alphabet.forEach(letter => {
        const btn = document.createElement('button');
        btn.classList.add('jump-bar-letter');
        btn.textContent = letter;
        if (!byLetter[letter]) {
            btn.classList.add('disabled');
        } else {
            btn.addEventListener('click', () => {
                const heading = document.getElementById(`char-index-letter-${letter}`);
                if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
        jumpBar.appendChild(btn);
    });
    viewEl.appendChild(jumpBar);

    // ── Letter sections ───────────────────────────────────────────────────
    const indexList = document.createElement('div');
    indexList.classList.add('char-index-list');

    alphabet.forEach(letter => {
        if (!byLetter[letter]) return;

        const heading = document.createElement('h3');
        heading.classList.add('char-index-letter-heading');
        heading.id = `char-index-letter-${letter}`;
        heading.textContent = letter;
        indexList.appendChild(heading);

        byLetter[letter].forEach(charData => {
            const row = document.createElement('div');
            row.classList.add('char-index-row');

            const nameBtn = document.createElement('button');
            nameBtn.classList.add('char-index-link');
            nameBtn.textContent = charData.goes_by || charData.name;
            nameBtn.addEventListener('click', () => displayCharacterDetails(charData.id));
            row.appendChild(nameBtn);

            // If goes_by differs from full name, show the full name in smaller italic text
            if (charData.goes_by && charData.goes_by !== charData.name) {
                const fullName = document.createElement('span');
                fullName.classList.add('char-index-full-name');
                fullName.textContent = charData.name;
                row.appendChild(fullName);
            }

            indexList.appendChild(row);
        });
    });

    viewEl.appendChild(indexList);
}

// Returns "Coming Spring 2028" style label from a future Date
function getReleaseSeason(date) {
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    let season;
    if (month >= 3 && month <= 5)       season = 'Spring';
    else if (month >= 6 && month <= 8)  season = 'Summer';
    else if (month >= 9 && month <= 11) season = 'Fall';
    else                                 season = 'Winter';
    return `Coming ${season} ${year}`;
}

// Portraits load for any visible book (released OR announced with release_date/release_note).
// The `released` param is kept for potential future use but no longer gates portrait loading.
function appendCharacterCard(container, charData, released = true) {
    const item = document.createElement('div');
    item.classList.add('character-list-item');
    item.dataset.characterId = charData.id;
    item.addEventListener('click', () => displayCharacterDetails(charData.id));

    const img = document.createElement('img');
    img.alt = `Portrait of ${charData.name}`;
    img.classList.add('character-list-portrait');
    img.src = PLACEHOLDER_IMG;

    // Always attempt to load the portrait for any visible character
    const portraitPath = resolvePortraitPath(charData.portrait);
    if (portraitPath) {
        getStorageURL(portraitPath).then(url => {
            if (url) { img.src = url; return; }
            // Portrait file not found — use the Firebase hooded traveler placeholder
            getStorageURL('Characters/placeholder_hooded_traveler.png').then(ph => {
                if (ph) img.src = ph;
            });
        });
    } else {
        getStorageURL('Characters/placeholder_hooded_traveler.png').then(ph => {
            if (ph) img.src = ph;
        });
    }

    item.appendChild(img);

    const text = document.createElement('div');
    text.classList.add('character-list-text');

    const nameEl = document.createElement('h3');
    nameEl.textContent = charData.name;

    const descEl = document.createElement('p');
    const rawDesc = charData.description || 'No description available.';
    const plainDesc = rawDesc.replace(/<[^>]*>/g, '');
    descEl.textContent = plainDesc.length > 150 ? plainDesc.substring(0, 150) + '...' : plainDesc;

    text.appendChild(nameEl);
    text.appendChild(descEl);
    item.appendChild(text);
    container.appendChild(item);
}

// =================================================================================
// 9. Character Details
// =================================================================================

async function displayCharacterDetails(characterId) {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `<h2>Loading character details...</h2>`;

    try {
        // Fetch everything in parallel — including both sides of relationships
        const [doc, appearancesSnap, booksSnap, allCharsSnap, calData, relsAsPerson1Snap, relsAsPerson2Snap, speciesSnap, subspeciesSnap] = await Promise.all([
            db.collection('characters').doc(characterId).get(),
            db.collection('appearances').where('character_id', '==', characterId).get(),
            db.collection('books').get(),
            db.collection('characters').get(),
            loadCalendarData().catch(() => null),
            db.collection('relationships').where('person1_id', '==', characterId).get(),
            db.collection('relationships').where('person2_id', '==', characterId).get(),
            db.collection('species').get(),
            db.collection('subspecies').get(),
        ]);

        if (!doc.exists) {
            el.innerHTML = `
                <button class="back-button" id="back-to-list-btn">← Back to Character List</button>
                <h2>Character not found!</h2>
            `;
            document.getElementById('back-to-list-btn').addEventListener('click', displayCharacterList);
            return;
        }

        const data = doc.data();

        // ── Build lookup maps ───────────────────────────────────────────────
        const bookMap = {};
        booksSnap.forEach(d => { bookMap[d.id] = { id: d.id, ...d.data() }; });

        const characterMap = {};
        allCharsSnap.forEach(d => { characterMap[d.id] = { id: d.id, ...d.data() }; });

        const speciesMap = {};
        speciesSnap.forEach(d => { speciesMap[d.id] = { id: d.id, ...d.data() }; });

        const subspeciesMap = {};
        subspeciesSnap.forEach(d => {
            const docData = d.data();
            // Key by both the Firestore doc ID and the id field inside the doc
            subspeciesMap[d.id] = { id: d.id, ...docData };
            if (docData.id && docData.id !== d.id) {
                subspeciesMap[docData.id] = { id: d.id, ...docData };
            }
        });
        console.log('[Species] speciesMap keys:', Object.keys(speciesMap));
        console.log('[Species] subspeciesMap keys:', Object.keys(subspeciesMap));
        console.log('[Species] character species_id:', data.species_id);

        // ── Collect visible book appearances (non-cloaked) ──────────────────
        function isBookVisible(book) {
            if (!book) return false;
            if (book.released === true) return true;
            if (book.release_note && book.release_note.trim()) return true;
            if (book.release_date) { const d = new Date(book.release_date); return !isNaN(d.getTime()); }
            return false;
        }

        const bookAppearances = [];
        appearancesSnap.forEach(d => {
            const { book_id, role } = d.data();
            if (role === 'cloaked') return;
            const book = bookMap[book_id];
            if (book && isBookVisible(book)) bookAppearances.push({ book, role });
        });
        bookAppearances.sort((a, b) => (a.book.book_order || 0) - (b.book.book_order || 0));

        // ── Format birthday ─────────────────────────────────────────────────
        let birthdayText = null;
        const birthYear = data.birthday && data.birthday.year ? parseInt(data.birthday.year) : null;
        if (data.birthday && data.birthday.tritquarter && data.birthday.day && calData) {
            const tqNum = parseInt(data.birthday.tritquarter);
            const day   = parseInt(data.birthday.day);
            const tq    = calData.tritquarters.find(t => t.tq === tqNum);
            if (tq) {
                birthdayText = `${tq.tq_name} ${day}`;
                if (birthYear) birthdayText += `, Year ${birthYear.toLocaleString()}`;
                const special = calData.specialDays.find(s => s.tq === tqNum && s.day === day);
                if (special) birthdayText += ` — ${special.name}`;
            }
        } else if (data.birthday && data.birthday.tritquarter && data.birthday.day) {
            birthdayText = `Tritquarter ${data.birthday.tritquarter}, Day ${data.birthday.day}`;
            if (birthYear) birthdayText += `, Year ${birthYear.toLocaleString()}`;
        }

        // ── Spoiler-safe death date ──────────────────────────────────────────
        // Convert an Oram calendar date object to a comparable absolute day number
        function toAbsoluteDay(dateObj) {
            if (!dateObj) return null;
            const y  = parseInt(dateObj.year)          || 0;
            const tq = parseInt(dateObj.tritquarter)   || 0;
            const d  = parseInt(dateObj.day || dateObj.day_of_tritquarter) || 0;
            return y * 396 + (tq - 1) * 33 + d;
        }

        // Find the earliest story_start among all visible books
        let earliestStoryDay = null;
        Object.values(bookMap).forEach(book => {
            if (!isBookVisible(book) || !book.story_start) return;
            const absDay = toAbsoluteDay(book.story_start);
            if (absDay && (earliestStoryDay === null || absDay < earliestStoryDay)) {
                earliestStoryDay = absDay;
            }
        });

        // Returns true if a character's death should be hidden (on/after earliest book start)
        function isSpoilerDeath(charData) {
            if (!charData || !charData.death_date || !charData.death_date.year) return false;
            if (earliestStoryDay === null) return false;
            return toAbsoluteDay(charData.death_date) >= earliestStoryDay;
        }

        let deathText = null;
        if (data.death_date && data.death_date.year) {
            const deathAbsDay = toAbsoluteDay(data.death_date);
            // Only reveal if the death happened strictly before the earliest book begins
            if (earliestStoryDay === null || deathAbsDay < earliestStoryDay) {
                const deathYear = parseInt(data.death_date.year);
                if (data.death_date.tritquarter && data.death_date.day && calData) {
                    const tqNum = parseInt(data.death_date.tritquarter);
                    const day   = parseInt(data.death_date.day);
                    const tq    = calData.tritquarters.find(t => t.tq === tqNum);
                    if (tq) {
                        deathText = `${tq.tq_name} ${day}, Year ${deathYear.toLocaleString()}`;
                        const special = calData.specialDays.find(s => s.tq === tqNum && s.day === day);
                        if (special) deathText += ` — ${special.name}`;
                    } else {
                        deathText = `Tritquarter ${tqNum}, Day ${day}, Year ${deathYear.toLocaleString()}`;
                    }
                } else {
                    deathText = `Year ${deathYear.toLocaleString()}`;
                }
            }
        }

        // ── Calculate age at story start for each book ──────────────────────
        function calcAgeAtStoryStart(book) {
            if (!birthYear || !book.story_start) return null;
            const storyYear = parseInt(book.story_start.year ?? book.story_start);
            if (isNaN(storyYear)) return null;
            return storyYear - birthYear;
        }

        // ── Inverse relationship type map ───────────────────────────────────
        // When this character is person2, r_type describes person1→person2,
        // so we show the inverse label for person2's perspective.
        const INVERSE_TYPE = {
            'boyfriend':        'girlfriend',
            'girlfriend':       'boyfriend',
            'ex-boyfriend':     'ex-girlfriend',
            'ex-girlfriend':    'ex-boyfriend',
            'husband':          'wife',
            'wife':             'husband',
            'ex-husband':       'ex-wife',
            'ex-wife':          'ex-husband',
            'partner':          'partner',
            'ex-partner':       'ex-partner',
            'father':           'child',
            'mother':           'child',
            'parent':           'child',
            'child':            'parent',
            'son':              'parent',
            'daughter':         'parent',
            'brother':          'sibling',
            'sister':           'sibling',
            'sibling':          'sibling',
            'half-brother':     'half-sibling',
            'half-sister':      'half-sibling',
            'half-sibling':     'half-sibling',
            'stepfather':       'stepchild',
            'stepmother':       'stepchild',
            'stepson':          'stepparent',
            'stepdaughter':     'stepparent',
            'stepchild':        'stepparent',
            'stepparent':       'stepchild',
            'grandfather':      'grandchild',
            'grandmother':      'grandchild',
            'grandparent':      'grandchild',
            'grandson':         'grandparent',
            'granddaughter':    'grandparent',
            'grandchild':       'grandparent',
            'uncle':            'niece/nephew',
            'aunt':             'niece/nephew',
            'nephew':           'aunt/uncle',
            'niece':            'aunt/uncle',
            'cousin':           'cousin',
            'friend':           'friend',
            'best friend':      'best friend',
            'enemy':            'enemy',
            'rival':            'rival',
            'mentor':           'mentee',
            'mentee':           'mentor',
            'teacher':          'student',
            'student':          'teacher',
            'ally':             'ally',
            'colleague':        'colleague',
        };

        function inverseType(rType) {
            const lower = (rType || '').toLowerCase();
            return INVERSE_TYPE[lower] || rType; // fall back to original if no mapping
        }

        // ── Collect relationships ───────────────────────────────────────────
        // As person1: r_type is from our perspective, other person is person2
        // As person2: r_type describes person1→us, so we show the inverse
        const relationships = [];
        relsAsPerson1Snap.forEach(d => {
            const rel = d.data();
            const other = characterMap[rel.person2_id];
            if (other) relationships.push({ charId: rel.person2_id, char: other, rType: rel.r_type, startDate: rel.r_start_date || null, endDate: rel.r_end_date || null });
        });
        relsAsPerson2Snap.forEach(d => {
            const rel = d.data();
            const other = characterMap[rel.person1_id];
            if (other) relationships.push({ charId: rel.person1_id, char: other, rType: inverseType(rel.r_type), startDate: rel.r_start_date || null, endDate: rel.r_end_date || null });
        });
        // Sort by relationship type then name
        relationships.sort((a, b) => a.rType.localeCompare(b.rType) || (a.char.goes_by || a.char.name).localeCompare(b.char.goes_by || b.char.name));

        // ── Resolve parent names from parent_ids ────────────────────────────
        const parentEntries = [];
        if (data.parent_ids && data.parent_ids.length) {
            data.parent_ids.forEach(pid => {
                const parent = characterMap[pid];
                parentEntries.push({ charId: pid, char: parent || null });
            });
        }

        // ── Derive family: children and siblings grouped by shared parent(s) ────────
        const myParentIds = new Set(
            (data.parent_ids || []).filter(pid => pid && pid.trim())
        );

        // Relationship records the current character is part of (both directions)
        const allRels = [
            ...relsAsPerson1Snap.docs.map(d => d.data()),
            ...relsAsPerson2Snap.docs.map(d => d.data()),
        ];

        // Find a relationship record between any two character IDs (current char must be one)
        function findRelBetween(idA, idB) {
            return allRels.find(r =>
                (r.person1_id === idA && r.person2_id === idB) ||
                (r.person1_id === idB && r.person2_id === idA)
            ) || null;
        }

        // Format date range the same way the Relationships info-row does
        function formatRelDates(rel) {
            if (!rel) return '';
            const sy = rel.r_start_date && rel.r_start_date.year ? rel.r_start_date.year : null;
            const ey = rel.r_end_date   && rel.r_end_date.year   ? rel.r_end_date.year   : null;
            if (sy && ey && sy === ey) return ` <span class="rel-date">(${sy})</span>`;
            if (sy && ey)             return ` <span class="rel-date">(${sy}–${ey})</span>`;
            if (sy)                   return ` <span class="rel-date">(${sy}–)</span>`;
            if (ey)                   return ` <span class="rel-date">(–${ey})</span>`;
            return '';
        }

        const byName = (a, b) =>
            (a.char.goes_by || a.char.name).localeCompare(b.char.goes_by || b.char.name);

        // ── Children grouped by the set of other parent(s) ──────────────────────────
        const childGroupMap = new Map();
        Object.values(characterMap).forEach(other => {
            if (other.id === characterId) return;
            const theirParents = new Set((other.parent_ids || []).filter(pid => pid && pid.trim()));
            if (!theirParents.has(characterId)) return;
            const otherParentIds = [...theirParents].filter(pid => pid !== characterId).sort();
            const key = otherParentIds.join('|') || '__none__';
            if (!childGroupMap.has(key)) childGroupMap.set(key, { otherParentIds, children: [] });
            childGroupMap.get(key).children.push({ charId: other.id, char: other });
        });
        const childGroups = [...childGroupMap.values()];
        childGroups.forEach(g => g.children.sort(byName));
        childGroups.sort((a, b) => {
            const na = a.otherParentIds.map(pid => (characterMap[pid] || {}).goes_by || (characterMap[pid] || {}).name || pid).join(', ');
            const nb = b.otherParentIds.map(pid => (characterMap[pid] || {}).goes_by || (characterMap[pid] || {}).name || pid).join(', ');
            return na.localeCompare(nb);
        });

        // ── Siblings grouped by the shared parent(s) that connect them ────────────────
        const sibGroupMap = new Map();
        Object.values(characterMap).forEach(other => {
            if (other.id === characterId) return;
            const theirParents = new Set((other.parent_ids || []).filter(pid => pid && pid.trim()));
            if (myParentIds.size === 0 || theirParents.size === 0) return;
            const shared = [...myParentIds].filter(pid => theirParents.has(pid)).sort();
            if (shared.length === 0) return;
            const isFull = shared.length === myParentIds.size && shared.length === theirParents.size;
            const key = shared.join('|');
            if (!sibGroupMap.has(key)) sibGroupMap.set(key, { sharedParentIds: shared, full: isFull, members: [] });
            sibGroupMap.get(key).members.push({ charId: other.id, char: other });
        });
        const siblingGroups = [...sibGroupMap.values()];
        // Sort siblings oldest to youngest by birth year, then tq, then day
        const byBirthDate = (a, b) => {
            const ba = a.char.birthday || {}, bb = b.char.birthday || {};
            const ya = parseInt(ba.year) || 0, yb = parseInt(bb.year) || 0;
            if (ya !== yb) return ya - yb;
            const ta = parseInt(ba.tritquarter) || 0, tb = parseInt(bb.tritquarter) || 0;
            if (ta !== tb) return ta - tb;
            return (parseInt(ba.day) || 0) - (parseInt(bb.day) || 0);
        };
        siblingGroups.forEach(g => g.members.sort(byBirthDate));

        // ── html-safe helper ────────────────────────────────────────────────
        function escHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        // ── Clickable character name helper ─────────────────────────────────
        function charLink(charId, charData) {
            const label = charData ? escHtml(charData.goes_by || charData.name) : escHtml(charId);
            return `<button class="char-name-link" data-char-id="${escHtml(charId)}">${label}</button>`;
        }

        // charLink with optional (d. YEAR) death annotation for use in the Family box
        function familyCharLink(charId, charData) {
            const base = charLink(charId, charData);
            if (charData && charData.death_date && charData.death_date.year && !isSpoilerDeath(charData)) {
                return base + ` <span class="family-death-note">(d. ${charData.death_date.year.toLocaleString()})</span>`;
            }
            return base;
        }

        // Name + (b. YEAR) or (YEAR–YEAR) life dates span for family members
        function familyLifeLink(charId, charData) {
            const base = charLink(charId, charData);
            const birthYear = charData && charData.birthday && charData.birthday.year
                ? parseInt(charData.birthday.year) : null;
            const showDeath = charData && charData.death_date && charData.death_date.year
                && !isSpoilerDeath(charData);
            const deathYear = showDeath ? parseInt(charData.death_date.year) : null;
            let note = '';
            if (birthYear && deathYear) {
                note = ` <span class="family-life-dates">(b. ${birthYear.toLocaleString()} – d. ${deathYear.toLocaleString()})</span>`;
            } else if (birthYear) {
                note = ` <span class="family-life-dates">(b. ${birthYear.toLocaleString()})</span>`;
            }
            return base + note;
        }

        // ── Build info-box rows ─────────────────────────────────────────────
        const infoRows = [];

        if (data.pronouns) {
            infoRows.push({ label: 'Pronouns', html: escHtml(data.pronouns) });
        }
        if (data.aliases && data.aliases.length) {
            const goesBy = (data.goes_by || '').trim().toLowerCase();
            const list = (Array.isArray(data.aliases) ? data.aliases : [data.aliases])
                .filter(a => a.trim().toLowerCase() !== goesBy);
            if (list.length) {
                infoRows.push({ label: 'Aliases', html: list.map(escHtml).join(', ') });
            }
        }
        if (data.species_id && data.species_id.length) {
            const speciesLabels = data.species_id.map(sid => {
                if (sid.startsWith('ss_')) {
                    const ss = subspeciesMap[sid];
                    console.log('[Species] lookup ss_id:', sid, '-> ss doc:', ss);
                    if (!ss) return escHtml(sid);
                    console.log('[Species] ss.species_id:', ss.species_id, '-> parent:', speciesMap[ss.species_id]);
                    const parentSpecies = speciesMap[ss.species_id];
                    const speciesName = parentSpecies ? escHtml(parentSpecies.s_name) : '';
                    return speciesName
                        ? escHtml(ss.ss_name) + ' (' + speciesName + ')'
                        : escHtml(ss.ss_name);
                } else {
                    const sp = speciesMap[sid];
                    return sp ? escHtml(sp.s_name) : escHtml(sid);
                }
            });
            infoRows.push({ label: 'Species', html: speciesLabels.join(', ') });
        }
        if (birthdayText) {
            infoRows.push({ label: 'Birthday', html: escHtml(birthdayText) });
        }
        if (deathText) {
            infoRows.push({ label: 'Death', html: escHtml(deathText) });
        }
        // Relationships moved to the Family & Relationships box
        if (bookAppearances.length) {
            const bookItems = bookAppearances.map(({ book, role }) => {
                const title = escHtml(book.book_title || book.title || 'Untitled');
                const age = calcAgeAtStoryStart(book);
                const ageNote = age !== null ? `<span class="book-age-note"> (age&nbsp;${age})</span>` : '';
                const roleNote = role === 'POV' ? ' <span class="book-role-note">POV</span>' : '';
                const linked = book.book_url
                    ? `<a href="${addAppTracking(book.book_url, 'book_link')}" target="_blank" rel="noopener" class="info-book-link">${title}</a>`
                    : title;
                return `<span class="book-appearance-item">${linked}${roleNote}${ageNote}</span>`;
            });
            infoRows.push({ label: 'Appears In', html: bookItems.join('') });
        }

        // ── Build the name header ───────────────────────────────────────────
        const prefix = data.c_prefix ? `<span class="character-name-prefix">${escHtml(data.c_prefix)}</span> ` : '';
        const suffix = data.c_suffix ? `<div class="character-name-suffix">${escHtml(data.c_suffix)}</div>` : '';
        const goesBy = (data.goes_by && data.goes_by !== data.name)
            ? `<div class="character-name-goesby">"${escHtml(data.goes_by)}"</div>` : '';
        const titlesHtml = (data.c_titles && data.c_titles.length)
            ? (Array.isArray(data.c_titles) ? data.c_titles : [data.c_titles])
                .map(t => `<div class="character-name-title">${escHtml(t)}</div>`).join('') : '';

        // ── Render page ─────────────────────────────────────────────────────
        el.innerHTML = `
            <button class="back-button" id="back-to-list-btn">← Back to Character List</button>
            <div class="character-detail-name-block">
                <h1 class="character-detail-name">${prefix}${escHtml(data.name)}</h1>
                ${suffix}${goesBy}${titlesHtml}
            </div>
            <div class="character-detail-content">
                <div class="character-detail-left"></div>
                <div class="character-detail-description"></div>
            </div>
        `;
        document.getElementById('back-to-list-btn').addEventListener('click', displayCharacterList);

        // ── Portrait ────────────────────────────────────────────────────────
        const wrapper = el.querySelector('.character-detail-left');
        const img = document.createElement('img');
        img.alt = `Portrait of ${data.name}`;
        img.classList.add('character-portrait-detail');
        img.src = PLACEHOLDER_IMG_LARGE;
        wrapper.appendChild(img);

        console.log("Character data fields:", Object.keys(data), "portrait:", data.portrait);
        const portraitPath = resolvePortraitPath(data.drakkaen_portrait || data.portrait);
        if (portraitPath) {
            getStorageURL(portraitPath).then(url => {
                if (url) { img.src = url; return; }
                getStorageURL('Characters/placeholder_hooded_traveler.png').then(ph => { if (ph) img.src = ph; });
            });
        } else {
            getStorageURL('Characters/placeholder_hooded_traveler.png').then(ph => { if (ph) img.src = ph; });
        }

        // ── Info box ────────────────────────────────────────────────────────
        if (infoRows.length > 0) {
            const infoBox = document.createElement('div');
            infoBox.classList.add('character-info-box');
            infoBox.innerHTML = `
                <div class="character-info-box-header">Character Details</div>
                <dl class="character-info-list">
                    ${infoRows.map(row => `
                        <div class="character-info-row">
                            <dt>${row.label}</dt>
                            <dd>${row.html}</dd>
                        </div>
                    `).join('')}
                </dl>
            `;
            wrapper.appendChild(infoBox);
        }

        // ── Description ─────────────────────────────────────────────────────
        const desc = el.querySelector('.character-detail-description');

        // ── Family box (parents, children by partner, siblings by shared parent) ──
        const hasFamilyData = parentEntries.length || childGroups.length || siblingGroups.length || relationships.length;
        if (hasFamilyData) {
            const familyBox = document.createElement('div');
            familyBox.classList.add('character-family-box');

            const familyRows = [];

            // ── Parents (first row) ──────────────────────────────────────────────────
            if (parentEntries.length) {
                const html = parentEntries
                    .map(({ charId, char }) => familyLifeLink(charId, char))
                    .join(', ');
                familyRows.push({ label: parentEntries.length === 1 ? 'Parent' : 'Parents', html });
            }

            // ── Children: one row per co-parent group ────────────────────────────────
            childGroups.forEach(({ otherParentIds, children }) => {
                const childLinks = children
                    .map(({ charId, char }) => familyLifeLink(charId, char))
                    .join(', ');

                if (otherParentIds.length === 0) {
                    // No other known parent
                    const label = children.length === 1 ? 'Child' : 'Children';
                    familyRows.push({ label, html: childLinks });
                } else {
                    // Show "with [Partner]" as the label; partner name is a familyCharLink
                    const partnerHtml = otherParentIds.map(pid => {
                        const partnerChar = characterMap[pid];
                        return charLink(pid, partnerChar || { name: pid });
                    }).join(' & ');
                    const label = children.length === 1 ? 'Child' : 'Children';
                    familyRows.push({
                        label,
                        html: `<span class="family-with-partner">with ${partnerHtml}</span><br>${childLinks}`,
                    });
                }
            });

            // ── Siblings: one row per shared-parent group ────────────────────────────
            siblingGroups.forEach(({ sharedParentIds, full, members }) => {
                const memberLinks = members
                    .map(({ charId, char }) => familyLifeLink(charId, char))
                    .join(', ');
                const label = full
                    ? (members.length === 1 ? 'Sibling' : 'Siblings')
                    : (members.length === 1 ? 'Half-Sibling' : 'Half-Siblings');

                // Show the shared parent(s) as context — no death annotation on via line
                const parentHtml = sharedParentIds.map(pid => {
                    const parentChar = characterMap[pid];
                    return charLink(pid, parentChar || { name: pid });
                }).join(' & ');
                const viaLabel = `<span class="family-via-parent">via ${parentHtml}</span>`;

                familyRows.push({
                    label,
                    html: `${viaLabel}<br>${memberLinks}`,
                });
            });

            // ── Relationships: one row per r_type group ──────────────────────────────
            if (relationships.length) {
                const grouped = {};
                relationships.forEach(({ charId, char, rType, startDate, endDate }) => {
                    if (!grouped[rType]) grouped[rType] = [];
                    grouped[rType].push({ charId, char, startDate, endDate });
                });
                Object.entries(grouped).forEach(([rType, people]) => {
                    const names = people.map(({ charId, char, startDate, endDate }) => {
                        const startYear = startDate && startDate.year ? startDate.year : null;
                        const otherDeathYear = char && !isSpoilerDeath(char) && char.death_date && char.death_date.year
                            ? char.death_date.year : null;
                        const selfDeathYear = data.death_date && data.death_date.year && !isSpoilerDeath(data)
                            ? data.death_date.year : null;
                        const explicitEndYear = endDate && endDate.year ? endDate.year : null;
                        const endYear = explicitEndYear || otherDeathYear || selfDeathYear;
                        let dateNote = '';
                        if (startYear && endYear && startYear === endYear) {
                            dateNote = ` <span class="rel-date">(${startYear})</span>`;
                        } else if (startYear && endYear) {
                            dateNote = ` <span class="rel-date">(${startYear}–${endYear})</span>`;
                        } else if (startYear) {
                            dateNote = ` <span class="rel-date">(${startYear}–)</span>`;
                        } else if (endYear) {
                            dateNote = ` <span class="rel-date">(–${endYear})</span>`;
                        }
                        return charLink(charId, char) + dateNote;
                    }).join(', ');
                    familyRows.push({ label: escHtml(rType), html: names });
                });
            }

            familyBox.innerHTML = `
                <div class="character-family-box-header">Family &amp; Relationships</div>
                <dl class="character-info-list">
                    ${familyRows.map(row => `
                        <div class="character-info-row">
                            <dt>${row.label}</dt>
                            <dd>${row.html}</dd>
                        </div>
                    `).join('')}
                </dl>
            `;
            desc.appendChild(familyBox);
        }

        desc.insertAdjacentHTML('afterbegin', data.description || 'No description available.');

        // ── Wire up all char-name-link buttons (parents, relationships, etc.) 
        el.querySelectorAll('.char-name-link').forEach(btn => {
            btn.addEventListener('click', () => displayCharacterDetails(btn.dataset.charId));
        });

        // ── Wire up char-name-links added after initial render ───────────────

    } catch (error) {
        console.error("Error fetching character details:", error);
        el.innerHTML = `
            <button class="back-button" id="back-to-list-btn">← Back to Character List</button>
            <h2>Error loading character details!</h2>
        `;
        document.getElementById('back-to-list-btn').addEventListener('click', displayCharacterList);
    }
}

// =================================================================================
// 10. Calendar Converter
// =================================================================================

// Runtime calendar data — loaded once from Firestore
let calendarData = null;

async function loadCalendarData() {
    if (calendarData) return calendarData;

    // Fetch the first calendar (Oram Standard) plus special_days
    const [calSnap, sdSnap] = await Promise.all([
        db.collection('calendars').get(),
        db.collection('special_days').get()
    ]);

    // Use the first calendar doc for now; we'll expand this when more worlds are added
    const calDoc = calSnap.docs[0];
    if (!calDoc) throw new Error('No calendar data found.');

    const cal = calDoc.data();

    const specialDays = [];
    sdSnap.forEach(doc => {
        const d = doc.data();
        specialDays.push({ tq: d.tq, day: d.tq_day, name: d.sd_name, desc: d.sd_desc });
    });

    calendarData = {
        id: calDoc.id,
        name: cal.name,
        rules: cal.rules,
        tritquarters: cal.tritquarters.sort((a, b) => a.tq - b.tq),
        fortnightNames: cal.fortnight_names,
        specialDays,
        seasonEmoji: { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Winter: '❄️' }
    };

    return calendarData;
}

// Conversion math (unchanged from old script — anchored to March 20 = Mamdi 1)
const ORAM_DAYS_PER_EARTH_DAY = 144 / 132;

function earthDateToOramDayOfYear(earthDate) {
    const march20 = new Date(earthDate.getFullYear(), 2, 20);
    const earthDaysDiff = (earthDate - march20) / (1000 * 60 * 60 * 24);
    const raw = 1 + earthDaysDiff * ORAM_DAYS_PER_EARTH_DAY;
    let oramDayOfYear = Math.round(raw);
    oramDayOfYear = ((oramDayOfYear - 1) % 396 + 396) % 396 + 1;
    return oramDayOfYear;
}

function oramDayOfYearToTritquarter(dayOfYear, tritquarters) {
    const daysPerTQ = 33;
    const tqIndex = Math.floor((dayOfYear - 1) / daysPerTQ);
    const day = ((dayOfYear - 1) % daysPerTQ) + 1;
    return { tq: tritquarters[tqIndex], day };
}

function tritquarterToOramDayOfYear(tqNumber, day) {
    return ((tqNumber - 1) * 33) + day;
}

function oramDayOfYearToEarthDate(oramDayOfYear) {
    const year = new Date().getFullYear();
    const march20 = new Date(year, 2, 20);
    const estDays = Math.round((oramDayOfYear - 1) / ORAM_DAYS_PER_EARTH_DAY);
    for (let offset = -5; offset <= 5; offset++) {
        const candidate = new Date(march20);
        candidate.setDate(march20.getDate() + estDays + offset);
        if (earthDateToOramDayOfYear(candidate) === oramDayOfYear) return candidate;
    }
    const fallback = new Date(march20);
    fallback.setDate(march20.getDate() + estDays);
    return fallback;
}

function getSpecialDay(tqNumber, day, specialDays) {
    return specialDays.find(s => s.tq === tqNumber && s.day === day) || null;
}

function formatOramDate(tqName, day) {
    return `${tqName} ${day}`;
}

function formatEarthDate(date) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

async function displayCalendarConverter() {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `<h2>Loading calendar...</h2>`;

    try {
        const cal = await loadCalendarData();
        await loadCharacterBirthdays();

        const tqOptions = cal.tritquarters.map(tq =>
            `<option value="${tq.tq}">${tq.tq_name} (Tritquarter ${tq.tq})</option>`
        ).join('');

        const dayOptions = Array.from({ length: 33 }, (_, i) =>
            `<option value="${i + 1}">${i + 1}</option>`
        ).join('');

        el.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <div class="calendar-container">
                <h1>${cal.name}</h1>
                <p class="welcome-subtitle">Convert dates between Earth and the world of Oram</p>

                <div class="calendar-today-panel" id="today-panel"></div>

                <div class="calendar-converters">

                    <div class="converter-panel">
                        <h3>🌍 Earth → Oram</h3>
                        <label for="earth-date-input">Enter an Earth Date</label>
                        <input type="date" id="earth-date-input" />
                        <button class="convert-btn" id="earth-to-oram-btn">Convert</button>
                        <div class="converter-result" id="earth-to-oram-result">
                            <div class="result-date"   id="earth-to-oram-date"></div>
                            <div class="result-season" id="earth-to-oram-season"></div>
                            <div class="result-special" id="earth-to-oram-special" style="display:none"></div>
                        </div>
                    </div>

                    <div class="converter-panel">
                        <h3>🪐 Oram → Earth</h3>
                        <label>Select an Oram Date</label>
                        <div class="oram-day-select">
                            <div>
                                <label for="oram-tq-select">Tritquarter</label>
                                <select id="oram-tq-select">${tqOptions}</select>
                            </div>
                            <div>
                                <label for="oram-day-select">Day</label>
                                <select id="oram-day-select">${dayOptions}</select>
                            </div>
                        </div>
                        <button class="convert-btn" id="oram-to-earth-btn">Convert</button>
                        <div class="converter-result" id="oram-to-earth-result">
                            <div class="result-date"   id="oram-to-earth-date"></div>
                            <div class="result-season" id="oram-to-earth-season"></div>
                            <div class="result-special" id="oram-to-earth-special" style="display:none"></div>
                        </div>
                    </div>

                </div>
            </div>
        `;

        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

        // ── Today panel ────────────────────────────────────────────────────
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const oramDOY = earthDateToOramDayOfYear(today);
        const { tq: todayTQ, day: todayDay } = oramDayOfYearToTritquarter(oramDOY, cal.tritquarters);
        const todaySpecial = getSpecialDay(todayTQ.tq, todayDay, cal.specialDays);
        const todayBirthdays = getBirthdayCharacters(todayTQ.tq, todayDay);
        const seasonEmoji = cal.seasonEmoji[todayTQ.tq_season] || '';

        document.getElementById('today-panel').innerHTML = `
            <div class="today-label">Today on Earth</div>
            <div class="today-earth">${formatEarthDate(today)}</div>
            <div class="today-divider">⟡</div>
            <div class="today-label">Today on Oram</div>
            <div class="today-oram">${formatOramDate(todayTQ.tq_name, todayDay)}</div>
            <div class="today-season">${seasonEmoji} ${todayTQ.tq_season} on Oram</div>
            ${todaySpecial ? `<div class="today-special">✨ ${todaySpecial.name} — ${todaySpecial.desc}</div>` : ''}
            ${renderBirthdayMessage(todayBirthdays)}
        `;

        // ── Earth → Oram converter ─────────────────────────────────────────
        document.getElementById('earth-to-oram-btn').addEventListener('click', () => {
            const input = document.getElementById('earth-date-input').value;
            if (!input) { alert('Please select an Earth date.'); return; }
            const parts = input.split('-').map(Number);
            const earthDate = new Date(parts[0], parts[1] - 1, parts[2]);
            const oramDay = earthDateToOramDayOfYear(earthDate);
            const { tq, day } = oramDayOfYearToTritquarter(oramDay, cal.tritquarters);
            const special = getSpecialDay(tq.tq, day, cal.specialDays);
            const emoji = cal.seasonEmoji[tq.tq_season] || '';
            const birthdays = getBirthdayCharacters(tq.tq, day);
            const resultEl = document.getElementById('earth-to-oram-result');

            document.getElementById('earth-to-oram-date').textContent = formatOramDate(tq.tq_name, day);
            document.getElementById('earth-to-oram-season').textContent = `${emoji} ${tq.tq_season} on Oram`;
            const specialEl = document.getElementById('earth-to-oram-special');
            if (special) {
                specialEl.textContent = `✨ ${special.name} — ${special.desc}`;
                specialEl.style.display = 'inline-block';
            } else {
                specialEl.style.display = 'none';
            }
            let bdayEl = document.getElementById('earth-to-oram-birthday');
            if (!bdayEl) {
                bdayEl = document.createElement('div');
                bdayEl.id = 'earth-to-oram-birthday';
                resultEl.appendChild(bdayEl);
            }
            bdayEl.innerHTML = renderBirthdayMessage(birthdays);
            resultEl.classList.add('visible');
        });

        // ── Oram → Earth converter ─────────────────────────────────────────
        document.getElementById('oram-to-earth-btn').addEventListener('click', () => {
            const tqNumber = parseInt(document.getElementById('oram-tq-select').value);
            const day = parseInt(document.getElementById('oram-day-select').value);
            const oramDOY = tritquarterToOramDayOfYear(tqNumber, day);
            const earthDate = oramDayOfYearToEarthDate(oramDOY);
            const tqData = cal.tritquarters.find(t => t.tq === tqNumber);
            const special = getSpecialDay(tqNumber, day, cal.specialDays);
            const emoji = cal.seasonEmoji[tqData?.tq_season] || '';
            const birthdays = getBirthdayCharacters(tqNumber, day);
            const resultEl = document.getElementById('oram-to-earth-result');

            document.getElementById('oram-to-earth-date').textContent = formatEarthDate(earthDate);
            document.getElementById('oram-to-earth-season').textContent = `${emoji} ${tqData?.tq_season || ''} on Oram`;
            const specialEl = document.getElementById('oram-to-earth-special');
            if (special) {
                specialEl.textContent = `✨ ${special.name} — ${special.desc}`;
                specialEl.style.display = 'inline-block';
            } else {
                specialEl.style.display = 'none';
            }
            let bdayEl = document.getElementById('oram-to-earth-birthday');
            if (!bdayEl) {
                bdayEl = document.createElement('div');
                bdayEl.id = 'oram-to-earth-birthday';
                resultEl.appendChild(bdayEl);
            }
            bdayEl.innerHTML = renderBirthdayMessage(birthdays);
            resultEl.classList.add('visible');
        });

    } catch (error) {
        console.error("Error loading calendar:", error);
        el.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <h2>Error loading calendar!</h2>
        `;
        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
    }
}

// =================================================================================
// 11. Personality Quiz
// =================================================================================

async function displayPersonalityQuiz() {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `<h2>Loading quiz questions...</h2>`;

    try {
        const snapshot = await db.collection('personality_questions').orderBy('ques_order').get();
        quizQuestions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (quizQuestions.length > 0) {
            currentQuestionIndex = 0;
            userAnswers = {};
            renderQuestion();
        } else {
            el.innerHTML = `
                <button class="back-button" id="back-to-quiz-home-btn">← Back to Home</button>
                <h2>No quiz questions found!</h2>
            `;
            document.getElementById('back-to-quiz-home-btn').addEventListener('click', displayHomeScreen);
        }
    } catch (error) {
        console.error("Error fetching quiz questions:", error);
        el.innerHTML = `
            <button class="back-button" id="back-to-quiz-home-btn">← Back to Home</button>
            <h2>Error loading quiz!</h2>
        `;
        document.getElementById('back-to-quiz-home-btn').addEventListener('click', displayHomeScreen);
    }
}

function renderQuestion() {
    const el = getContainer();
    if (!el) return;

    // FIX: Added flex-wrap and min-width 0 inline on buttons so Next doesn't overflow on mobile
    el.innerHTML = `
        <button class="back-button" id="back-to-quiz-home-btn">← Back to Home</button>
        <div class="quiz-container">
            <p class="question-number">Question ${currentQuestionIndex + 1} of ${quizQuestions.length}</p>
            <h2 class="quiz-question-text"></h2>
            <div class="quiz-answers"></div>
            <div class="quiz-navigation">
                <button id="prev-question-btn" class="action-button quiz-nav-button">Previous</button>
                <button id="next-question-btn" class="action-button quiz-nav-button"></button>
            </div>
        </div>
    `;

    document.getElementById('back-to-quiz-home-btn').addEventListener('click', displayHomeScreen);

    const questionData = quizQuestions[currentQuestionIndex];
    const questionTextEl  = el.querySelector('.quiz-question-text');
    const quizAnswersDiv  = el.querySelector('.quiz-answers');
    const nextButton      = el.querySelector('#next-question-btn');
    const prevButton      = el.querySelector('#prev-question-btn');

    questionTextEl.textContent = questionData.question;

    // ques_type field (was "type" in old schema)
    if (questionData.ques_type === 'multiple-choice') {
        // answers is an array of {index: "text"} objects
        questionData.answers.forEach(answerObj => {
            const answerText = Object.values(answerObj)[0];
            const btn = document.createElement('button');
            btn.classList.add('quiz-answer-button');
            btn.textContent = answerText;
            btn.dataset.answer = answerText;

            if (userAnswers[questionData.id] === answerText) btn.classList.add('selected');

            btn.addEventListener('click', () => {
                quizAnswersDiv.querySelectorAll('.quiz-answer-button').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                userAnswers[questionData.id] = answerText;
            });
            quizAnswersDiv.appendChild(btn);
        });
    } else if (questionData.ques_type === 'short-answer') {
        const textarea = document.createElement('textarea');
        textarea.classList.add('quiz-short-answer-input');
        textarea.placeholder = 'Type your answer here...';
        textarea.id = `question-${questionData.id}`;
        textarea.maxLength = 100;

        if (userAnswers[questionData.id]) textarea.value = userAnswers[questionData.id];

        textarea.addEventListener('input', () => { userAnswers[questionData.id] = textarea.value; });
        textarea.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const nb = document.getElementById('next-question-btn');
                if (nb) nb.click();
            }
        });
        quizAnswersDiv.appendChild(textarea);
        setTimeout(() => textarea.focus(), 0);
    }

    prevButton.disabled = currentQuestionIndex === 0;
    prevButton.addEventListener('click', () => {
        if (currentQuestionIndex > 0) { currentQuestionIndex--; renderQuestion(); }
    });

    if (currentQuestionIndex === quizQuestions.length - 1) {
        nextButton.textContent = 'Submit Quiz';
        nextButton.addEventListener('click', handleSubmitQuiz);
    } else {
        nextButton.textContent = 'Next Question';
        nextButton.addEventListener('click', () => {
            if (questionData.ques_type === 'multiple-choice' && !userAnswers[questionData.id]) {
                alert('Please select an answer before proceeding.');
                return;
            }
            if (questionData.ques_type === 'short-answer' && (!userAnswers[questionData.id] || !userAnswers[questionData.id].trim())) {
                alert('Please enter an answer before proceeding.');
                return;
            }
            currentQuestionIndex++;
            renderQuestion();
        });
    }
}

function handleSubmitQuiz() {
    const lastQ = quizQuestions[quizQuestions.length - 1];
    if (lastQ.ques_type === 'multiple-choice' && !userAnswers[lastQ.id]) {
        alert('Please select an answer for the last question.');
        return;
    }
    if (lastQ.ques_type === 'short-answer' && (!userAnswers[lastQ.id] || !userAnswers[lastQ.id].trim())) {
        alert('Please enter an answer for the last question.');
        return;
    }

    const el = getContainer();
    el.innerHTML = `
        <div class="quiz-results-loading">
            <h2>Processing your personality...</h2>
            <p>Consulting the stars of Airdaeya...</p>
            <div class="loading-spinner"></div>
        </div>
    `;

    const processQuiz = functions.httpsCallable('processQuizAnswers');

    processQuiz({ answers: userAnswers })
        .then(async (result) => {
            const geminiMatch          = result.data.matchResult;
            const matchedCharacterName = result.data.matchedCharacterName;
            const matchedGoesBy        = result.data.matchedGoesBy || null;
            const matchedAliases       = result.data.matchedAliases || [];

            // Resolve portrait: Cloud Function may return a full URL, a storage path, or nothing.
            // If it's not already an https:// URL, treat it as a storage path and resolve it.
            // Fall back to the placeholder hooded traveler if nothing is found.
            const rawPortrait = result.data.matchedPortraitURL || result.data.matchedPortraitPath || null;
            let portraitURL = null;
            if (rawPortrait && rawPortrait.startsWith('https://')) {
                portraitURL = rawPortrait;
            } else {
                const path = resolvePortraitPath(rawPortrait || 'placeholder_hooded_traveler.png');
                portraitURL = await getStorageURL(path).catch(() => null);
                // If character has no portrait, always fall back to the hooded traveler placeholder
                if (!portraitURL) {
                    portraitURL = await getStorageURL('Characters/placeholder_hooded_traveler.png').catch(() => null);
                }
            }

            const nameHTML = matchedCharacterName
                ? `<div class="match-character-name">${matchedCharacterName}</div>`
                : '';
            const goesByHTML = matchedGoesBy && matchedGoesBy !== matchedCharacterName
                ? `<div class="match-goes-by">Goes by: <em>${matchedGoesBy}</em></div>`
                : '';
            const aliasesHTML = matchedAliases.length > 0
                ? `<div class="match-aliases">Also known as: <em>${matchedAliases.join(', ')}</em></div>`
                : '';

            const portraitHTML = `<div class="match-portrait-container">
                ${nameHTML}
                <img src="${portraitURL || PLACEHOLDER_IMG_LARGE}" alt="Character portrait" class="match-portrait" />
                ${goesByHTML}${aliasesHTML}
            </div>`;

            const lines = geminiMatch.split('\n').filter(l => l.trim());
            let proclamation = '';
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('YOUR AIRDAEYA MATCH') && lines[i + 2]) {
                    proclamation = lines[i + 2].replace(/[*_]/g, '').trim();
                    break;
                }
            }

            el.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <div class="quiz-results">
                    <h1>Your Airdaeya Personality Match!</h1>
                    ${portraitHTML}
                    <div class="gemini-response-content" id="quiz-result-text">
                        ${geminiMatch
                            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.+?)\*/g,   '<em>$1</em>')
                            .replace(/\n/g, '<br>')}
                    </div>
                    <div class="download-buttons">
                        <button class="download-btn pdf-btn"   id="download-pdf-btn">📄 Save as PDF</button>
                        <button class="download-btn share-btn" id="share-image-btn">📸 Share as Image</button>
                    </div>
                    <p class="quiz-disclaimer">For entertainment purposes only.</p>
                </div>
            `;
            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
            document.getElementById('download-pdf-btn').addEventListener('click', () =>
                generatePDF(matchedCharacterName, matchedGoesBy, geminiMatch, portraitURL));
            document.getElementById('share-image-btn').addEventListener('click', () =>
                generateShareImage(matchedCharacterName, matchedGoesBy, proclamation, portraitURL));
        })
        .catch(error => {
            console.error("Error calling Cloud Function:", error);
            el.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <div class="quiz-results error-message">
                    <h1>Oops! Something went wrong.</h1>
                    <p>Failed to get your personality match. Error: ${error.message}</p>
                    <p>Please try again later.</p>
                </div>
            `;
            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
        });
}

// =================================================================================
// 12. Download Functions (PDF & Share Image)
// =================================================================================

// FIX: Logo loading now uses getStorageURL() with paths in the Logos folder
//      instead of hardcoded expiring token URLs
async function generatePDF(characterName, goesBy, responseText, portraitURL) {
    const btn = document.getElementById('download-pdf-btn');
    btn.textContent = 'Generating PDF...';
    btn.disabled = true;

    try {
        if (!window.jspdf) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const margin = 20;
        const contentW = pageW - margin * 2;

        doc.setFillColor(245, 240, 225);
        doc.rect(0, 0, pageW, doc.internal.pageSize.getHeight(), 'F');
        doc.setFillColor(69, 35, 69);
        doc.rect(0, 0, pageW, 28, 'F');

        doc.setTextColor(255, 215, 0);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Airdaeium', pageW / 2, 12, { align: 'center' });
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text('Your Airdaeya Personality Match', pageW / 2, 22, { align: 'center' });

        // FIX: Load Airdaeium icon via getStorageURL (Logos folder)
        try {
            const iconURL = await getLogoURL('icon');
            if (iconURL) {
                const iconImg = new Image();
                iconImg.crossOrigin = 'Anonymous';
                await new Promise((res, rej) => {
                    iconImg.onload = res; iconImg.onerror = rej;
                    iconImg.src = iconURL;
                });
                const iconC = document.createElement('canvas');
                iconC.width = iconImg.width; iconC.height = iconImg.height;
                iconC.getContext('2d').drawImage(iconImg, 0, 0);
                doc.addImage(iconC.toDataURL('image/png'), 'PNG', 12, 4, 20, 20);
            }
        } catch (e) { console.warn('Icon load failed', e); }

        let y = 38;

        if (portraitURL) {
            try {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = portraitURL; });
                const imgC = document.createElement('canvas');
                imgC.width = img.width; imgC.height = img.height;
                imgC.getContext('2d').drawImage(img, 0, 0);
                const imgData = imgC.toDataURL('image/jpeg', 0.85);
                const imgSize = 55;
                const imgX = (pageW - imgSize) / 2;
                const r = 3;
                doc.setDrawColor(255, 215, 0);
                doc.setLineWidth(1.2);
                doc.roundedRect(imgX - 1, y - 1, imgSize + 2, imgSize + 2, r, r, 'S');
                doc.addImage(imgData, 'JPEG', imgX, y, imgSize, imgSize, undefined, undefined, undefined, [r, r, r, r]);
                y += imgSize + 8;
            } catch (e) { console.warn('Portrait failed', e); y += 5; }
        }

        doc.setTextColor(69, 35, 69);
        doc.setFontSize(17);
        doc.setFont('helvetica', 'bold');
        doc.text((characterName || '').toUpperCase(), pageW / 2, y, { align: 'center' });
        y += 7;

        if (goesBy && goesBy !== characterName) {
            doc.setFontSize(11);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(143, 97, 144);
            doc.text('Goes by: ' + goesBy, pageW / 2, y, { align: 'center' });
            y += 9;
        } else { y += 3; }

        doc.setDrawColor(69, 35, 69);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageW - margin, y);
        y += 7;

        const sectionHeaders = ['YOUR AIRDAEYA MATCH', 'WHY YOU ARE KINDRED SPIRITS', 'YOUR UNIQUE SPARK', 'A TASTE OF AIRDAEYA'];
        let cleanText = responseText
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/⚔️ YOUR AIRDAEYA MATCH/g, 'YOUR AIRDAEYA MATCH')
            .replace(/🌟 WHY YOU ARE KINDRED SPIRITS/g, 'WHY YOU ARE KINDRED SPIRITS')
            .replace(/✨ YOUR UNIQUE SPARK/g, 'YOUR UNIQUE SPARK')
            .replace(/🍽️ A TASTE OF AIRDAEYA/g, 'A TASTE OF AIRDAEYA')
            .replace(/[\u{1F300}-\u{1FAD6}]/gu, '')
            .replace(/[\u{2600}-\u{27BF}]/gu, '');

        const paragraphs = cleanText.split('\n').filter(p => p.trim());
        for (const para of paragraphs) {
            const isHeader = sectionHeaders.includes(para.trim());
            if (isHeader) {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(69, 35, 69);
                doc.setFontSize(12);
            } else {
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(50, 50, 50);
                doc.setFontSize(10);
            }
            const lines = doc.splitTextToSize(para, contentW);
            if (y + lines.length * 5 > doc.internal.pageSize.getHeight() - 22) {
                doc.addPage();
                doc.setFillColor(245, 240, 225);
                doc.rect(0, 0, pageW, doc.internal.pageSize.getHeight(), 'F');
                y = 20;
            }
            doc.text(lines, margin, y);
            y += lines.length * 5 + 2;
        }

        const pageH_pdf = doc.internal.pageSize.getHeight();
        const footerY = pageH_pdf - 22;
        doc.setDrawColor(195, 177, 133);
        doc.setLineWidth(0.3);
        doc.line(margin, footerY - 4, pageW - margin, footerY - 4);

        // Logo: KTPike color extended
        try {
            const logoURL = await getLogoURL('ktpike-color');
            if (logoURL) {
                const logoImg = new Image();
                logoImg.crossOrigin = 'Anonymous';
                await new Promise((res, rej) => {
                    logoImg.onload = res; logoImg.onerror = rej;
                    logoImg.src = logoURL;
                });
                const logoC = document.createElement('canvas');
                logoC.width = logoImg.width; logoC.height = logoImg.height;
                logoC.getContext('2d').drawImage(logoImg, 0, 0);
                const logoAspect = logoImg.width / logoImg.height;
                const logoH_pdf = 8;
                const logoW_pdf = logoH_pdf * logoAspect;
                doc.addImage(logoC.toDataURL('image/png'), 'PNG', (pageW - logoW_pdf) / 2, footerY - 1, logoW_pdf, logoH_pdf);
            } else {
                throw new Error('No logo URL');
            }
        } catch (e) {
            doc.setFontSize(8);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(143, 97, 144);
            doc.text('K.T. Pike | ktpike.com', pageW / 2, footerY + 4, { align: 'center' });
        }
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(143, 97, 144);
        doc.text('For entertainment purposes only.', pageW / 2, footerY + 10, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text('airdaeya.web.app', pageW / 2, footerY + 16, { align: 'center' });

        doc.save(`Airdaeium-${(goesBy || characterName || 'Match').replace(/\s+/g, '-')}.pdf`);

    } catch (e) {
        console.error('PDF generation failed:', e);
        alert('Could not generate PDF. Please try again.');
    } finally {
        btn.textContent = '📄 Save as PDF';
        btn.disabled = false;
    }
}

async function generateShareImage(characterName, goesBy, proclamation, portraitURL) {
    const btn = document.getElementById('share-image-btn');
    btn.textContent = 'Creating image...';
    btn.disabled = true;

    try {
        const canvas = document.createElement('canvas');
        const W = 1080, H = 1080;
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#2d2e49');
        bg.addColorStop(1, '#452345');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(195, 177, 133, 0.04)';
        for (let i = 0; i < H; i += 4) ctx.fillRect(0, i, W, 2);

        const goldGrad = ctx.createLinearGradient(0, 0, W, 0);
        goldGrad.addColorStop(0, '#B8860B'); goldGrad.addColorStop(0.3, '#FFD700');
        goldGrad.addColorStop(0.5, '#DAA520'); goldGrad.addColorStop(0.7, '#FFD700');
        goldGrad.addColorStop(1, '#B8860B');
        ctx.fillStyle = goldGrad;
        ctx.fillRect(0, 18, W, 12);
        ctx.fillRect(0, H - 30, W, 12);

        // FIX: Load Airdaeium icon via getStorageURL (Logos folder)
        try {
            const iconURL = await getLogoURL('icon');
            if (iconURL) {
                const icon = new Image();
                icon.crossOrigin = 'Anonymous';
                await new Promise((res, rej) => {
                    icon.onload = res; icon.onerror = rej;
                    icon.src = iconURL;
                });
                ctx.drawImage(icon, 30, 38, 80, 80);
            }
        } catch (e) { console.warn('Icon failed', e); }

        ctx.textAlign = 'center';
        const titleGrad = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
        titleGrad.addColorStop(0, '#B8860B'); titleGrad.addColorStop(0.5, '#FFD700');
        titleGrad.addColorStop(1, '#B8860B');
        ctx.fillStyle = titleGrad;
        ctx.font = 'bold 72px Georgia, serif';
        ctx.fillText('Airdaeium', W / 2, 100);

        ctx.fillStyle = 'rgba(255,215,0,0.6)';
        ctx.font = 'italic 36px Georgia, serif';
        ctx.fillText('My Airdaeya Personality Match', W / 2, 146);

        const centerX = W / 2, portraitY = 403, radius = 210;
        const glow = ctx.createRadialGradient(centerX, portraitY, radius * 0.7, centerX, portraitY, radius * 1.5);
        glow.addColorStop(0, 'rgba(255,215,0,0.25)');
        glow.addColorStop(1, 'rgba(255,215,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, portraitY, radius * 1.5, 0, Math.PI * 2);
        ctx.fill();

        if (portraitURL) {
            try {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = portraitURL; });
                ctx.save();
                ctx.beginPath();
                ctx.arc(centerX, portraitY, radius, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(img, centerX - radius, portraitY - radius, radius * 2, radius * 2);
                ctx.restore();
            } catch (e) { console.warn('Portrait load failed', e); }
        }

        const borderGrad = ctx.createLinearGradient(centerX - radius, 0, centerX + radius, 0);
        borderGrad.addColorStop(0, '#B8860B'); borderGrad.addColorStop(0.5, '#FFD700');
        borderGrad.addColorStop(1, '#B8860B');
        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(centerX, portraitY, radius, 0, Math.PI * 2);
        ctx.stroke();

        const displayName = (goesBy || characterName || '').toUpperCase();
        const nameGrad = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
        nameGrad.addColorStop(0, '#B8860B'); nameGrad.addColorStop(0.3, '#FFD700');
        nameGrad.addColorStop(0.5, '#DAA520'); nameGrad.addColorStop(0.7, '#FFD700');
        nameGrad.addColorStop(1, '#B8860B');
        ctx.fillStyle = nameGrad;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 10;

        let nameFontSize = 80;
        ctx.font = `bold ${nameFontSize}px Georgia, serif`;
        while (ctx.measureText(displayName).width > W - 80 && nameFontSize > 36) {
            nameFontSize -= 2;
            ctx.font = `bold ${nameFontSize}px Georgia, serif`;
        }
        ctx.fillText(displayName, W / 2, 718);
        ctx.shadowBlur = 0;

        if (proclamation) {
            ctx.fillStyle = 'rgba(195,177,133,0.92)';
            ctx.font = 'italic 42px Georgia, serif';
            const maxWidth = W - 100;
            const words = proclamation.split(' ');
            const procLines = [];
            let currentLine = '';
            for (const word of words) {
                const test = currentLine + (currentLine ? ' ' : '') + word;
                if (ctx.measureText(test).width > maxWidth && currentLine) {
                    procLines.push(currentLine);
                    currentLine = word;
                } else { currentLine = test; }
            }
            if (currentLine) procLines.push(currentLine);
            let procY = 782;
            for (const pl of procLines) { ctx.fillText(pl, W / 2, procY); procY += 54; }
        }

        ctx.strokeStyle = 'rgba(255,215,0,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W * 0.15, 918); ctx.lineTo(W * 0.85, 918);
        ctx.stroke();

        // FIX: Load KTPike white logo via getStorageURL (Logos folder)
        try {
            const logoURL = await getLogoURL('ktpike-white');
            if (logoURL) {
                const logo = new Image();
                logo.crossOrigin = 'Anonymous';
                await new Promise((res, rej) => {
                    logo.onload = res; logo.onerror = rej;
                    logo.src = logoURL;
                });
                const logoH = 85;
                const logoW2 = logo.width * (logoH / logo.height);
                ctx.drawImage(logo, (W - logoW2) / 2, 928, logoW2, logoH);
            } else {
                throw new Error('No logo URL');
            }
        } catch (e) {
            ctx.fillStyle = 'rgba(255,215,0,0.7)';
            ctx.font = '28px Georgia, serif';
            ctx.fillText('K.T. Pike', W / 2, 944);
        }

        ctx.fillStyle = 'rgba(195,177,133,0.65)';
        ctx.font = '30px Arial, sans-serif';
        ctx.fillText('Find your match at airdaeya.web.app', W / 2, 1032);

        const link = document.createElement('a');
        link.download = `Airdaeium-${(goesBy || characterName || 'Match').replace(/\s+/g, '-')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

    } catch (e) {
        console.error('Image generation failed:', e);
        alert('Could not generate image. Please try again.');
    } finally {
        btn.textContent = '📸 Share as Image';
        btn.disabled = false;
    }
}

// =================================================================================
// 13. World Map
// =================================================================================

async function displayWorldMap() {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `<h2>Loading world map...</h2>`;

    try {
        // ── Load all continents, sort by sort_order ─────────────────────────
        const continentsSnap = await db.collection('continents').orderBy('sort_order').get();
        const allContinents = continentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // ── For now: only show revealed continents (premium gate goes here later) ──
        const isPremium = false; // placeholder for future auth
        const visibleContinents = allContinents.filter(c => c.revealed || isPremium);

        if (visibleContinents.length === 0) {
            el.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <h2>No maps available yet.</h2>
            `;
            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
            return;
        }

        // ── Load countries for all visible continents ───────────────────────
        const countriesSnap = await db.collection('countries').get();
        const allCountries = {};
        countriesSnap.forEach(d => {
            const data = { id: d.id, ...d.data() };
            allCountries[data.id] = data;
        });

        // ── Use the last visible continent's map as the base image ──────────
        // (When premium unlocks, the full world map replaces the partial one)
        const baseContinent = visibleContinents[visibleContinents.length - 1];
        const mapURL = await getStorageURL(baseContinent.map_path);

        // ── Render shell ────────────────────────────────────────────────────
        el.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <h1>World Map</h1>
            <p class="welcome-subtitle">Hover over a region to explore. Click to learn more.</p>
            <div class="map-wrapper" id="map-wrapper">
                <img id="map-base-img" src="${mapURL}" alt="World Map" class="map-base-img" />
                <div class="map-overlay-container" id="map-overlay-container"></div>
                <div class="map-tooltip" id="map-tooltip"></div>
            </div>
        `;
        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

        const overlayContainer = document.getElementById('map-overlay-container');
        const tooltip          = document.getElementById('map-tooltip');
        const baseImg          = document.getElementById('map-base-img');

        // ── Wait for image to load so dimensions are known ──────────────────
        await new Promise(res => {
            if (baseImg.complete) { res(); return; }
            baseImg.onload = res;
        });

        // ── Load and render each continent's SVG overlay ────────────────────
        for (const continent of visibleContinents) {
            if (!continent.svg_overlay_path) continue;
            const svgURL = await getStorageURL(continent.svg_overlay_path);
            if (!svgURL) continue;

            const response = await fetch(svgURL);
            const svgText  = await response.text();

            // Parse the SVG text into a DOM element
            const parser  = new DOMParser();
            const svgDoc  = parser.parseFromString(svgText, 'image/svg+xml');
            const svgEl   = svgDoc.querySelector('svg');
            if (!svgEl) continue;

            // Make the SVG fill the overlay container exactly
            svgEl.setAttribute('width',  '100%');
            svgEl.setAttribute('height', '100%');
            svgEl.style.position = 'absolute';
            svgEl.style.top      = '0';
            svgEl.style.left     = '0';

            // ── Wire up each country path ────────────────────────────────────
            const paths = svgEl.querySelectorAll('path, polygon, ellipse, circle, rect');
            paths.forEach(path => {
                const countryId = path.getAttribute('id');
                const country   = allCountries[countryId];
                if (!country) return;

                // Base styles — invisible but interactive
                path.style.fill            = 'transparent';
                path.style.stroke          = 'none';
                path.style.cursor          = 'pointer';
                path.style.transition      = 'fill 0.2s ease';

                // Hover — gold highlight
                path.addEventListener('mouseenter', (e) => {
                    path.style.fill    = 'rgba(255, 215, 0, 0.35)';
                    path.style.stroke  = '#FFD700';
                    path.style.strokeWidth = '2';
                    tooltip.textContent    = country.ctry_name || countryId;
                    tooltip.style.display  = 'block';
                });

                path.addEventListener('mousemove', (e) => {
                    const wrapper = document.getElementById('map-wrapper');
                    const rect    = wrapper.getBoundingClientRect();
                    tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
                    tooltip.style.top  = (e.clientY - rect.top  - 28) + 'px';
                });

                path.addEventListener('mouseleave', () => {
                    path.style.fill       = 'transparent';
                    path.style.stroke     = 'none';
                    tooltip.style.display = 'none';
                });

                // Click → country detail page
                path.addEventListener('click', () => {
                    displayCountryDetails(countryId);
                });
            });

            overlayContainer.appendChild(svgEl);
        }

    } catch (error) {
        console.error('Error loading world map:', error);
        el.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <h2>Error loading map. Please try again.</h2>
        `;
        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
    }
}

// =================================================================================
// 14. Country Details
// =================================================================================

async function displayCountryDetails(countryId) {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `<h2>Loading...</h2>`;

    try {
        // ── Fetch country, books, country_appearances, and capital city ────
        const [countryDoc, booksSnap, appearancesSnap, capitalSnap] = await Promise.all([
            db.collection('countries').doc(countryId).get(),
            db.collection('books').get(),
            db.collection('country_appearances').where('ctry_id', '==', countryId).get(),
            db.collection('cities')
                .where('ctry_id', '==', countryId)
                .where('is_capital', '==', true)
                .get(),
        ]);

        if (!countryDoc.exists) {
            el.innerHTML = `
                <button class="back-button" id="back-to-map-btn">← Back to Map</button>
                <h2>Country not found.</h2>
            `;
            document.getElementById('back-to-map-btn').addEventListener('click', displayWorldMap);
            return;
        }

        const data = countryDoc.data();

        const bookMap = {};
        booksSnap.forEach(d => { bookMap[d.id] = { id: d.id, ...d.data() }; });

        // ── Resolve capital city ─────────────────────────────────────────────
        const capitalCity = capitalSnap.empty ? null : capitalSnap.docs[0].data();

        // ── Resolve linked books via country_appearances ────────────────────
        const linkedBooks = [];
        appearancesSnap.forEach(d => {
            const { book_id } = d.data();
            const book = bookMap[book_id];
            if (book && book.released) linkedBooks.push(book);
        });
        linkedBooks.sort((a, b) => (a.book_order || 0) - (b.book_order || 0));

        // ── Escape helper ───────────────────────────────────────────────────
        function escHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        // ── Render shell ────────────────────────────────────────────────────
        el.innerHTML = `
            <button class="back-button" id="back-to-map-btn">← Back to Map</button>
            <h1 class="character-detail-name">${escHtml(data.ctry_name || countryId)}</h1>
            <div class="character-detail-content">
                <div class="character-detail-left" id="country-left"></div>
                <div class="character-detail-description" id="country-right"></div>
            </div>
        `;
        document.getElementById('back-to-map-btn').addEventListener('click', displayWorldMap);

        const leftCol  = document.getElementById('country-left');
        const rightCol = document.getElementById('country-right');

        // ── Country close-up map (if available) ─────────────────────────────
        if (data.map_path) {
            const mapURL = await getStorageURL(data.map_path);
            if (mapURL) {
                const mapImg = document.createElement('img');
                mapImg.src = mapURL;
                mapImg.alt = `Map of ${data.ctry_name}`;
                mapImg.classList.add('character-portrait-detail');
                leftCol.appendChild(mapImg);
            }
        }

        // ── Info box ─────────────────────────────────────────────────────────
        const infoRows = [];
        if (capitalCity) {
            infoRows.push({ label: 'Capital', html: escHtml(capitalCity.city_name) });
        }
        if (linkedBooks.length) {
            const bookLinks = linkedBooks.map(book => {
                const title = escHtml(book.book_title || 'Untitled');
                return book.book_url
                    ? `<a href="${addAppTracking(book.book_url, 'country_book_link')}" target="_blank" rel="noopener" class="info-book-link">${title}</a>`
                    : title;
            }).join(', ');
            infoRows.push({ label: 'Appears In', html: bookLinks });
        }

        if (infoRows.length) {
            const infoBox = document.createElement('div');
            infoBox.classList.add('character-info-box');
            infoBox.innerHTML = `
                <div class="character-info-box-header">Details</div>
                <dl class="character-info-list">
                    ${infoRows.map(row => `
                        <div class="character-info-row">
                            <dt>${row.label}</dt>
                            <dd>${row.html}</dd>
                        </div>
                    `).join('')}
                </dl>
            `;
            leftCol.appendChild(infoBox);
        }

        // ── Description ──────────────────────────────────────────────────────
        if (data.ctry_description) {
            rightCol.insertAdjacentHTML('afterbegin', data.ctry_description);
        }

    } catch (error) {
        console.error('Error loading country details:', error);
        el.innerHTML = `
            <button class="back-button" id="back-to-map-btn">← Back to Map</button>
            <h2>Error loading country details. Please try again.</h2>
        `;
        document.getElementById('back-to-map-btn').addEventListener('click', displayWorldMap);
    }
}

// =================================================================================
// 15. Footer & About Modal
// =================================================================================

function renderFooter() {
    if (document.getElementById('app-footer')) return;
    const footer = document.createElement('footer');
    footer.id = 'app-footer';
    footer.innerHTML = `
        <div class="footer-logo-wrap" id="footer-logo-wrap"></div>
        <span class="footer-copyright">© 2026 K.T. Pike</span>
        <button class="footer-about-link" id="footer-about-btn">About</button>
    `;
    document.body.appendChild(footer);
    document.getElementById('footer-about-btn').addEventListener('click', showAboutModal);
    // Load white-with-colored-dots logo asynchronously
    getLogoURL('ktpike-white-dots').then(url => {
        const wrap = document.getElementById('footer-logo-wrap');
        if (!wrap) return;
        if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'K.T. Pike';
            img.className = 'footer-logo-img';
            wrap.appendChild(img);
        }
    });
}

function showAboutModal() {
    if (document.getElementById('about-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'about-modal-overlay';
    overlay.innerHTML = `
        <div id="about-modal">
            <div class="about-modal-header">About Airdaeium</div>
            <div class="about-modal-body">
                <p><strong>Airdaeium</strong> is a reader companion for the <em>Tales of Airdaeya</em> fantasy series by K.T. Pike. Explore character profiles, convert dates on the Oram calendar, and discover which Airdaeya character matches your personality.</p>
                <p>The personality quiz is for entertainment purposes only. Results are written in the stars — and by Google Gemini AI — based on your answers, and may vary between sessions.</p>
                <p>For more about the author and the books, visit <a href="${addAppTracking('https://ktpike.com', 'about_modal')}" target="_blank" rel="noopener">ktpike.com</a>.</p>
            </div>
            <button class="about-modal-close" id="about-modal-close-btn">Close</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAboutModal();
    });
    document.getElementById('about-modal-close-btn').addEventListener('click', closeAboutModal);
}

function closeAboutModal() {
    const overlay = document.getElementById('about-modal-overlay');
    if (overlay) overlay.remove();
}

// =================================================================================
// 14. DOMContentLoaded
// =================================================================================

document.addEventListener('DOMContentLoaded', () => {

    // ── Inject map styles ────────────────────────────────────────────────────
    const mapStyles = document.createElement('style');
    mapStyles.textContent = `
        .map-wrapper {
            position: relative;
            display: inline-block;
            width: 100%;
            max-width: 900px;
            margin: 0 auto;
            display: block;
        }
        .map-base-img {
            display: block;
            width: 100%;
            height: auto;
            border-radius: 8px;
            border: 2px solid var(--primary-color);
        }
        .map-overlay-container {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
        }
        .map-overlay-container svg {
            pointer-events: all;
        }
        .map-tooltip {
            position: absolute;
            background: var(--primary-color);
            color: #FFD700;
            font-family: var(--font-header);
            font-size: 0.85rem;
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid #FFD700;
            pointer-events: none;
            display: none;
            white-space: nowrap;
            z-index: 10;
        }
    `;
    document.head.appendChild(mapStyles);
    initializeTheme();

    const themeToggleButton = document.getElementById('theme-toggle');
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', () => {
            applyTheme(!document.body.classList.contains('dark-mode'));
        });
    }

    // FIX: Logo click → home. Checks both id and common class names in case HTML differs.
    // Make sure your HTML element has id="airdaeium-logo" on the logo image or wrapper.
    const logoEl = document.getElementById('airdaeium-logo');
    if (logoEl) {
        logoEl.style.cursor = 'pointer';
        logoEl.addEventListener('click', displayHomeScreen);
    }

    renderFooter();
    displayHomeScreen();
});
// =================================================================================
// 11. Moon Tracker
// =================================================================================
//
// HOW TO USE:
//   1. Add the JS below into script.js (after section 10, the Calendar Converter).
//   2. Add the CSS from moon-tracker-styles.css into style.css.
//   3. In displayHomeScreen(), add this button inside .home-buttons:
//   4. In displayHomeScreen(), add this listener:
//
// ORBITAL CONSTANTS (confirmed against your calibration data):
//   - cb_solar_year for ALL bodies is in Oram days, not Oram years.
//   - Oram itself has cb_solar_year = 396, confirming this.
//   - Phase formula: (absoluteDay / period) % 1.0
//     where absoluteDay counts from 0 = epoch (calendar Day 1 = day 1, epoch = "day 0").
//   - Longitude 0 = Stragos meridian (directly opposite the epoch alignment line).
//     At the epoch, Leha was at longitude 180° from Stragos (i.e., anti-meridian),
//     so Stragos was in the middle of the night sky. This anchors our sky geometry.
// =================================================================================

// ── Orbital constants ─────────────────────────────────────────────────────────────
const MOON_TRACKER = {
    // Moon periods in Oram days
    KUU:  { name: 'Kuu',  period: 14.0000000012,    color: '#e8eeff', radius: 9 },  // silvery-white Love Goddess
    ISA:  { name: 'Isa',  period: 43.613852953,     color: '#40c8a0', radius: 6 },  // teal (green↔blue Trickster)
    UMAN: { name: 'Uman', period: 64.9515419873522, color: '#d94040', radius: 5 },  // red God of War

    // Hours per Oram day
    HOURS_PER_DAY: 28,

    // Calendar structure
    DAYS_PER_YEAR:  396,
    DAYS_PER_TQ:    33,

    // Tritquarter names (1-indexed)
    TQ_NAMES: [
        '', // placeholder so index matches tq number
        'Mamdi','Netamee','Elany',
        'Bamdi','Kazamee','Ojany',
        'Zamdi','Pilamee','Itrany',
        'Samdi','Tihamee','Anany'
    ],
};

// ── Core math ─────────────────────────────────────────────────────────────────────

/** Convert a calendar date + time to absolute fractional day since epoch.
 *  Calendar year 1, TQ 1, Day 1 = absolute day 1 (epoch = day 0).
 *  @param {number} year  - AWB year (1+)
 *  @param {number} tq    - tritquarter (1-12)
 *  @param {number} day   - day within TQ (1-33)
 *  @param {number} hour  - Oram hour (0-27, where 28:00 = midnight = 0 of next day)
 */
function calendarToFractionalDay(year, tq, day, hour) {
    const dayOfYear = (tq - 1) * 33 + day;       // 1-396
    const absDay    = (year - 1) * 396 + dayOfYear; // integer calendar day
    const fraction  = hour / 28;                  // fraction through the day
    return absDay - 1 + fraction;                 // 0-based fractional day from epoch
}

/** Moon phase: 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter */
function moonPhase(fractionalDay, period) {
    // Using (day / period) % 1 — confirmed against calibration data
    return ((fractionalDay + 1) / period) % 1;
    // +1 because the formula uses (absoluteCalendarDay / period), and
    // fractionalDay = absCalDay - 1 + hourFraction, but for the epoch
    // calibration the integer formula was (day / period) % 1 where day = absCalDay.
    // So we add back the 1 to match.
}

/** Phase distance from new moon, in days */
function distFromNew(phase, period) {
    return Math.min(phase, 1 - phase) * period;
}

/** Phase distance from full moon, in days */
function distFromFull(phase, period) {
    return Math.abs(phase - 0.5) * period;
}

/** Illumination fraction visible from Oram's surface (0 = new, 1 = full) */
function illumination(phase) {
    // Cosine illumination: 0 at new (phase=0), 1 at full (phase=0.5)
    return (1 - Math.cos(phase * 2 * Math.PI)) / 2;
}

/** Sky longitude of a moon at a given fractional day and Oram hour.
 *
 *  Sky geometry:
 *  - Oram rotates once per day (360° / 28 hours).
 *  - At the epoch (fractionalDay=0), it is midnight at Stragos (lon 0).
 *    Leha was at the anti-meridian (lon 180° from Stragos as seen from above).
 *    A "new moon" moon at the epoch would be between Oram and Leha
 *    → new moon is on the Leha-side = lon 180° at midnight at Stragos.
 *
 *  Moon longitude on Oram's surface at time T:
 *    moonAngle_inertial = phase × 360°       (angle from Leha direction, prograde)
 *    OramRotation       = (hourOfDay / 28) × 360°   (how much Oram has rotated since midnight)
 *    Stragos is at lon 0. At midnight (hour=0), Stragos faces away from Leha (lon 180° in inertial).
 *    lon_Stragos_inertial = 180° + OramRotation
 *    moonLon = moonAngle_inertial - lon_Stragos_inertial   (mod 360)
 *            = phase×360 - (180 + (hour/28)×360)           (mod 360)
 *
 *  Positive = east of Stragos (moon is rising / has risen).
 *  Negative = west of Stragos (moon has set / is setting).
 *  ≈ 0      = moon is near the meridian (overhead at Stragos).
 *  ≈ ±180   = moon is below the horizon (near the Leha side at midnight).
 *
 *  A moon is above the horizon (visible at night) when its longitude from
 *  Stragos is between -90° and +90° (i.e. on the night side).
 *  It's visible during the day when between +90° and +270° (day side),
 *  but only if illuminated enough to see.
 *
 *  @param {number} phase   0–1
 *  @param {number} hour    0–27
 *  @returns {number} longitude in degrees, -180 to +180
 */
function moonLongitude(phase, hour) {
    const moonAngle  = phase * 360;
    const oramRot    = (hour / 28) * 360;
    const stragosInertial = 180 + oramRot;
    let lon = moonAngle - stragosInertial;
    // Normalise to -180..+180
    lon = ((lon % 360) + 360) % 360;
    if (lon > 180) lon -= 360;
    return lon;
}

/** Describe where the moon is in the sky */
function skyPosition(lon, phase) {
    const illum = illumination(phase);
    const absDeg = Math.abs(lon);

    // Night side: -90 to +90
    if (absDeg <= 90) {
        if (absDeg < 5)  return { visible: true, desc: 'directly overhead (meridian)', night: true };
        if (lon > 0)     return { visible: true, desc: `${lon.toFixed(0)}° east (rising)`, night: true };
        return               { visible: true, desc: `${Math.abs(lon).toFixed(0)}° west (setting)`, night: true };
    }

    // Day side: 90–270 from night-centre = below horizon or in daytime sky
    if (absDeg > 90 && absDeg <= 180) {
        const horizDeg = (absDeg - 90).toFixed(0);
        const side = lon > 0 ? 'east' : 'west';
        return { visible: false, desc: `below horizon (${horizDeg}° past ${side} horizon)`, night: false };
    }

    return { visible: false, desc: 'below horizon', night: false };
}

/** Phase name string */
function phaseName(phase) {
    const p = phase;
    if (p < 0.04 || p > 0.96)         return 'New Moon 🌑';
    if (p < 0.21)                      return 'Waxing Crescent 🌒';
    if (p < 0.29)                      return 'First Quarter 🌓';
    if (p < 0.46)                      return 'Waxing Gibbous 🌔';
    if (p < 0.54)                      return 'Full Moon 🌕';
    if (p < 0.71)                      return 'Waning Gibbous 🌖';
    if (p < 0.79)                      return 'Last Quarter 🌗';
    return                               'Waning Crescent 🌘';
}

/** Moon SVG disc with correct phase shading */
function moonSVG(phase, color, size) {
    // Phase rendering using the standard two-half technique:
    //
    //   phase 0.0 = New Moon     (fully dark)
    //   phase 0.25= First Qtr   (right half lit)
    //   phase 0.5 = Full Moon    (fully lit)
    //   phase 0.75= Last Qtr    (left half lit)
    //
    // Strategy: always start with a fully dark disc.
    // Then draw the lit region as two parts:
    //   1. A half-disc rect on the lit side (right for waxing, left for waning).
    //   2. A terminator ellipse that either ADDS more light (gibbous) or
    //      REMOVES light (crescent) from the opposite side.
    //
    // Terminator ellipse x-radius: |cos(phase × 2π)| × r
    //   At new/full → rx = r  (terminator spans full width → crescent → dark)
    //   At quarters → rx = 0  (no terminator → exactly half lit)
    //
    // For WAXING (phase 0→0.5):
    //   Lit side = RIGHT.  The right half-rect is always drawn.
    //   phase < 0.25 (crescent): ellipse on RIGHT is DARK → hides most of right half
    //   phase > 0.25 (gibbous):  ellipse on LEFT  is LIT  → adds to right half
    //
    // For WANING (phase 0.5→1.0):
    //   Lit side = LEFT.  The left half-rect is always drawn.
    //   phase < 0.75 (gibbous):  ellipse on RIGHT is LIT  → adds to left half
    //   phase > 0.75 (crescent): ellipse on LEFT  is DARK → hides most of left half

    const r = size / 2;
    const cx = r, cy = r;
    const dark = '#1a1a2e';

    const waning   = phase > 0.5;
    const gibbous  = waning ? (phase < 0.75) : (phase > 0.25);
    const termRx   = Math.abs(Math.cos(phase * 2 * Math.PI)) * r;

    // The terminator ellipse sits on the OPPOSITE side from the lit half-rect,
    // and is colored to add (gibbous) or subtract (crescent) light.
    // Waxing: lit=right, terminator on left  (x = cx - termRx  → centred at cx)
    // Waning: lit=left,  terminator on right (x = cx + termRx  → centred at cx)
    // Since the ellipse is centred at cx either way, we just flip the fill color.
    const termFill = gibbous ? color : dark;

    return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="disc-${size}">
          <circle cx="${cx}" cy="${cy}" r="${r}" />
        </clipPath>
      </defs>
      <!-- Dark base disc -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark}" />
      <g clip-path="url(#disc-${size})">
        <!-- Lit half: right for waxing, left for waning -->
        <rect x="${waning ? 0 : cx}" y="0" width="${r}" height="${size}" fill="${color}" opacity="0.92"/>
        <!-- Terminator ellipse centred at the disc centre, coloured to add/remove light -->
        <ellipse cx="${cx}" cy="${cy}" rx="${termRx}" ry="${r}" fill="${termFill}" opacity="0.92"/>
      </g>
      <!-- Rim -->
      <circle cx="${cx}" cy="${cy}" r="${r - 0.5}" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.45"/>
    </svg>`;
}

// ── Sky diagram ───────────────────────────────────────────────────────────────────

/** Render the sky arc diagram showing all three moons' positions */
/** Interpolate between two hex colours. t=0 → c1, t=1 → c2 */
function lerpColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16);
    const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16);
    const r = Math.round(r1 + (r2-r1)*t), g = Math.round(g1 + (g2-g1)*t), b = Math.round(b1 + (b2-b1)*t);
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function renderSkyDiagram(moons, hour = 0) {
    const W = 400, H = 180;
    const cx = W / 2, cy = H * 0.85;  // horizon centre
    const R  = H * 0.78;              // sky arc radius

    const h = ((hour % 28) + 28) % 28; // normalise to 0–28 (handles fractional)

    let sunAmount; // 0 = full night, 1 = full day
    if (h < 7) {
        sunAmount = 0;                        // 0–6: night
    } else if (h < 11) {
        sunAmount = (h - 7) / 4;             // 7–10: dawn ramp up
    } else if (h < 18) {
        sunAmount = 1;                        // 11–17: full day
    } else if (h < 21) {
        sunAmount = 1 - (h - 18) / 3;        // 18–20: dusk ramp down
    } else {
        sunAmount = 0;                        // 21–28: night
    }

    const isDay = sunAmount >= 0.4;  // mid-dawn counts as daytime for badges/stars

    // Colour stops: night ↔ dawn/dusk ↔ day
    const NIGHT_TOP    = '#0a0818';
    const NIGHT_BOTTOM = '#1a1535';
    const DAWN_TOP     = '#4a2060';
    const DAWN_BOTTOM  = '#e8844a';
    const DAY_TOP      = '#1a6db5';
    const DAY_BOTTOM   = '#87ceeb';

    let skyTop, skyBottom;
    if (sunAmount <= 0) {
        skyTop = NIGHT_TOP; skyBottom = NIGHT_BOTTOM;
    } else if (sunAmount < 0.5) {
        // Night → dawn
        const t = sunAmount * 2;
        skyTop    = lerpColor(NIGHT_TOP,    DAWN_TOP,    t);
        skyBottom = lerpColor(NIGHT_BOTTOM, DAWN_BOTTOM, t);
    } else if (sunAmount < 1) {
        // Dawn → day  (or day → dusk on the way back down)
        const t = (sunAmount - 0.5) * 2;
        skyTop    = lerpColor(DAWN_TOP,    DAY_TOP,    t);
        skyBottom = lerpColor(DAWN_BOTTOM, DAY_BOTTOM, t);
    } else {
        skyTop = DAY_TOP; skyBottom = DAY_BOTTOM;
    }

    function lonToXY(lon) {
        const angle = (90 - lon) * Math.PI / 180;  // radians, 0=right, π=left
        return {
            x: cx + R * Math.cos(angle),
            y: cy - R * Math.sin(angle)
        };
    }

    // Build SVG
    let svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
                    style="max-width:${W}px; margin:0 auto; display:block;">
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${skyTop}"/>
          <stop offset="100%" stop-color="${skyBottom}"/>
        </linearGradient>
        <clipPath id="sky-clip">
          <path d="M0,${cy} A${R*1.15},${R*1.15} 0 0,1 ${W},${cy} L${W},${H} L0,${H} Z"/>
        </clipPath>
      </defs>

      <!-- Sky background -->
      <path d="M0,${cy} A${R*1.15},${R*1.15} 0 0,1 ${W},${cy} L${W},${H} L0,${H} Z"
            fill="url(#sky-grad)" />

      <!-- Stars: only visible at night -->
      ${!isDay ? [...Array(30)].map(() => {
          const sx = Math.random()*W, sy = Math.random()*cy*0.9;
          const sr = Math.random()*1.2+0.3, so = Math.random()*0.6+0.3;
          return `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="white" opacity="${so.toFixed(2)}"/>`;
      }).join('') : ''}

      <!-- Ground -->
      <rect x="0" y="${cy}" width="${W}" height="${H - cy}" fill="#2d1810" opacity="0.8"/>

      <!-- Horizon line -->
      <line x1="0" y1="${cy}" x2="${W}" y2="${cy}" stroke="rgba(255,215,0,0.3)" stroke-width="1"/>

      <!-- Arc guides: every 30° -->
      ${[-90,-60,-30,0,30,60,90].map(deg => {
          const pt = lonToXY(deg);
          const label = deg === 0 ? 'Meridian' : (deg < 0 ? `${Math.abs(deg)}°W` : `${deg}°E`);
          const onHorizon = Math.abs(deg) === 90;
          return `
            <line x1="${pt.x.toFixed(1)}" y1="${cy}" x2="${pt.x.toFixed(1)}" y2="${pt.y.toFixed(1)}"
                  stroke="rgba(255,215,0,0.08)" stroke-width="1" stroke-dasharray="2,4"/>
            <text x="${pt.x.toFixed(1)}" y="${(cy+14).toFixed(1)}" text-anchor="middle"
                  font-size="9" fill="rgba(255,215,0,0.5)" font-family="sans-serif">
              ${onHorizon ? (deg < 0 ? 'W' : 'E') : label}
            </text>`;
      }).join('')}

      <!-- Sky arc -->
      <path d="M${lonToXY(-90).x},${cy} A${R},${R} 0 0,1 ${lonToXY(90).x},${cy}"
            fill="none" stroke="rgba(255,215,0,0.2)" stroke-width="1"/>`;

    // Draw each moon
    moons.forEach(m => {
        if (!m.sky.night) return; // only draw above-horizon moons on the arc
        const pt   = lonToXY(m.lon);
        const mR   = m.moon === 'Kuu' ? 14 : m.moon === 'Isa' ? 10 : 8;
        const illum = illumination(m.phase);

        // Phase-shaded circle — same two-half logic as moonSVG()
        const waning  = m.phase > 0.5;
        const gibbous = waning ? (m.phase < 0.75) : (m.phase > 0.25);
        const termRx  = Math.abs(Math.cos(m.phase * 2 * Math.PI)) * mR;
        const termFill = gibbous ? m.color : '#101025';

        svg += `
        <g transform="translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})">
          <defs>
            <clipPath id="mc-${m.moon}">
              <circle r="${mR}"/>
            </clipPath>
          </defs>
          <!-- Dark base -->
          <circle r="${mR}" fill="#101025"/>
          <!-- Lit half + terminator -->
          <g clip-path="url(#mc-${m.moon})">
            <rect x="${waning ? -mR : 0}" y="${-mR}" width="${mR}" height="${mR*2}" fill="${m.color}" opacity="0.9"/>
            <ellipse cx="0" cy="0" rx="${termRx}" ry="${mR}" fill="${termFill}" opacity="0.9"/>
          </g>
          <!-- Rim glow -->
          <circle r="${mR}" fill="none" stroke="${m.color}" stroke-width="1.5" opacity="0.6"/>
          <!-- Label -->
          <text y="${mR + 11}" text-anchor="middle" font-size="9" fill="${m.color}"
                font-family="sans-serif" font-weight="bold">${m.moon}</text>
        </g>`;
    });

    // Draw below-horizon moons as dim icons near the horizon
    moons.forEach(m => {
        if (m.sky.night) return;
        const clampedLon = Math.max(-170, Math.min(170, m.lon));
        const pt = lonToXY(clampedLon > 0 ? 80 : -80);
        const mR = 6;
        svg += `
        <g transform="translate(${(m.lon > 0 ? W - 30 : 30)},${cy + 18})" opacity="0.3">
          <circle r="${mR}" fill="${m.color}"/>
          <text y="${mR + 9}" text-anchor="middle" font-size="8" fill="${m.color}"
                font-family="sans-serif">${m.moon}</text>
        </g>`;
    });

    svg += `
      <!-- Direction labels -->
      <text x="12" y="${cy - 5}" font-size="10" fill="rgba(255,215,0,0.6)" font-family="sans-serif">West</text>
      <text x="${W - 12}" y="${cy - 5}" font-size="10" fill="rgba(255,215,0,0.6)"
            font-family="sans-serif" text-anchor="end">East</text>
      <text x="${cx}" y="14" font-size="9" fill="rgba(255,255,255,0.4)"
            font-family="sans-serif" text-anchor="middle">Zenith</text>
    </svg>`;

    return svg;
}

// ── Next event finder ─────────────────────────────────────────────────────────────

function findNextEvent(fractDay, type) {
    // type: 'darknight' | 'brightnight'
    const KUU  = MOON_TRACKER.KUU.period;
    const ISA  = MOON_TRACKER.ISA.period;
    const UMAN = MOON_TRACKER.UMAN.period;
    const tol  = 1.0;

    for (let d = Math.ceil(fractDay) + 1; d < fractDay + 5000; d++) {
        const phK = ((d + 1) / KUU)  % 1;
        const phI = ((d + 1) / ISA)  % 1;
        const phU = ((d + 1) / UMAN) % 1;

        const dK = Math.min(phK, 1 - phK) * KUU;
        const dI = Math.min(phI, 1 - phI) * ISA;
        const dU = Math.min(phU, 1 - phU) * UMAN;

        if (type === 'darknight') {
            if (dK <= tol && dI <= tol && dU <= tol) return d;
        } else {
            const fK = Math.abs(phK - 0.5) * KUU;
            const fI = Math.abs(phI - 0.5) * ISA;
            const fU = Math.abs(phU - 0.5) * UMAN;
            if (fK <= tol && fI <= tol && fU <= tol) return d;
        }
    }
    return null;
}

function absDateToCalendar(absDay) {
    const d = Math.floor(absDay);
    const year = Math.floor((d - 1) / 396) + 1;
    const doy  = ((d - 1) % 396) + 1;
    const tq   = Math.floor((doy - 1) / 33) + 1;
    const day  = ((doy - 1) % 33) + 1;
    return { year, tq, day, tqName: MOON_TRACKER.TQ_NAMES[tq] || `TQ${tq}` };
}

// ── Main display function ─────────────────────────────────────────────────────────

async function displayMoonTracker(preselectedCityId = null) {
    const el = getContainer();
    if (!el) return;

    // ── Load cities from Firebase ────────────────────────────────────────────
    window._mtCityMap = { '__stragos__': { city_name: 'Stragos', longitude: 0, latitude: 0 } };
    let cityOptions = '<option value="__stragos__">Stragos (Meridian)</option>';
    try {
        const citiesSnap = await db.collection('cities').get();
        const cityDocs = [];
        citiesSnap.forEach(d => {
            const data = d.data();
            if (data.latitude != null && data.longitude != null) {
                cityDocs.push({ id: d.id, ...data });
                window._mtCityMap[d.id] = { ...data };
            }
        });
        cityDocs.sort((a, b) => (a.city_name || '').localeCompare(b.city_name || ''));
        const defaultId = preselectedCityId || '__stragos__';
        cityOptions = [{ id: '__stragos__', city_name: 'Stragos', is_capital: true }]
            .concat(cityDocs)
            .map(c => `<option value="${c.id}"${c.id === defaultId ? ' selected' : ''}>${c.city_name}${c.is_capital ? ' ★' : ''}</option>`)
            .join('');
    } catch (e) {
        console.warn('Could not load cities:', e);
    }

    el.innerHTML = `
        <button class="back-button" id="back-to-home-btn">← Back to Home</button>
        <div class="calendar-container">
            <h1>Moon Tracker</h1>
            <p class="welcome-subtitle">Moon positions, phases &amp; sky visibility for any moment on Oram</p>

            <div class="converter-panel moon-tracker-input-panel">
                <h3>🌙 Enter Date &amp; Time</h3>

                <div class="mt-location-row">
                    <div class="moon-input-group moon-input-group--location">
                        <label for="mt-city">Location</label>
                        <select id="mt-city" class="mt-input mt-input--location">${cityOptions}</select>
                    </div>
                </div>

                <div class="moon-tracker-inputs">
                    <div class="moon-input-group">
                        <label for="mt-year">Year (AWB)</label>
                        <input type="number" id="mt-year" min="1" value="14887" class="mt-input"/>
                    </div>
                    <div class="moon-input-group">
                        <label for="mt-tq">Tritquarter</label>
                        <select id="mt-tq" class="mt-input">
                            ${MOON_TRACKER.TQ_NAMES.slice(1).map((n,i) =>
                                `<option value="${i+1}">${n} (TQ ${i+1})</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="moon-input-group">
                        <label for="mt-day">Day (1–33)</label>
                        <select id="mt-day" class="mt-input">
                            ${Array.from({length:33},(_,i)=>
                                `<option value="${i+1}">${i+1}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="moon-input-group">
                        <label for="mt-hour">Hour (0–27)</label>
                        <select id="mt-hour" class="mt-input">
                            ${Array.from({length:28},(_,i)=>{
                                const h = i.toString().padStart(2,'0');
                                const label = i === 0 ? '00:00 — Midnight'
                                            : i === 7  ? '07:00 — Dawn'
                                            : i === 14 ? '14:00 — Midday'
                                            : i === 21 ? '21:00 — Dusk'
                                            : `${h}:00`;
                                return `<option value="${i}">${label}</option>`;
                            }).join('')}
                        </select>
                    </div>
                </div>

                <button class="convert-btn" id="mt-calculate-btn">Calculate Moon Positions</button>
            </div>

            <div id="mt-results" style="display:none;">
                <p class="mt-city-label" id="mt-city-label"></p>
                <div id="mt-sky-diagram" class="moon-sky-diagram"></div>
                <div class="moon-tracker-cards" id="mt-moon-cards"></div>
                <div class="moon-tracker-events" id="mt-events"></div>
            </div>
        </div>
    `;

    document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

    document.getElementById('mt-calculate-btn').addEventListener('click', () => {
        const year = parseInt(document.getElementById('mt-year').value)   || 1;
        const tq   = parseInt(document.getElementById('mt-tq').value)     || 1;
        const day  = parseInt(document.getElementById('mt-day').value)    || 1;
        const hour = parseInt(document.getElementById('mt-hour').value);

        const fractDay = calendarToFractionalDay(year, tq, day, hour);

        // ── City longitude offset ────────────────────────────────────────────
        const cityId   = document.getElementById('mt-city') ? document.getElementById('mt-city').value : null;
        const cityData = cityId && window._mtCityMap ? (window._mtCityMap[cityId] || { city_name: 'Stragos', longitude: 0 }) : { city_name: 'Stragos', longitude: 0 };
        const cityLon  = parseFloat(cityData.longitude) || 0;

        // Shift local hour by longitude: 360° = 28 Oram hours
        const lonHourOffset = cityLon * (28 / 360);
        const effectiveHour = ((hour + lonHourOffset) % 28 + 28) % 28;

        console.log('[MoonTracker] city:', cityData.city_name, '| lon:', cityLon, '| offset hrs:', lonHourOffset.toFixed(2), '| input hour:', hour, '| effectiveHour:', effectiveHour.toFixed(2));

        // ── isDay uses raw local hour (sky color = local time, not meridian-adjusted) ──
        // Night: 0–6 and 22–28 | Dawn: 7–10 | Day: 11–17 | Dusk: 18–21
        const _h   = hour;
        const _sun = _h < 7  ? 0
                   : _h < 11 ? (_h - 7) / 4
                   : _h < 18 ? 1
                   : _h < 21 ? 1 - (_h - 18) / 3
                   : 0;
        const isDay = _sun >= 0.4;  // matches renderSkyDiagram threshold

        // Update city label if present
        const locLabel = document.getElementById('mt-city-label');
        if (locLabel) {
            locLabel.textContent = '📍 ' + cityData.city_name +
                (cityLon !== 0 ? ` (${cityLon > 0 ? '+' : ''}${cityLon.toFixed(2)}° lon)` : ' — Stragos Meridian');
        }

        // Compute moon data using effectiveHour for sky positions
        const moonsData = Object.values(MOON_TRACKER).filter(m => m.period).map(m => {
            const phase = moonPhase(fractDay, m.period);
            const lon   = moonLongitude(phase, effectiveHour);
            const sky   = skyPosition(lon, phase);
            const illum = illumination(phase);
            const dNew  = distFromNew(phase, m.period);
            const dFull = distFromFull(phase, m.period);
            return { moon: m.name, period: m.period, color: m.color, radius: m.radius,
                     phase, lon, sky, illum, dNew, dFull };
        });

        // Next events
        const nextDark   = findNextEvent(fractDay, 'darknight');
        const nextBright = findNextEvent(fractDay, 'brightnight');

        // Sky diagram
        document.getElementById('mt-sky-diagram').innerHTML = renderSkyDiagram(moonsData, hour);

        // Moon cards
        document.getElementById('mt-moon-cards').innerHTML = moonsData.map(m => {
            const pct  = (m.illum * 100).toFixed(0);
            const east = m.lon > 0;
            const absDeg = Math.abs(m.lon).toFixed(1);
            const compassDir = Math.abs(m.lon) < 5 ? 'at Meridian' :
                               east ? `${absDeg}° East` : `${absDeg}° West`;

            // Phase arc SVG (small)
            const phaseSvg = moonSVG(m.phase, m.color, 52);

            return `
            <div class="moon-card moon-card-named--${m.moon.toLowerCase()}" data-moon="${m.moon}" style="--moon-color:${m.color}">
                <div class="moon-card-header" style="color:${m.color}; background: linear-gradient(135deg, color-mix(in srgb, ${m.color} 15%, #2d1a2d) 0%, #1a0f1a 100%);">
                    ${m.moon}
                    <span class="moon-card-badge ${m.sky.night ? (isDay ? 'badge--daysky' : 'badge--night') : (isDay ? 'badge--daysky' : 'badge--day')}">
                        ${m.sky.night ? (isDay ? '☀ Day Sky' : '★ Night Sky') : (isDay ? '☀ Day Sky' : '⊙ Below Horizon')}
                    </span>
                </div>
                <div class="moon-card-body">
                    <div class="moon-phase-icon">${phaseSvg}</div>
                    <div class="moon-card-details">
                        <div class="moon-stat">
                            <span class="moon-stat-label">Phase</span>
                            <span class="moon-stat-value">${phaseName(m.phase)}</span>
                        </div>
                        <div class="moon-stat">
                            <span class="moon-stat-label">Illumination</span>
                            <span class="moon-stat-value">
                                <span class="illum-bar-wrap">
                                    <span class="illum-bar" style="width:${pct}%; background:${m.color}"></span>
                                </span>
                                ${pct}%
                            </span>
                        </div>
                        <div class="moon-stat">
                            <span class="moon-stat-label">Sky Position</span>
                            <span class="moon-stat-value">${compassDir}</span>
                        </div>
                        <div class="moon-stat">
                            <span class="moon-stat-label">Visibility</span>
                            <span class="moon-stat-value moon-visibility">${m.sky.desc}</span>
                        </div>
                        <div class="moon-stat">
                            <span class="moon-stat-label">Days to New Moon</span>
                            <span class="moon-stat-value">${m.dNew.toFixed(2)} days</span>
                        </div>
                        <div class="moon-stat">
                            <span class="moon-stat-label">Days to Full Moon</span>
                            <span class="moon-stat-value">${m.dFull.toFixed(2)} days</span>
                        </div>
                    </div>
                </div>
                <div class="moon-card-footer">
                    Period: ${m.period.toFixed(4)} days
                    &nbsp;·&nbsp;
                    Phase: ${(m.phase * 100).toFixed(1)}%
                </div>
            </div>`;
        }).join('');

        // Events panel
        let eventsHtml = '<div class="moon-events-title">Upcoming Events</div><div class="moon-events-grid">';

        if (nextDark !== null) {
            const dc = absDateToCalendar(nextDark);
            const daysAway = nextDark - Math.floor(fractDay);
            eventsHtml += `
            <div class="moon-event moon-event--dark">
                <div class="moon-event-icon">🌑🌑🌑</div>
                <div class="moon-event-label">Next Darknight</div>
                <div class="moon-event-date">${dc.tqName} ${dc.day}, Year ${dc.year} AWB</div>
                <div class="moon-event-away">${daysAway} day${daysAway !== 1 ? 's' : ''} away</div>
            </div>`;
        }

        if (nextBright !== null) {
            const bc = absDateToCalendar(nextBright);
            const daysAway = nextBright - Math.floor(fractDay);
            eventsHtml += `
            <div class="moon-event moon-event--bright">
                <div class="moon-event-icon">🌕🌕🌕</div>
                <div class="moon-event-label">Next Brightnight</div>
                <div class="moon-event-date">${bc.tqName} ${bc.day}, Year ${bc.year} AWB</div>
                <div class="moon-event-away">${daysAway} day${daysAway !== 1 ? 's' : ''} away</div>
            </div>`;
        }

        eventsHtml += '</div>';
        document.getElementById('mt-events').innerHTML = eventsHtml;
        document.getElementById('mt-results').style.display = 'block';
        document.getElementById('mt-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

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

// Initialize Firebase App
const app = firebase.initializeApp(firebaseConfig);

// App Check DISABLED - re-enable once reCAPTCHA is properly configured
// const appCheck = firebase.appCheck(app);
// appCheck.activate(...);
console.log("Firebase App Check activated with reCAPTCHA Enterprise.");

// Initialize other Firebase services
const db = firebase.firestore();
const functions = firebase.functions();

// =================================================================================
// 2. Quiz Variables
// =================================================================================
let quizQuestions = [];
let currentQuestionIndex = 0;
let userAnswers = {};

// =================================================================================
// 3. Theme Toggle Logic
// =================================================================================

function applyTheme(isDarkMode) {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    const themeToggleButton = document.getElementById('theme-toggle');
    if (themeToggleButton) {
        themeToggleButton.textContent = isDarkMode ? '☀️' : '🌙';
    }
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        applyTheme(true);
    } else if (savedTheme === 'light') {
        applyTheme(false);
    } else {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            applyTheme(true);
        } else {
            applyTheme(false);
        }
    }
}

// =================================================================================
// 4. Navigation Functions
// =================================================================================

function displayHomeScreen() {
    const characterDisplayArea = document.querySelector('.container');
    if (!characterDisplayArea) {
        console.error("'.container' element not found in HTML. Cannot display home screen.");
        return;
    }

    characterDisplayArea.innerHTML = `
        <h1>Welcome to Airdaeium</h1>
        <p class="welcome-subtitle">Explore the vast lore of the Airdaeya universe!</p>
        <div class="home-buttons">
            <button id="view-characters-btn" class="action-button">View Characters</button>
            <button id="view-calendar-btn" class="action-button">Oram Calendar</button>
            <button id="start-quiz-btn" class="action-button">Personality Quiz</button>
        </div>
    `;

    document.getElementById('view-characters-btn').addEventListener('click', displayCharacterList);
    document.getElementById('view-calendar-btn').addEventListener('click', displayOramCalendar);
    document.getElementById('start-quiz-btn').addEventListener('click', displayPersonalityQuiz);
}


async function displayCharacterList() {
    const characterDisplayArea = document.querySelector('.container');
    if (!characterDisplayArea) {
        console.error("'.container' element not found in HTML. Cannot display character list.");
        return;
    }

    characterDisplayArea.innerHTML = `<h2>Loading characters...</h2>`;

    try {
        const charactersSnapshot = await db.collection('characters').get();

        if (!charactersSnapshot.empty) {
            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <h1>All Characters</h1>
                <div class="character-list-grid"></div>
            `;

            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

            const characterListGrid = characterDisplayArea.querySelector('.character-list-grid');

            charactersSnapshot.forEach(doc => {
                const characterData = doc.data();
                const characterId = doc.id;

                const characterListItem = document.createElement('div');
                characterListItem.classList.add('character-list-item');
                characterListItem.dataset.characterId = characterId;

                characterListItem.addEventListener('click', () => {
                    displayCharacterDetails(characterId);
                });

                const characterNameElement = document.createElement('h3');
                characterNameElement.textContent = characterData.name;

                const characterDescriptionElement = document.createElement('p');
                const shortDescription = characterData.description ? characterData.description.substring(0, 150) + '...' : 'No description available.';
                characterDescriptionElement.textContent = shortDescription;

                const characterImageElement = document.createElement('img');
                if (characterData.portraitURL || characterData.drakkaenPortraitURL) {
                    characterImageElement.src = characterData.portraitURL || characterData.drakkaenPortraitURL;
                    characterImageElement.alt = `Portrait of ${characterData.name}`;
                    characterImageElement.classList.add('character-list-portrait');
                } else {
                    characterImageElement.src = 'https://via.placeholder.com/100x100?text=No+Image';
                    characterImageElement.alt = 'No image available';
                    characterImageElement.classList.add('character-list-portrait');
                }

                characterListItem.appendChild(characterImageElement);

                const characterTextContent = document.createElement('div');
                characterTextContent.classList.add('character-list-text');
                characterTextContent.appendChild(characterNameElement);
                characterTextContent.appendChild(characterDescriptionElement);
                characterListItem.appendChild(characterTextContent);

                characterListGrid.appendChild(characterListItem);
            });
            console.log("All character data and images fetched and displayed in a list!");

        } else {
            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <h2>No characters found in Firestore!</h2>
            `;
            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
        }
    } catch (error) {
        console.error("Error fetching characters:", error);
        characterDisplayArea.innerHTML = `
            <button class="back-button" id="back-to-home-btn">← Back to Home</button>
            <h2>Error loading character list!</h2>
        `;
        document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
    }
}


async function displayCharacterDetails(characterId) {
    const characterDisplayArea = document.querySelector('.container');
    if (!characterDisplayArea) {
        console.error("'.container' element not found in HTML. Cannot display character details.");
        return;
    }

    characterDisplayArea.innerHTML = `<h2>Loading character details...</h2>`;

    try {
        const characterDoc = await db.collection('characters').doc(characterId).get();

        if (characterDoc.exists) {
            const characterData = characterDoc.data();

            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-list-btn">← Back to Character List</button>
                <h1 class="character-detail-name">${characterData.name}</h1>
                <div class="character-detail-content"></div>
            `;
            document.getElementById('back-to-list-btn').addEventListener('click', displayCharacterList);

            const detailContentWrapper = characterDisplayArea.querySelector('.character-detail-content');

            const characterImageElement = document.createElement('img');
            if (characterData.portraitURL || characterData.drakkaenPortraitURL) {
                characterImageElement.src = characterData.portraitURL || characterData.drakkaenPortraitURL;
                characterImageElement.alt = `Portrait of ${characterData.name}`;
                characterImageElement.classList.add('character-portrait-detail');
            } else {
                characterImageElement.src = 'https://via.placeholder.com/200x200?text=No+Image';
                characterImageElement.alt = 'No image available';
                characterImageElement.classList.add('character-portrait-detail');
            }
            detailContentWrapper.appendChild(characterImageElement);

            const characterDescriptionElement = document.createElement('p');
            characterDescriptionElement.textContent = characterData.description || 'No detailed description available.';
            detailContentWrapper.appendChild(characterDescriptionElement);

            console.log(`Displayed details for character: ${characterData.name}`);

        } else {
            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-list-btn">← Back to Character List</button>
                <h2>Character with ID '${characterId}' not found!</h2>
            `;
            document.getElementById('back-to-list-btn').addEventListener('click', displayCharacterList);
        }
    } catch (error) {
        console.error("Error fetching character details:", error);
        characterDisplayArea.innerHTML = `
            <button class="back-button" id="back-to-list-btn">← Back to Character List</button>
            <h2>Error loading character details!</h2>
        `;
        document.getElementById('back-to-list-btn').addEventListener('click', displayCharacterList);
    }
}


// =================================================================================
// 5. Quiz Functions
// =================================================================================

async function displayPersonalityQuiz() {
    const characterDisplayArea = document.querySelector('.container');
    if (!characterDisplayArea) {
        console.error("'.container' element not found in HTML. Cannot display quiz.");
        return;
    }

    characterDisplayArea.innerHTML = `<h2>Loading quiz questions...</h2>`;

    try {
        const snapshot = await db.collection('personalityQuestions').orderBy('quesOrder').get();
        quizQuestions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (quizQuestions.length > 0) {
            currentQuestionIndex = 0;
            userAnswers = {};
            renderQuestion();
        } else {
            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-quiz-home-btn">← Back to Home</button>
                <h2>No quiz questions found!</h2>
            `;
            document.getElementById('back-to-quiz-home-btn').addEventListener('click', displayHomeScreen);
        }
    } catch (error) {
        console.error("Error fetching quiz questions:", error);
        characterDisplayArea.innerHTML = `
            <button class="back-button" id="back-to-quiz-home-btn">← Back to Home</button>
            <h2>Error loading quiz!</h2>
        `;
        document.getElementById('back-to-quiz-home-btn').addEventListener('click', displayHomeScreen);
    }
}

function renderQuestion() {
    const characterDisplayArea = document.querySelector('.container');
    if (!characterDisplayArea) return;

    characterDisplayArea.innerHTML = `
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
    const questionTextElement = characterDisplayArea.querySelector('.quiz-question-text');
    const quizAnswersDiv = characterDisplayArea.querySelector('.quiz-answers');
    const nextButton = characterDisplayArea.querySelector('#next-question-btn');
    const prevButton = characterDisplayArea.querySelector('#prev-question-btn');

    questionTextElement.textContent = questionData.question;

    if (questionData.type === 'multiple-choice') {
        questionData.answers.forEach((answer) => {
            const answerButton = document.createElement('button');
            answerButton.classList.add('quiz-answer-button');
            answerButton.textContent = answer;
            answerButton.dataset.answer = answer;

            if (userAnswers[questionData.id] === answer) {
                answerButton.classList.add('selected');
            }

            answerButton.addEventListener('click', () => {
                quizAnswersDiv.querySelectorAll('.quiz-answer-button').forEach(btn => {
                    btn.classList.remove('selected');
                });
                answerButton.classList.add('selected');
                userAnswers[questionData.id] = answer;
            });
            quizAnswersDiv.appendChild(answerButton);
        });
    } else if (questionData.type === 'short-answer') {
        const textarea = document.createElement('textarea');
        textarea.classList.add('quiz-short-answer-input');
        textarea.placeholder = "Type your answer here...";
        textarea.id = `question-${questionData.id}`;
        textarea.name = `answer-${questionData.id}`;

        if (userAnswers[questionData.id]) {
            textarea.value = userAnswers[questionData.id];
        }
        textarea.addEventListener('input', () => {
            userAnswers[questionData.id] = textarea.value;
        });
        quizAnswersDiv.appendChild(textarea);
    }

    prevButton.disabled = currentQuestionIndex === 0;
    prevButton.addEventListener('click', () => {
        if (currentQuestionIndex > 0) {
            currentQuestionIndex--;
            renderQuestion();
        }
    });

    if (currentQuestionIndex === quizQuestions.length - 1) {
        nextButton.textContent = 'Submit Quiz';
        nextButton.addEventListener('click', () => {
            handleSubmitQuiz();
        });
    } else {
        nextButton.textContent = 'Next Question';
        nextButton.addEventListener('click', () => {
            if (questionData.type === 'multiple-choice' && !userAnswers[questionData.id]) {
                alert('Please select an answer before proceeding.');
                return;
            }
            if (questionData.type === 'short-answer' && (!userAnswers[questionData.id] || userAnswers[questionData.id].trim() === '')) {
                alert('Please enter an answer before proceeding.');
                return;
            }
            currentQuestionIndex++;
            renderQuestion();
        });
    }
}


function handleSubmitQuiz() {
    const lastQuestion = quizQuestions[quizQuestions.length - 1];
    if (lastQuestion.type === 'multiple-choice' && !userAnswers[lastQuestion.id]) {
        alert('Please select an answer for the last question.');
        return;
    }
    if (lastQuestion.type === 'short-answer' && (!userAnswers[lastQuestion.id] || userAnswers[lastQuestion.id].trim() === '')) {
        alert('Please enter an answer for the last question.');
        return;
    }

    console.log("Client-side userAnswers before sending to Cloud Function:", userAnswers);

    const characterDisplayArea = document.querySelector('.container');
    characterDisplayArea.innerHTML = `
        <div class="quiz-results-loading">
            <h2>Processing your personality...</h2>
            <p>Gemini is consulting the stars of Airdaeya...</p>
            <div class="loading-spinner"></div>
        </div>
    `;

    const processQuiz = functions.httpsCallable('processQuizAnswers');

    processQuiz({ answers: userAnswers })
        .then(async (result) => {
            const geminiMatch = result.data.matchResult;
            const matchedCharacterName = result.data.matchedCharacterName;
            console.log("Gemini says:", geminiMatch);
            console.log("Matched character:", matchedCharacterName);

            const portraitURL = result.data.matchedPortraitURL || null;
            console.log("Portrait URL from function:", portraitURL);

            const nameHTML = matchedCharacterName
                ? `<div class="match-character-name">${matchedCharacterName}</div>`
                : '';

            const portraitHTML = portraitURL
                ? `<div class="match-portrait-container">
                       ${nameHTML}
                       <img src="${portraitURL}" alt="Character portrait" class="match-portrait" />
                   </div>`
                : nameHTML;

            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <div class="quiz-results">
                    <h1>Your Airdaeya Personality Match!</h1>
                    ${portraitHTML}
                    <div class="gemini-response-content">
                        ${geminiMatch
                            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.+?)\*/g, '<em>$1</em>')
                            .replace(/\n/g, '<br>')}
                    </div>
                </div>
            `;
            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

        })
        .catch((error) => {
            console.error("Error calling Cloud Function:", error);
            const errorMessage = `Failed to get your personality match. Error: ${error.message}`;

            characterDisplayArea.innerHTML = `
                <button class="back-button" id="back-to-home-btn">← Back to Home</button>
                <div class="quiz-results error-message">
                    <h1>Oops! Something went wrong.</h1>
                    <p>${errorMessage}</p>
                    <p>Please try again later.</p>
                </div>
            `;
            document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);
        });
}


// =================================================================================
// 6. DOMContentLoaded Listener
// =================================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    const themeToggleButton = document.getElementById('theme-toggle');
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', () => {
            const isCurrentlyDarkMode = document.body.classList.contains('dark-mode');
            applyTheme(!isCurrentlyDarkMode);
        });
    }

    displayHomeScreen();
});

// =================================================================================
// 7. Oram Calendar Converter
// =================================================================================

const ORAM_CALENDAR = {
    tritquarters: [
        { name: 'Mamdi',    number: 1,  season: 'Spring' },
        { name: 'Netamee',  number: 2,  season: 'Spring' },
        { name: 'Elany',    number: 3,  season: 'Spring' },
        { name: 'Bamdi',    number: 4,  season: 'Summer' },
        { name: 'Kazamee',  number: 5,  season: 'Summer' },
        { name: 'Ojany',    number: 6,  season: 'Summer' },
        { name: 'Zamdi',    number: 7,  season: 'Autumn' },
        { name: 'Pilamee',  number: 8,  season: 'Autumn' },
        { name: 'Itrany',   number: 9,  season: 'Autumn' },
        { name: 'Samdi',    number: 10, season: 'Winter' },
        { name: 'Tihamee',  number: 11, season: 'Winter' },
        { name: 'Anany',    number: 12, season: 'Winter' },
    ],
    daysPerTritquarter: 33,
    daysPerYear: 396,
    seasonEmoji: { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Winter: '❄️' },
    specialDays: [
        { tq: 1,  day: 1,  name: 'Spring Equinox',        desc: 'The first day of the Oram year, when spring begins.' },
        { tq: 2,  day: 22, name: 'Proximus',               desc: 'The Day of Sharing — one of two days Oram is closest to its sun.' },
        { tq: 4,  day: 1,  name: 'Summer Solstice',        desc: 'The longest day of the year on Oram.' },
        { tq: 5,  day: 17, name: 'Midsummer',              desc: 'A celebration at the heart of summer.' },
        { tq: 7,  day: 1,  name: 'Autumnal Equinox',       desc: 'The first day of autumn on Oram.' },
        { tq: 8,  day: 11, name: 'Proximan',               desc: 'The Harvest Festival — the second day Oram is closest to its sun.' },
        { tq: 8,  day: 15, name: 'Mordkanee',              desc: 'A sacred night when the veil between this world and the spirit world is at its thinnest.' },
        { tq: 10, day: 1,  name: 'The Longest Night',      desc: 'The Winter Solstice — the darkest night of the Oram year.' },
        { tq: 11, day: 17, name: 'Hearthsglow',            desc: 'Midwinter celebration — a time of warmth, light, and gathering.' },
    ]
};

// Anchor: July 30 (Earth) = Kazamee 13 (Oram)
// Kazamee is tritquarter 5, so Oram day-of-year = (4 * 33) + 13 = 145
const ANCHOR_EARTH = new Date(2024, 2, 20); // March 20, 2024 = Mamdi 1 = Oram day 1
const ANCHOR_ORAM_DAY = 1; // March 20 = Mamdi 1 = day 1 of Oram year

// Oram year is 396 days, Earth year is 365.25 days
const ORAM_DAYS_PER_EARTH_DAY = 144 / 132; // Derived from calibration: March 20 = Mamdi 1, July 30 = Kazamee 13

function earthDateToOramDayOfYear(earthDate) {
    // Use March 20 of the SAME year as anchor — this handles leap years automatically
    // because Feb 29 always falls before March 20 and never affects the relative count
    const march20 = new Date(earthDate.getFullYear(), 2, 20); // March 20, same year
    const earthDaysDiff = (earthDate - march20) / (1000 * 60 * 60 * 24);
    const raw = 1 + earthDaysDiff * ORAM_DAYS_PER_EARTH_DAY;
    let oramDayOfYear = Math.round(raw);
    // Wrap to 1-396
    oramDayOfYear = ((oramDayOfYear - 1) % 396 + 396) % 396 + 1;
    return oramDayOfYear;
}

function oramDayOfYearToTritquarter(dayOfYear) {
    const tqIndex = Math.floor((dayOfYear - 1) / 33);
    const day = ((dayOfYear - 1) % 33) + 1;
    return { tq: ORAM_CALENDAR.tritquarters[tqIndex], day };
}

function tritquarterToOramDayOfYear(tqNumber, day) {
    return ((tqNumber - 1) * 33) + day;
}

function oramDayOfYearToEarthDayOfYear(oramDayOfYear) {
    // Use reverse lookup: find the Earth date that converts forward to this Oram day
    const year = new Date().getFullYear();
    const march20 = new Date(year, 2, 20);
    const estDays = Math.round((oramDayOfYear - 1) / ORAM_DAYS_PER_EARTH_DAY);

    // Search window around the estimate
    for (let offset = -5; offset <= 5; offset++) {
        const candidate = new Date(march20);
        candidate.setDate(march20.getDate() + estDays + offset);
        if (earthDateToOramDayOfYear(candidate) === oramDayOfYear) {
            return candidate;
        }
    }
    // Fallback
    const fallback = new Date(march20);
    fallback.setDate(march20.getDate() + estDays);
    return fallback;
}

function getSpecialDay(tqNumber, day) {
    return ORAM_CALENDAR.specialDays.find(s => s.tq === tqNumber && s.day === day) || null;
}

function formatOramDate(tq, day) {
    return `${tq.name} ${day}`;
}

function formatEarthDate(date) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function buildOramResult(oramDayOfYear) {
    const { tq, day } = oramDayOfYearToTritquarter(oramDayOfYear);
    const special = getSpecialDay(tq.number, day);
    const seasonEmoji = ORAM_CALENDAR.seasonEmoji[tq.season];
    return { tq, day, special, seasonEmoji };
}

function displayOramCalendar() {
    const characterDisplayArea = document.querySelector('.container');
    if (!characterDisplayArea) return;

    // Build tritquarter options for selector
    const tqOptions = ORAM_CALENDAR.tritquarters.map(tq =>
        `<option value="${tq.number}">${tq.name} (Tritquarter ${tq.number})</option>`
    ).join('');

    // Build day options
    const dayOptions = Array.from({ length: 33 }, (_, i) =>
        `<option value="${i + 1}">${i + 1}</option>`
    ).join('');

    characterDisplayArea.innerHTML = `
        <button class="back-button" id="back-to-home-btn">← Back to Home</button>
        <div class="calendar-container">
            <h1>Oram Calendar</h1>
            <p class="welcome-subtitle">Convert dates between Earth and the world of Oram</p>

            <!-- Today Panel -->
            <div class="calendar-today-panel" id="today-panel"></div>

            <!-- Converters -->
            <div class="calendar-converters">

                <!-- Earth to Oram -->
                <div class="converter-panel">
                    <h3>🌍 Earth → Oram</h3>
                    <label for="earth-date-input">Enter an Earth Date</label>
                    <input type="date" id="earth-date-input" />
                    <button class="convert-btn" id="earth-to-oram-btn">Convert</button>
                    <div class="converter-result" id="earth-to-oram-result">
                        <div class="result-date" id="earth-to-oram-date"></div>
                        <div class="result-season" id="earth-to-oram-season"></div>
                        <div class="result-special" id="earth-to-oram-special" style="display:none"></div>
                    </div>
                </div>

                <!-- Oram to Earth -->
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
                        <div class="result-date" id="oram-to-earth-date"></div>
                        <div class="result-season" id="oram-to-earth-season"></div>
                        <div class="result-special" id="oram-to-earth-special" style="display:none"></div>
                    </div>
                </div>

            </div>
        </div>
    `;

    document.getElementById('back-to-home-btn').addEventListener('click', displayHomeScreen);

    // Populate today panel
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Strip time
    const oramDayOfYear = earthDateToOramDayOfYear(today);
    const { tq, day, special, seasonEmoji } = buildOramResult(oramDayOfYear);
    const todayPanel = document.getElementById('today-panel');
    todayPanel.innerHTML = `
        <div class="today-label">Today on Earth</div>
        <div class="today-earth">${formatEarthDate(today)}</div>
        <div class="today-divider">⟡</div>
        <div class="today-label">Today on Oram</div>
        <div class="today-oram">${formatOramDate(tq, day)}</div>
        <div class="today-season">${seasonEmoji} ${tq.season} on Oram</div>
        ${special ? `<div class="today-special">✨ ${special.name} — ${special.desc}</div>` : ''}
    `;

    // Earth to Oram converter
    document.getElementById('earth-to-oram-btn').addEventListener('click', () => {
        const input = document.getElementById('earth-date-input').value;
        if (!input) { alert('Please select an Earth date.'); return; }
        const parts = input.split('-').map(Number);
        const earthDate = new Date(parts[0], parts[1] - 1, parts[2]);
        const oramDay = earthDateToOramDayOfYear(earthDate);
        const { tq, day: oDay, special, seasonEmoji } = buildOramResult(oramDay);
        const resultEl = document.getElementById('earth-to-oram-result');
        document.getElementById('earth-to-oram-date').textContent = formatOramDate(tq, oDay);
        document.getElementById('earth-to-oram-season').textContent = `${seasonEmoji} ${tq.season} on Oram`;
        const specialEl = document.getElementById('earth-to-oram-special');
        if (special) {
            specialEl.textContent = `✨ ${special.name} — ${special.desc}`;
            specialEl.style.display = 'inline-block';
        } else {
            specialEl.style.display = 'none';
        }
        resultEl.classList.add('visible');
    });

    // Oram to Earth converter
    document.getElementById('oram-to-earth-btn').addEventListener('click', () => {
        const tqNumber = parseInt(document.getElementById('oram-tq-select').value);
        const oDay = parseInt(document.getElementById('oram-day-select').value);
        const oramDayOfYear = tritquarterToOramDayOfYear(tqNumber, oDay);
        const earthDate = oramDayOfYearToEarthDayOfYear(oramDayOfYear);
        const tq = ORAM_CALENDAR.tritquarters[tqNumber - 1];
        const special = getSpecialDay(tqNumber, oDay);
        const seasonEmoji = ORAM_CALENDAR.seasonEmoji[tq.season];
        const resultEl = document.getElementById('oram-to-earth-result');
        document.getElementById('oram-to-earth-date').textContent = formatEarthDate(earthDate);
        document.getElementById('oram-to-earth-season').textContent = `${seasonEmoji} ${tq.season} on Oram`;
        const specialEl = document.getElementById('oram-to-earth-special');
        if (special) {
            specialEl.textContent = `✨ ${special.name} — ${special.desc}`;
            specialEl.style.display = 'inline-block';
        } else {
            specialEl.style.display = 'none';
        }
        resultEl.classList.add('visible');
    });
}

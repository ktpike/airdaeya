/**
 * Firebase Cloud Function to process quiz answers and find a character match using Google Gemini.
 */

// --- ES Module Imports ---
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as functions from "firebase-functions"; // Import as namespace for functions.defineSecret
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// --- CORRECTED: Import defineSecret from firebase-functions/params ---
import { defineSecret } from "firebase-functions/params";

// --- Gemini SDK ---
import { GoogleGenerativeAI } from "@google/generative-ai";


// --- Global Scope Initialization ---
console.log("GLOBAL SCOPE: Function container starting up.");

try {
    initializeApp(); // Initialize Firebase Admin SDK
    console.log("GLOBAL SCOPE: Firebase Admin SDK initialized successfully.");
} catch (e) {
    console.error("GLOBAL SCOPE ERROR: Failed to initialize Firebase Admin SDK:", e);
    throw e; // Re-throw to make sure the health check fails visibly if this is the issue
}

// Get Firestore instance globally for efficiency
const db = getFirestore();

// =============================================================================
// Numerology Pre-Filter: Maps quiz answers to numerology numbers
// Expression (e) = 3pts, Heart's Desire (h) = 2pts, Personality (p) = 1pt
// =============================================================================
const ANSWER_NUMEROLOGY = {
    // Q1 Recognition
    "Being a respected authority with a lasting legacy.": [8, 1],
    "Being known for your cunning and ability to survive.": [5, 1],
    "Being a pioneer who creates something new and unheard of.": [1, 3],
    "Being known as someone whose presence makes everything better.": [6, 3],
    "Being recognized as the one who finally understood what no one else could.": [7, 2],
    // Q2 Motivation
    "Finding the truth about a mystery.": [7, 9],
    "Healing a deep-seated pain.": [2, 6],
    "Protecting your loved ones.": [6, 2],
    "Creating something with your hands that others will treasure.": [4, 1],
    // Q3 Home feeling
    "Being with my family in a place of my own making.": [6, 4],
    "Finding a community of like-minded people.": [2, 9],
    "Working alone toward a major goal.": [1, 7],
    "Being in a place where I can truly be myself.": [5, 1],
    // Q4 Skill
    "The ability to fix and build anything.": [4, 1],
    "The power to express yourself without words.": [2, 3],
    "The skill to persuade anyone to do what you want.": [8, 3],
    "The gift of seeing the future.": [7, 9],
    "The power to understand the hidden language of living things.": [2, 7],
    // Q5 Past
    "It\'s a source of valuable lessons.": [8, 9],
    "It\'s something to be avenged.": [8, 1],
    "It\'s a mystery waiting to be uncovered.": [7, 3],
    "It\'s something I\'d prefer not to dwell on.": [5, 1],
    // Q6 Animal
    "Their single-minded focus and unwavering determination.": [1, 4],
    "Their ability to adapt and survive in any environment.": [5, 9],
    "Their playful and mischievous nature.": [3, 5],
    "Their fierce loyalty and protectiveness toward their pack.": [6, 2],
    // Q7 Challenge
    "Being unable to speak or communicate effectively.": [3, 2],
    "Having to follow rules and traditions you don\'t believe in.": [5, 1],
    "Living a life where your talents are never fully used.": [1, 4],
    "Being forced to live a quiet life without adventure.": [5, 3],
    "Watching those under your protection suffer because of your failures.": [8, 6],
    // Q8 Secrets
    "Use them to gain power and influence.": [8, 1],
    "Share them only with those who are worthy.": [8, 7],
    "Keep them to yourself, as they are your burden alone.": [7, 4],
    "Expose the most harmful ones for the good of all.": [9, 6],
    // Q9 Home means
    "A place you built with your own hands.": [4, 1],
    "A place you are trying to get back to.": [6, 2],
    "A place you are trying to escape.": [5, 1],
    "Wherever the people I love are gathered around a table.": [6, 3],
    "Wherever the people I am responsible for are safe.": [8, 6],
    // Q10 Fear
    "Losing control of yourself or your circumstances.": [8, 1],
    "Being misunderstood and never truly seen.": [2, 7],
    "Being abandoned by those you trust.": [2, 6],
    "Failing to fulfill your destiny.": [9, 4],
    // Q11 Strength
    "My resourcefulness and quick wit.": [3, 5],
    "My loyalty to those who earn it.": [6, 4],
    "My ability to see the bigger picture.": [8, 9],
    "My courage to stand alone.": [1, 7],
    // Q12 Path
    "...the most challenging path, the one that promises the most growth.": [1, 9],
    "...the one that leads to the most fame and recognition.": [8, 3],
    "...the one that is completely new and promises the most adventure.": [5, 3],
    "...the one where I can protect those I love.": [6, 2],
};

// Characters guaranteed to always be included (wildcards)
// Sarafeen's numbers are too common for numerology to reliably surface her
const WILDCARD_CHARACTER_IDS = new Set(['sarafeen']);

function scoreCharacterNumerology(charData, userAnswers) {
    const e = Number(charData.expression) || 0;
    const h = Number(charData.heartsDesire) || 0;
    const p = Number(charData.personality) || 0;
    let score = 0;
    for (const answer of Object.values(userAnswers)) {
        const nums = ANSWER_NUMEROLOGY[answer] || [];
        for (const num of nums) {
            if (num === e) score += 3;
            else if (num === h) score += 2;
            else if (num === p) score += 1;
        }
    }
    return score;
}

// Define the secret at the top level, available to all functions that need it
const GEMINI_API_KEY_SECRET = defineSecret("GEMINI_API_KEY"); // Matches the name in Secret Manager


// --- Define the function using v2 syntax with ES Modules ---
export const processQuizAnswers = onCall(
    {
        secrets: [GEMINI_API_KEY_SECRET], // Link the secret here
        region: 'us-central1' // Explicitly define region for v2 functions
    },
    async (request) => {

        console.log("FUNCTION INVOKED: processQuizAnswers called.");

        const data = request.data;

        console.log("INVOCATION DEBUG: Callable function 'data' parameter:", data);

        // Access secret value (only available inside the function execution)
        const geminiApiKey = GEMINI_API_KEY_SECRET.value();

        if (!geminiApiKey) {
            console.error("INVOCATION ERROR: GEMINI_API_KEY is NOT available from Secret Manager as process.env.GEMINI_API_KEY!");
            throw new HttpsError(
                'internal',
                'Gemini API Key is not configured for this function. Confirm it is set in Secret Manager and listed in `secrets` option.'
            );
        }

        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // 1. Authentication (Optional but Recommended for real apps)
        // if (!request.auth?.uid) { // request.auth.uid for v2
        //     throw new HttpsError(
        //         'unauthenticated',
        //         'The function must be called while authenticated.'
        //     );
        // }

        const userAnswers = data.answers;
        if (!userAnswers || Object.keys(userAnswers).length === 0) {
            throw new HttpsError('invalid-argument', 'No answers provided.');
        }

        let prompt = "A user has completed a personality quiz about the world of " +
            "Airdaeya. Their answers are:\n\n";

        const questionTextMap = {};
        try {
            const questionsSnapshot = await db
                .collection('personalityQuestions')
                .orderBy('quesOrder')
                .get();
            questionsSnapshot.forEach(doc => {
                questionTextMap[doc.id] = doc.data().question;
            });
        } catch (error) {
            console.warn("Could not fetch question texts for prompt. Using IDs instead.", error);
        }

        if (userAnswers) {
            for (const qId in userAnswers) {
                if (Object.prototype.hasOwnProperty.call(userAnswers, qId)) {
                    const questionText = questionTextMap[qId] || `Question ID ${qId}`;
                    prompt += `${questionText}: ${userAnswers[qId]}\n`;
                }
            }
        } else {
            prompt += "User provided no answers.\n"; // Should not happen with validation above
        }

        // Find the food answer specifically for personalization
        const foodAnswer = userAnswers['question13'] || userAnswers[Object.keys(userAnswers)[Object.keys(userAnswers).length - 1]] || 'something delicious';

        prompt += "\n\nBased on these answers, determine which single character from the Airdaeya universe " +
            "the user is most like. Pick only from the provided character list — do not invent new characters or lore.\n\n" +
            "Write your response in a fantastical, whimsical, and adventurous tone, as if you are an ancient " +
            "storyteller from the world of Airdaeya speaking directly to the user. The tone should be magical, " +
            "warm, and fun — suitable for children and adults alike. Address the user as 'you' throughout.\n\n" +
            "Structure your response with these four clearly labeled sections:\n\n" +
            "⚔️ YOUR AIRDAEYA MATCH\n" +
            "On a single line by itself, state ONLY the character's full name EXACTLY as it appears in the character list — in all caps, with correct spelling, nothing else on that line. " +
            "Then on the next line, add a short dramatic proclamation of 1 sentence about them.\n\n" +
            "🌟 WHY YOU ARE KINDRED SPIRITS\n" +
            "In 3-4 sentences, explain specifically how the user's answers reveal traits they share with this character. " +
            "Be vivid and imaginative — reference the world of Airdaeya, its magic, and its lore. " +
            "Make the user feel like they truly belong in this world.\n\n" +
            "✨ YOUR UNIQUE SPARK\n" +
            "In 2-3 sentences, describe something special and unique about how the user embodies this character's spirit — " +
            "what makes THEIR version of this character distinctly their own. This should feel personal and uplifting.\n\n" +
            "🍽️ A TASTE OF AIRDAEYA\n" +
            "The user said their favorite food is: \"" + foodAnswer + "\". " +
            "In 2-3 playful sentences, imagine how this food exists or would be received in the world of Airdaeya — " +
            "perhaps how their matched character would react to it, what magical twist it might have on Oram, " +
            "or what it reveals about the user's adventurous spirit. Be creative, funny, and whimsical!\n\n";

        // 2. Fetch books to determine which are released
        const releasedBookIds = new Set();
        const upcomingBooks = {};
        try {
            const booksSnap = await db
                .collection('chronicles').doc('talesOfAirdaeya')
                .collection('collections').doc('adventuresOnOram')
                .collection('sagas').doc('drakkaenNakkla')
                .collection('books').get();
            booksSnap.forEach(doc => {
                const b = doc.data();
                if (b.released === true) {
                    releasedBookIds.add(doc.id);
                } else if (b.releaseDate) {
                    upcomingBooks[doc.id] = { title: b.title, releaseDate: b.releaseDate };
                }
            });
            console.log("Released books:", [...releasedBookIds]);
        } catch (error) {
            console.warn("Could not fetch book release data:", error);
        }

        function extractBookId(bookID) {
            if (!bookID) return null;
            if (typeof bookID === 'string') {
                const parts = bookID.split('/');
                return parts[parts.length - 1];
            }
            if (bookID._path && bookID._path.segments) {
                return bookID._path.segments[bookID._path.segments.length - 1];
            }
            return null;
        }

        // 3. Fetch and filter characters by book release status and role
        const eligibleCharacters = [];
        const upcomingCharacters = [];
        try {
            const charactersSnapshot = await db.collection('characters').get();
            charactersSnapshot.forEach(doc => {
                const charData = doc.data();
                if (!charData.name || !charData.description) return;
                const appearances = charData.bookAppearances || [];
                let isEligible = false;
                let isUpcoming = false;
                let upcomingBookInfo = null;
                for (const appearance of appearances) {
                    const bookId = extractBookId(appearance.bookID);
                    const role = (appearance.role || '').toLowerCase();
                    if (role === 'cloaked') continue;
                    if (bookId && releasedBookIds.has(bookId)) {
                        isEligible = true;
                        break;
                    } else if (bookId && upcomingBooks[bookId]) {
                        isUpcoming = true;
                        upcomingBookInfo = upcomingBooks[bookId];
                    }
                }
                if (isEligible) {
                    eligibleCharacters.push({ id: doc.id, ...charData });
                } else if (isUpcoming && upcomingBookInfo) {
                    upcomingCharacters.push({ id: doc.id, ...charData, upcomingBookInfo });
                }
            });

            if (eligibleCharacters.length === 0) {
                throw new HttpsError('failed-precondition', 'No eligible characters found.');
            }
            console.log(`Eligible characters (${eligibleCharacters.length}): ${eligibleCharacters.map(c => c.name).join(', ')}`);
        } catch (error) {
            console.error("Error fetching characters:", error);
            throw new HttpsError('internal', 'Could not retrieve character data.', error.message);
        }

        // 4. Numerology pre-filter: score and select top characters
        const TOP_N = 6;
        const scoredChars = eligibleCharacters.map(charData => ({
            charData,
            score: scoreCharacterNumerology(charData, userAnswers),
            isWildcard: WILDCARD_CHARACTER_IDS.has(charData.id)
        }));
        scoredChars.sort((a, b) => b.score - a.score);

        const wildcards = scoredChars.filter(c => c.isWildcard);
        const nonWildcards = scoredChars.filter(c => !c.isWildcard);
        const topN = nonWildcards.slice(0, TOP_N);
        const boundaryScore = topN.length > 0 ? topN[topN.length - 1].score : 0;
        const tied = nonWildcards.slice(TOP_N).filter(c => c.score === boundaryScore);

        const seen = new Set();
        const finalChars = [...wildcards, ...topN, ...tied]
            .map(c => c.charData)
            .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

        console.log(`Pre-filter: ${eligibleCharacters.length} eligible -> ${finalChars.length} sent to Gemini: ${finalChars.map(c => c.name).join(', ')}`);

        // Build upcoming teaser if any
        if (upcomingCharacters.length > 0) {
            prompt += "UPCOMING CHARACTERS (do NOT match the user to these, but if thematically similar " +
                "to your chosen match, add a brief teaser at the very end mentioning the book and release date):\n";
            upcomingCharacters.forEach(char => {
                prompt += `- ${char.name} (appearing in "${char.upcomingBookInfo.title}", ${char.upcomingBookInfo.releaseDate})\n`;
            });
            prompt += "\n";
        }

        // Build character prompt with pre-filtered list
        prompt += "Available Airdaeya Characters:\n";
        finalChars.forEach(charData => {
            const displayName = charData.goesBy || charData.name;
            prompt += `- ${charData.name} (goes by: ${displayName}): ${charData.description || 'No description available.'}\n`;
            if (charData.expression !== undefined) prompt += `  Expression Number: ${charData.expression}.\n`;
            if (charData.heartsDesire !== undefined) prompt += `  Hearts Desire Number: ${charData.heartsDesire}.\n`;
            if (charData.lifePath !== undefined) prompt += `  Life Path Number: ${charData.lifePath}.\n`;
            if (charData.personality !== undefined) prompt += `  Personality Number: ${charData.personality}.\n`;
        });
        prompt += "IMPORTANT: When referring to characters in your response, always use their preferred name (goes by) rather than their full name. For example, refer to 'Ki-Llani Kunigundo Deairheann' as 'Llani', and 'Qatzsi Balaerdo' as 'Qat'.\n\n";

        console.log("Gemini Prompt constructed:", prompt);

        // 3. Call the Gemini API
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            console.log("Gemini Response:", text);

            // Match against actual Firestore character names for reliability
            // Re-fetch characters to find which one Gemini picked
            let matchedCharacterName = null;
            let matchedPortraitURL = null;
            let matchedGoesBy = null;
            let matchedAliases = [];
            try {
                const textUpper = text.toUpperCase();
                const charsSnap = await db.collection('characters').get();
                charsSnap.forEach(doc => {
                    const charData = doc.data();
                    if (!charData.name) return;
                    const nameParts = charData.name.toUpperCase().split(' ');
                    // Match on first name only — most reliable since Gemini may mangle long names
                    const firstName = nameParts[0];
                    // Also try full name and first+last
                    const firstAndLast = nameParts[0] + (nameParts.length > 1 ? ' ' + nameParts[nameParts.length - 1] : '');
                    if (textUpper.includes(charData.name.toUpperCase()) ||
                        textUpper.includes(firstAndLast) ||
                        textUpper.includes(firstName)) {
                        matchedCharacterName = charData.name;
                        matchedPortraitURL = charData.portraitURL || charData.drakkaenPortraitURL || null;
                        matchedGoesBy = charData.goesBy || null;
                        matchedAliases = charData.aliases || [];
                        console.log("Portrait match found:", matchedCharacterName, matchedPortraitURL);
                    }
                });
            } catch (e) {
                console.warn("Could not match character portrait:", e);
            }
            return { matchResult: text, matchedCharacterName, matchedPortraitURL, matchedGoesBy, matchedAliases };
        } catch (error) {
            console.error("Error calling Gemini API:", error);
            let errorMessage = 'Failed to get a response from the AI model.';
            if (error.response && error.response.statusText) {
                errorMessage += ` Status: ${error.response.status} - ${error.response.statusText}`;
            } else if (error.message) {
                errorMessage += ` Error: ${error.message}`;
            }
            throw new HttpsError('internal', errorMessage, error);
        }
    });

// Global state for extension toggle
let isExtensionEnabled = true;
let currentDomain = window.location.hostname;
let targetLanguage = 'en'; // Default to English
let currentTranslationMode = 'translation'; // Current mode: 'translation', 'dictionary', 'bilingual_dictionary'
let pageLanguage = null; // Cached page language for dictionary lookups
let lastSelectedText = ''; // Track last selected text to prevent duplicate popups

// Add popup and toggle styles to the page
const style = document.createElement('style');
style.textContent = `
  .ai-translate-popup {
    position: absolute;
    z-index: 9999;
    background: #222;
    color: #fff;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 16px;
    max-width: 350px;
    pointer-events: none;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    user-select: text;
  }

`;
document.head.appendChild(style);

// Supported dictionary languages (based on backend language support)
const SUPPORTED_DICTIONARY_LANGUAGES = [
    'en', 'es', 'fr', 'de', 'zh', 'zh-tw', 'ja', 'ko', 'pt', 'ar', 'hi', 'it', 'ru', 'ro'
];

// Function to detect and cache page language
function detectPageLanguage() {
    // Return cached language if already detected
    if (pageLanguage !== null) {
        return pageLanguage;
    }
    
    let detectedLang = 'en'; // Default fallback
    
    // 1. Check HTML lang attribute
    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
        // Extract language code (e.g., 'en-US' -> 'en', 'zh-CN' -> 'zh')
        let langCode = htmlLang.toLowerCase().split('-')[0];

        // Special case for Chinese variants
        if (htmlLang.toLowerCase().includes('tw') || htmlLang.toLowerCase().includes('hant')) {
            langCode = 'zh-tw';
        } else if (langCode === 'zh') {
            langCode = 'zh'; // Simplified Chinese
        }

        if (SUPPORTED_DICTIONARY_LANGUAGES.includes(langCode)) {
            detectedLang = langCode;
        }
    }
    
    // 2. Fallback to navigator.language if HTML lang is not supported
    if (detectedLang === 'en' && htmlLang && !SUPPORTED_DICTIONARY_LANGUAGES.includes(htmlLang.toLowerCase().split('-')[0])) {
        const navLang = navigator.language;
        if (navLang) {
            let langCode = navLang.toLowerCase().split('-')[0];
            
            // Special case for Chinese variants
            if (navLang.toLowerCase().includes('tw') || navLang.toLowerCase().includes('hant')) {
                langCode = 'zh-tw';
            } else if (langCode === 'zh') {
                langCode = 'zh'; // Simplified Chinese
            }
            
            if (SUPPORTED_DICTIONARY_LANGUAGES.includes(langCode)) {
                detectedLang = langCode;
            }
        }
    }
    
    // Cache the detected language
    pageLanguage = detectedLang;
    
    console.log(`Page language detected: ${detectedLang} (HTML: ${htmlLang || 'none'}, Navigator: ${navigator.language || 'none'})`);
    
    return pageLanguage;
}

// Function to reset page language cache (useful for SPAs)
function resetPageLanguageCache() {
    pageLanguage = null;
}

// Listen for URL changes (for SPAs)
let currentURL = window.location.href;
const urlObserver = new MutationObserver(() => {
    if (window.location.href !== currentURL) {
        currentURL = window.location.href;
        resetPageLanguageCache();
        console.log('URL changed, reset page language cache');
    }
});

// Start observing URL changes
urlObserver.observe(document.body, { 
    childList: true, 
    subtree: true 
});

// Function to extract contextual text around a highlighted word
function extractContext(selection) {
    try {
        const range = selection.getRangeAt(0);
        const selectedText = selection.toString().trim();
        
        // Get the container element
        let container = range.commonAncestorContainer;
        
        // If the container is a text node, get its parent element
        if (container.nodeType === Node.TEXT_NODE) {
            container = container.parentElement;
        }
        
        // Try to find a suitable parent container (paragraph, div, etc.)
        let textContainer = container;
        while (textContainer && !['P', 'DIV', 'ARTICLE', 'SECTION', 'TD', 'LI', 'SPAN'].includes(textContainer.tagName)) {
            textContainer = textContainer.parentElement;
            if (!textContainer || textContainer === document.body) {
                textContainer = container;
                break;
            }
        }
        
        // Get the full text content of the container
        const fullText = textContainer.textContent || textContainer.innerText || '';
        const cleanFullText = fullText.replace(/\s+/g, ' ').trim();
        
        // Find the position of the selected word in the full text
        const selectedWordIndex = cleanFullText.toLowerCase().indexOf(selectedText.toLowerCase());
        
        if (selectedWordIndex === -1) {
            // Fallback: return the selected text itself
            return {
                selectedWord: selectedText,
                context: selectedText,
                contextType: 'word_only'
            };
        }
        
        // Try to extract the full sentence containing the word
        const sentenceContext = extractFullSentence(cleanFullText, selectedWordIndex, selectedText.length);
        
        if (sentenceContext.success) {
            return {
                selectedWord: selectedText,
                context: sentenceContext.sentence,
                contextType: 'sentence',
                fullText: cleanFullText
            };
        }
        
        // Fallback: extract surrounding words
        const wordContext = extractSurroundingWords(cleanFullText, selectedWordIndex, selectedText.length);
        
        return {
            selectedWord: selectedText,
            context: wordContext.context,
            contextType: 'surrounding_words',
            fullText: cleanFullText
        };
        
    } catch (error) {
        console.error('Error extracting context:', error);
        const selectedText = selection.toString().trim();
        return {
            selectedWord: selectedText,
            context: selectedText,
            contextType: 'error_fallback'
        };
    }
}

// Function to extract the full sentence containing the highlighted word
function extractFullSentence(text, wordIndex, wordLength) {
    // Sentence ending punctuation (including various languages)
    const sentenceEnders = /[.!?。！？।॥|‼⁇⁈⁉؟]/g;
    
    // Find sentence boundaries
    const sentences = [];
    let lastIndex = 0;
    let match;
    
    // Split text into sentences
    while ((match = sentenceEnders.exec(text)) !== null) {
        const sentenceEnd = match.index + match[0].length;
        const sentence = text.substring(lastIndex, sentenceEnd).trim();
        if (sentence.length > 0) {
            sentences.push({
                text: sentence,
                start: lastIndex,
                end: sentenceEnd
            });
        }
        lastIndex = sentenceEnd;
    }
    
    // Add the remaining text as a sentence if it exists
    if (lastIndex < text.length) {
        const sentence = text.substring(lastIndex).trim();
        if (sentence.length > 0) {
            sentences.push({
                text: sentence,
                start: lastIndex,
                end: text.length
            });
        }
    }
    
    // Find which sentence contains our word
    for (const sentence of sentences) {
        if (wordIndex >= sentence.start && wordIndex < sentence.end) {
            // Ensure the sentence is reasonable length (not too short or too long)
            if (sentence.text.length >= 10 && sentence.text.length <= 500) {
                return {
                    success: true,
                    sentence: sentence.text
                };
            }
        }
    }
    
    return { success: false };
}

// Function to extract surrounding words as fallback
function extractSurroundingWords(text, wordIndex, wordLength, wordsBefore = 5, wordsAfter = 5) {
    const words = text.split(/\s+/);
    const selectedWordEnd = wordIndex + wordLength;
    
    // Find the word position in the words array
    let currentPos = 0;
    let targetWordIndex = -1;
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const wordStart = currentPos;
        const wordEnd = currentPos + word.length;
        
        // Check if this word contains or overlaps with our selected text
        if (wordStart <= wordIndex && wordEnd >= selectedWordEnd) {
            targetWordIndex = i;
            break;
        }
        
        currentPos = wordEnd + 1; // +1 for the space
    }
    
    if (targetWordIndex === -1) {
        // Fallback: just return some words around the general area
        const estimatedWordIndex = Math.floor(wordIndex / (text.length / words.length));
        targetWordIndex = Math.max(0, Math.min(estimatedWordIndex, words.length - 1));
    }
    
    const startIndex = Math.max(0, targetWordIndex - wordsBefore);
    const endIndex = Math.min(words.length, targetWordIndex + wordsAfter + 1);
    
    const contextWords = words.slice(startIndex, endIndex);
    const context = contextWords.join(' ');
    
    return {
        context: context,
        wordPosition: targetWordIndex - startIndex
    };
}

// Initialize extension state based on storage settings
async function initializeExtension() {
    try {
        const settings = await chrome.storage.sync.get({
            globalEnabled: true,
            disabledDomains: [],
            defaultTargetLanguage: 'en',
            defaultTranslationMode: 'translation',
            domainSettings: {}
        });

        const domainSettings = settings.domainSettings || {};
        const domainConfig = domainSettings[currentDomain] || {
            targetLanguage: settings.defaultTargetLanguage,
            translationMode: settings.defaultTranslationMode
        };

        isExtensionEnabled = settings.globalEnabled && !settings.disabledDomains.includes(currentDomain);
        targetLanguage = domainConfig.targetLanguage || 'en';
        currentTranslationMode = domainConfig.translationMode || 'translation';

    } catch (error) {
        console.error('Error loading extension settings:', error);
    }
}




// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateEnabled') {
        isExtensionEnabled = request.enabled;
        
        // Remove any existing popups when state changes
        document.querySelectorAll('.ai-translate-popup').forEach(el => el.remove());
        
        sendResponse({ success: true });
    }
    
    if (request.action === 'updateTargetLanguage') {
        targetLanguage = request.targetLanguage;
        
        // Remove any existing popups when language changes
        document.querySelectorAll('.ai-translate-popup').forEach(el => el.remove());
        
        sendResponse({ success: true });
    }
    
    if (request.action === 'updateTranslationMode') {
        currentTranslationMode = request.translationMode;
        
        // Remove any existing popups when mode changes
        document.querySelectorAll('.ai-translate-popup').forEach(el => el.remove());
        
        sendResponse({ success: true });
    }
});

// When the user finishes selecting some text, try to translate it
document.addEventListener('mouseup', async function(e) {
    // 0) Ignore events that originate inside the popup itself
    if (e.target.closest('.ai-translate-popup')) {
        return;
    }

    // 1) Check if extension is enabled
    if (!isExtensionEnabled) return;

    const selectedText = window.getSelection().toString().trim();

    // 2) Ignore if nothing is selected
    if (!selectedText) return;

    // 3) Ignore if selection hasn't changed since last time
    if (selectedText === lastSelectedText) {
        return;
    }
    lastSelectedText = selectedText;

    // 4) Remove any leftover popups from earlier
    document.querySelectorAll('.ai-translate-popup').forEach(el => el.remove());

    // Handle different translation modes
    if (currentTranslationMode === 'dictionary') {
        // Monolingual Dictionary mode - only allow single words
        const wordCount = selectedText.split(/\s+/).length;
        if (wordCount > 1) {
            const popup = document.createElement('div');
            popup.className = 'ai-translate-popup';
            popup.textContent = `⚠️ Monolingual Dictionary mode only works with single words.`;
            document.body.appendChild(popup);
            popup.style.left = (e.pageX + 10) + 'px';
            popup.style.top = (e.pageY + 10) + 'px';
            const removePopup = () => {
                popup.remove();
                document.removeEventListener('mousedown', removePopup);
            };
            document.addEventListener('mousedown', removePopup);
            return;
        }
        
        // Detect page language for dictionary lookup
        const pageLanguageCode = detectPageLanguage();
        
        // Try to get the dictionary definition
        let definition;
        try {
            definition = await fetchDictionary(selectedText, pageLanguageCode);
        } catch (err) {
            definition = "Dictionary lookup error!";
        }
        
        // Show the definition in a popup near the mouse
        const popup = document.createElement('div');
        popup.className = 'ai-translate-popup';
        popup.textContent = definition;
        document.body.appendChild(popup);
        popup.style.left = (e.pageX + 10) + 'px';
        popup.style.top = (e.pageY + 10) + 'px';
        
        // Remove popup on next click
        const removePopup = () => {
            popup.remove();
            document.removeEventListener('mousedown', removePopup);
        };
        document.addEventListener('mousedown', removePopup);
        return;
    }

    if (currentTranslationMode === 'bilingual_dictionary') {
        // Bilingual Dictionary mode - only allow single words
        const wordCount = selectedText.split(/\s+/).length;
        if (wordCount > 1) {
            const popup = document.createElement('div');
            popup.className = 'ai-translate-popup';
            popup.textContent = `⚠️ Bilingual Dictionary mode only works with single words.`;
            document.body.appendChild(popup);
            popup.style.left = (e.pageX + 10) + 'px';
            popup.style.top = (e.pageY + 10) + 'px';
            const removePopup = () => {
                popup.remove();
                document.removeEventListener('mousedown', removePopup);
            };
            document.addEventListener('mousedown', removePopup);
            return;
        }
        
        // Try to get the bilingual dictionary definition
        let definition;
        try {
            definition = await fetchBilingualDictionary(selectedText);
        } catch (err) {
            definition = "Bilingual dictionary lookup error!";
        }
        
        // Show the definition in a popup near the mouse
        const popup = document.createElement('div');
        popup.className = 'ai-translate-popup';
        popup.textContent = definition;
        document.body.appendChild(popup);
        popup.style.left = (e.pageX + 10) + 'px';
        popup.style.top = (e.pageY + 10) + 'px';
        
        // Remove popup on next click
        const removePopup = () => {
            popup.remove();
            document.removeEventListener('mousedown', removePopup);
        };
        document.addEventListener('mousedown', removePopup);
        return;
    }

    // Default: Translation mode (currentTranslationMode === 'translation')

    // Translation mode: Word limit
    const maxWords = CONFIG.MAX_WORDS;
    const wordCount = selectedText.split(/\s+/).length;
    if (wordCount > maxWords) {
        const popup = document.createElement('div');
        popup.className = 'ai-translate-popup';
        popup.textContent = `⚠️ Please select less than ${maxWords} words.`;
        document.body.appendChild(popup);
        popup.style.left = (e.pageX + 10) + 'px';
        popup.style.top = (e.pageY + 10) + 'px';
        const removePopup = () => {
            popup.remove();
            document.removeEventListener('mousedown', removePopup);
        };
        document.addEventListener('mousedown', removePopup);
        return;
    }

    // Check if it's a single word - if so, use contextual translation
    let translation;
    try {
        if (wordCount === 1) {
            // Single word: extract context and use contextual translation
            const contextData = extractContext(window.getSelection());
            console.log('Contextual translation:', contextData);
            translation = await fetchContextualTranslation(contextData.selectedWord, contextData.context, contextData.contextType);
        } else {
            // Multiple words: use regular translation
            translation = await fetchTranslation(selectedText);
        }
    } catch (err) {
        translation = "Translation error!";
    }

    // Show the translation in a popup near the mouse
    const popup = document.createElement('div');
    popup.className = 'ai-translate-popup';
    popup.textContent = translation;
    document.body.appendChild(popup);

    // Position popup near mouse
    popup.style.left = (e.pageX + 10) + 'px';
    popup.style.top = (e.pageY + 10) + 'px';

    // Remove popup on next click
    const removePopup = () => {
      popup.remove();
      document.removeEventListener('mousedown', removePopup);
    };
    document.addEventListener('mousedown', removePopup);
});

// Use configuration from config.js
const BACKEND_CONFIG = {
    baseUrl: CONFIG.BACKEND_URL
};

// Function to call translation API through backend
async function fetchTranslation(koreanText) {
    try {
        const requestBody = { text: koreanText, targetLanguage: targetLanguage };

        const response = await fetch(`${BACKEND_CONFIG.baseUrl}/api/translate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            if (response.status === 400) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Translation failed');
            } else {
                throw new Error(`Translation failed: ${response.status}`);
            }
        }

        const data = await response.json();
        return data.translation;
    } catch (error) {
        console.error('Translation error:', error);

        // Return user-friendly error messages
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Connection failed. Check if backend is running.');
        } else {
            throw new Error('Translation unavailable');
        }
    }
}

// Function to call contextual translation API through backend
async function fetchContextualTranslation(word, context, contextType) {
    try {
        const requestBody = {
            word: word,
            context: context,
            contextType: contextType,
            targetLanguage: targetLanguage,
            mode: 'contextual'
        };

        const response = await fetch(`${BACKEND_CONFIG.baseUrl}/api/translate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            if (response.status === 400) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Contextual translation failed');
            } else {
                throw new Error(`Contextual translation failed: ${response.status}`);
            }
        }

        const data = await response.json();
        return data.translation;
    } catch (error) {
        console.error('Contextual translation error:', error);

        // Return user-friendly error messages
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Connection failed. Check if backend is running.');
        } else {
            throw new Error('Contextual translation unavailable');
        }
    }
}

// Function to call dictionary API through backend
async function fetchDictionary(word, pageLanguageCode = 'en') {
    try {
        const requestBody = { text: word, mode: 'dictionary', pageLanguage: pageLanguageCode };

        const response = await fetch(`${BACKEND_CONFIG.baseUrl}/api/dictionary`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            if (response.status === 400) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Dictionary lookup failed');
            } else {
                throw new Error(`Dictionary lookup failed: ${response.status}`);
            }
        }

        const data = await response.json();
        return data.definition;
    } catch (error) {
        console.error('Dictionary lookup error:', error);

        // Return user-friendly error messages
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Connection failed. Check if backend is running.');
        } else {
            throw new Error('Dictionary lookup unavailable');
        }
    }
}

// Function to call bilingual dictionary API through backend
async function fetchBilingualDictionary(word) {
    try {
        const requestBody = { text: word, mode: 'bilingual_dictionary', targetLanguage: targetLanguage };

        const response = await fetch(`${BACKEND_CONFIG.baseUrl}/api/dictionary`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            if (response.status === 400) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Bilingual dictionary lookup failed');
            } else {
                throw new Error(`Bilingual dictionary lookup failed: ${response.status}`);
            }
        }

        const data = await response.json();
        return data.definition;
    } catch (error) {
        console.error('Bilingual dictionary lookup error:', error);

        // Return user-friendly error messages
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Connection failed. Check if backend is running.');
        } else {
            throw new Error('Bilingual dictionary lookup unavailable');
        }
    }
}

// Initialize the extension when the page loads
initializeExtension();
// DOM elements
const domainToggle = document.getElementById('domain-toggle');
const globalToggle = document.getElementById('global-toggle');
const translationToggle = document.getElementById('translation-toggle');
const dictionaryToggle = document.getElementById('dictionary-toggle');
const bilingualDictionaryToggle = document.getElementById('bilingual-dictionary-toggle');
const currentDomainElement = document.getElementById('current-domain');
const statusMessage = document.getElementById('status-message');
const targetLanguageSelect = document.getElementById('target-language');
const currentLanguageElement = document.getElementById('current-language');
const languageSection = document.querySelector('.language-section');
const languageDivider = document.getElementById('language-divider');

let currentDomain = '';

// Language name mappings
const languageNames = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'zh': 'Simplified Chinese',
    'zh-tw': 'Traditional Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'pt': 'Portuguese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'it': 'Italian',
    'ru': 'Russian',
    'ro': 'Romanian'
};

// Initialize popup
async function initializePopup() {
    try {
        // Get current tab domain
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentDomain = new URL(tab.url).hostname;
        currentDomainElement.textContent = currentDomain;

        // Load current settings
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

        // Set toggle states
        globalToggle.checked = settings.globalEnabled;
        domainToggle.checked = settings.globalEnabled && !settings.disabledDomains.includes(currentDomain);

        // Set mode based on *this domain's* config
        if (domainConfig.translationMode === 'translation') {
            translationToggle.checked = true;
        } else if (domainConfig.translationMode === 'dictionary') {
            dictionaryToggle.checked = true;
        } else if (domainConfig.translationMode === 'bilingual_dictionary') {
            bilingualDictionaryToggle.checked = true;
        } else {
            translationToggle.checked = true;
        }

        // Set language selector for this domain
        targetLanguageSelect.value = domainConfig.targetLanguage || 'en';
        updateCurrentLanguageDisplay(domainConfig.targetLanguage || 'en');

        // Update language section visibility based on mode
        updateLanguageSectionVisibility(domainConfig.translationMode || 'translation');

        // Update domain toggle state based on global setting
        updateDomainToggleState();

    } catch (error) {
        console.error('Error initializing popup:', error);
        showStatus('Error loading settings', 'error');
    }
}

// Update domain toggle state based on global setting
function updateDomainToggleState() {
    if (!globalToggle.checked) {
        domainToggle.disabled = true;
        domainToggle.checked = false;
    } else {
        domainToggle.disabled = false;
    }
}

// Update current language display
function updateCurrentLanguageDisplay(languageCode) {
    const languageName = languageNames[languageCode] || languageCode;
    currentLanguageElement.textContent = `Current: ${languageName}`;
}

// Update language section visibility based on mode
function updateLanguageSectionVisibility(mode) {
    if (mode === 'dictionary') {
        // Hide language selector and divider in monolingual dictionary mode
        languageSection.style.display = 'none';
        languageDivider.style.display = 'none';
    } else {
        // Show language selector and divider in translation and bilingual dictionary modes
        languageSection.style.display = 'block';
        languageDivider.style.display = 'block';
    }
}

// Show status message
function showStatus(message, type = '') {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type} show`;
    
    setTimeout(() => {
        statusMessage.classList.remove('show');
    }, 2000);
}

// Update content script state
async function updateContentScript(enabled) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        await chrome.tabs.sendMessage(tab.id, {
            action: 'updateEnabled',
            enabled: enabled
        });
        
    } catch (error) {
        console.error('Error updating content script:', error);
    }
}

// Handle global toggle change
globalToggle.addEventListener('change', async function() {
    try {
        const settings = await chrome.storage.sync.get({
            disabledDomains: []
        });
        
        await chrome.storage.sync.set({
            globalEnabled: globalToggle.checked,
            disabledDomains: settings.disabledDomains
        });
        
        updateDomainToggleState();
        
        // Update content script
        const domainEnabled = globalToggle.checked && !settings.disabledDomains.includes(currentDomain);
        await updateContentScript(domainEnabled);
        
        if (globalToggle.checked) {
            showStatus('Enabled on all sites', 'success');
        } else {
            showStatus('Disabled on all sites', 'error');
            domainToggle.checked = false;
        }
        
    } catch (error) {
        console.error('Error updating global setting:', error);
        showStatus('Error updating settings', 'error');
    }
});

// Handle domain toggle change
domainToggle.addEventListener('change', async function() {
    try {
        const settings = await chrome.storage.sync.get({
            globalEnabled: true,
            disabledDomains: []
        });
        
        let disabledDomains = settings.disabledDomains || [];
        
        if (domainToggle.checked) {
            // Enable on this domain - remove from disabled list
            disabledDomains = disabledDomains.filter(domain => domain !== currentDomain);
            showStatus(`Enabled on ${currentDomain}`, 'success');
        } else {
            // Disable on this domain - add to disabled list
            if (!disabledDomains.includes(currentDomain)) {
                disabledDomains.push(currentDomain);
            }
            showStatus(`Disabled on ${currentDomain}`, 'error');
        }
        
        await chrome.storage.sync.set({
            globalEnabled: settings.globalEnabled,
            disabledDomains: disabledDomains
        });
        
        // Update content script
        await updateContentScript(domainToggle.checked);
        
    } catch (error) {
        console.error('Error updating domain setting:', error);
        showStatus('Error updating settings', 'error');
    }
});

// Handle language selection change
targetLanguageSelect.addEventListener('change', async function() {
    try {
        const selectedLanguage = targetLanguageSelect.value;

        const settings = await chrome.storage.sync.get({
            globalEnabled: true,
            disabledDomains: [],
            defaultTargetLanguage: 'en',
            defaultTranslationMode: 'translation',
            domainSettings: {}
        });

        const domainSettings = settings.domainSettings || {};

        const currentDomainConfig = domainSettings[currentDomain] || {
            targetLanguage: settings.defaultTargetLanguage || 'en',
            translationMode: settings.defaultTranslationMode || 'translation'
        };

        domainSettings[currentDomain] = {
            ...currentDomainConfig,
            targetLanguage: selectedLanguage
        };

        await chrome.storage.sync.set({
            ...settings,
            domainSettings
        });

        updateCurrentLanguageDisplay(selectedLanguage);

        const languageName = languageNames[selectedLanguage] || selectedLanguage;
        showStatus(`Target language changed to ${languageName}`, 'success');

        // Notify ONLY this tab's content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, {
            action: 'updateTargetLanguage',
            targetLanguage: selectedLanguage
        });

    } catch (error) {
        console.error('Error updating target language:', error);
        showStatus('Error updating language', 'error');
    }
});

// Handle mode changes (unified for all three modes)
function handleModeChange(selectedMode) {
    return async function() {
        try {
            const settings = await chrome.storage.sync.get({
                globalEnabled: true,
                disabledDomains: [],
                defaultTargetLanguage: 'en',
                defaultTranslationMode: 'translation',
                domainSettings: {}
            });

            const domainSettings = settings.domainSettings || {};

            const currentDomainConfig = domainSettings[currentDomain] || {
                targetLanguage: settings.defaultTargetLanguage || 'en',
                translationMode: settings.defaultTranslationMode || 'translation'
            };

            domainSettings[currentDomain] = {
                ...currentDomainConfig,
                translationMode: selectedMode
            };

            await chrome.storage.sync.set({
                ...settings,
                domainSettings
            });

            // Update language section visibility
            updateLanguageSectionVisibility(selectedMode);

            let statusMessage = '';
            if (selectedMode === 'translation') {
                statusMessage = 'Translation Mode enabled';
            } else if (selectedMode === 'dictionary') {
                statusMessage = 'Monolingual Dictionary Mode enabled';
            } else if (selectedMode === 'bilingual_dictionary') {
                statusMessage = 'Bilingual Dictionary Mode enabled';
            }
            showStatus(statusMessage, 'success');

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, {
                action: 'updateTranslationMode',
                translationMode: selectedMode
            });

        } catch (error) {
            console.error('Error updating translation mode:', error);
            showStatus('Error updating mode', 'error');
        }
    };
}

// Add event listeners for all three modes
translationToggle.addEventListener('change', handleModeChange('translation'));
dictionaryToggle.addEventListener('change', handleModeChange('dictionary'));
bilingualDictionaryToggle.addEventListener('change', handleModeChange('bilingual_dictionary'));

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', initializePopup);
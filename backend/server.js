const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Function to clean up translation responses
function cleanTranslationResponse(response, targetLanguage, originalText) {
  let cleaned = response.trim();

  // Remove common prefixes that OpenAI might add
  const prefixesToRemove = [
    /^Translation:\s*/i,
    /^Interpretation:\s*/i,
    /^In\s+\w+:\s*/i,
    /^English:\s*/i,
    /^French:\s*/i,
    /^Korean:\s*/i,
    /^Chinese:\s*/i,
    /^Japanese:\s*/i,
    /^Spanish:\s*/i,
    /^German:\s*/i,
    /^Italian:\s*/i,
    /^Portuguese:\s*/i,
    /^Russian:\s*/i,
    /^Arabic:\s*/i,
    /^Hindi:\s*/i,
    /^Indonesian:\s*/i,
    /^Romanian:\s*/i,
    /^The\s+translation\s+is:\s*/i,
    /^Here\s+is\s+the\s+translation:\s*/i,
    /^.*?:\s*/
  ];

  // Remove prefixes
  for (const prefix of prefixesToRemove) {
    cleaned = cleaned.replace(prefix, '');
  }

  // Split by common separators and take the first clean sentence
  const lines = cleaned.split(/\n+/);
  if (lines.length > 1) {
    // If multiple lines, take the first non-empty line that doesn't look like metadata
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine &&
          !trimmedLine.match(/^(Translation|Interpretation|Note|Explanation):/i) &&
          !trimmedLine.match(/^\(.+\)$/) && // Remove parenthetical notes
          trimmedLine.length > 2) {
        cleaned = trimmedLine;
        break;
      }
    }
  }

  // Remove trailing punctuation explanations or notes
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, ''); // Remove trailing parenthetical
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*$/, ''); // Remove trailing brackets

  // Remove quotation marks if the entire response is wrapped in them
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }

  // Validate that we have a proper translation
  cleaned = validateTranslation(cleaned, originalText, targetLanguage);

  return cleaned.trim();
}

// Function to validate translation output
function validateTranslation(translation, originalText, targetLanguage) {
  // Check if translation is identical to original (likely untranslated)
  if (translation === originalText) {
    // For short Korean text, provide fallback translations
    const koreanFallbacks = {
      '전': 'former',
      '후': 'after',
      '중': 'during',
      '내': 'my',
      '외': 'foreign',
      '상': 'top',
      '하': 'bottom',
      '좌': 'left',
      '우': 'right'
    };

    if (koreanFallbacks[originalText]) {
      return koreanFallbacks[originalText];
    }
  }

  // Check if translation contains Korean characters (for English target)
  if (targetLanguage === 'en' && /[\u3131-\u318e\uac00-\ud7a3]/.test(translation)) {
    // If it's a Korean name pattern, try to romanize common ones
    const koreanNames = {
      '윤석열': 'Yoon Suk-yeol',
      '문재인': 'Moon Jae-in',
      '박근혜': 'Park Geun-hye',
      '이명박': 'Lee Myung-bak',
      '김정은': 'Kim Jong-un',
      '김일성': 'Kim Il-sung'
    };

    if (koreanNames[translation]) {
      return koreanNames[translation];
    }

    // For other Korean text, flag as needing retranslation
    console.warn(`Untranslated Korean text detected: ${translation}`);
  }

  return translation;
}

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// CORS configuration for Chrome extensions
const corsOptions = {
  origin: function (origin, callback) {
    // Allow all origins for extension content scripts
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Request logging middleware
const logRequest = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Translation endpoint
app.post('/api/translate', logRequest, async (req, res) => {
  try {
    const { text, targetLanguage = 'en', word, context, contextType, mode } = req.body;

    // For contextual translation, we need either text or word+context
    if (!text && !(word && context)) {
      return res.status(400).json({ error: 'Text or word+context is required' });
    }

    // Determine if this is contextual translation
    const isContextual = mode === 'contextual' && word && context;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Word count validation
    let wordCount;
    let textToTranslate;

    if (isContextual) {
      // For contextual translation, we only charge for the single word being translated
      wordCount = 1;
      textToTranslate = word;
    } else {
      wordCount = text.trim().split(/\s+/).length;
      textToTranslate = text;
    }

    // Language name mapping for better prompts
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

    // Validate target language is supported
    if (!languageNames[targetLanguage]) {
      return res.status(400).json({
        error: 'unsupported_language',
        message: `Target language '${targetLanguage}' is not supported`,
        supportedLanguages: Object.keys(languageNames)
      });
    }

    const targetLanguageName = languageNames[targetLanguage];

    // Create the appropriate prompt based on translation type
    let systemPrompt, userContent;

    if (isContextual) {
      // Contextual translation prompt
      systemPrompt = `You are a professional translator specializing in contextual word translation. Your task is to translate a specific word to ${targetLanguageName} based on its context. Follow these rules strictly:

CRITICAL REQUIREMENTS:
1. You will receive a specific word and its surrounding context
2. Translate ONLY the specified word to ${targetLanguageName} based on the context
3. Consider grammar, usage, and context to provide the most appropriate translation
4. For ambiguous words, use the context to determine the correct meaning
5. NEVER return the entire context translated - only the word

CONTEXTUAL ANALYSIS:
- Context type: ${contextType || 'unknown'}
- Analyze the grammatical role of the word in context
- Consider idiomatic usage and collocations
- Choose the most appropriate translation based on context

OUTPUT RULES:
- ONLY respond with the ${targetLanguageName} translation of the specified word
- NO explanations, prefixes, or metadata
- NO phrases like "Translation:" or "In English:"
- Return ONLY the clean translated word/phrase in ${targetLanguageName}
- If the word has multiple possible translations, choose the one that best fits the context`;

      userContent = `Word to translate: "${word}"
Context: "${context}"

Translate only the word "${word}" to ${targetLanguageName} based on its usage in the given context.`;
    } else {
      // Regular translation prompt
      systemPrompt = `You are a professional translator. Your task is to translate text to ${targetLanguageName}. Follow these rules strictly:

CRITICAL REQUIREMENTS:
1. ALWAYS translate to ${targetLanguageName} - NEVER return text in the source language
2. For proper nouns (names, places): provide the standard romanized form in ${targetLanguageName}
3. For Korean names like "윤석열": return "Yoon Suk-yeol" (not the Hangul)
4. For short words/particles like "전": translate the meaning ("former", "previous", etc.)
5. NEVER return untranslated Korean, Chinese, or other non-${targetLanguageName} text

OUTPUT RULES:
- ONLY respond with the ${targetLanguageName} translation
- NO explanations, prefixes, or metadata
- NO phrases like "Translation:" or "In English:"
- NO parenthetical notes or alternatives
- Return ONLY the clean translated text in ${targetLanguageName}`;

      userContent = textToTranslate;
    }

    // Call OpenAI API
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userContent
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    let translation = response.data.choices[0].message.content.trim();

    // Clean up the response to ensure only the target language translation
    translation = cleanTranslationResponse(translation, targetLanguage, textToTranslate);

    const responseData = {
      translation,
      wordCount,
      targetLanguage,
      targetLanguageName,
      timestamp: new Date().toISOString()
    };

    // Add contextual information if applicable
    if (isContextual) {
      responseData.contextual = true;
      responseData.originalWord = word;
      responseData.context = context;
      responseData.contextType = contextType;
    }

    res.json(responseData);

  } catch (error) {
    console.error('Translation error:', error.message);

    if (error.response?.status === 401) {
      res.status(500).json({ error: 'OpenAI API authentication failed' });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'OpenAI API rate limit exceeded' });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Translation request timed out' });
    } else {
      res.status(500).json({ error: 'Translation failed' });
    }
  }
});

// Dictionary endpoint
app.post('/api/dictionary', logRequest, async (req, res) => {
  try {
    const { text, mode = 'dictionary', pageLanguage = 'en', targetLanguage, context } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Language name mapping for better prompts
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

    // Word count validation (dictionary mode should only work with single words)
    const wordCount = text.trim().split(/\s+/).length;

    if (wordCount > 1) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Dictionary mode only works with single words',
        wordCount
      });
    }

    // Determine if this is bilingual or monolingual dictionary mode
    const isBilingualDictionary = mode === 'bilingual_dictionary';

    // Create appropriate system prompt and user content based on dictionary type
    let systemPrompt, userContent;

    if (isBilingualDictionary) {
      // BILINGUAL DICTIONARY MODE
      // Output language: targetLanguage (from UI "Translate to" setting)

      if (!targetLanguage) {
        return res.status(400).json({ error: 'targetLanguage is required for bilingual_dictionary mode' });
      }

      const targetLanguageName = languageNames[targetLanguage] || 'English';

      systemPrompt = `You are a bilingual dictionary providing dictionary-style definitions. Follow these rules strictly:

CRITICAL REQUIREMENTS:
1. Detect the source language of the input word automatically (use context if provided)
2. Provide a dictionary-style definition/explanation in ${targetLanguageName}
3. This is NOT a simple translation - provide a proper dictionary definition
4. Include grammatical information (noun, verb, adjective, etc.) when relevant
5. Show the most common meaning(s) with brief explanations
6. For complex words, provide contextual usage information

OUTPUT RULES:
- ONLY respond with the dictionary definition in ${targetLanguageName}
- NO simple one-word translations
- NO prefixes like "Definition:" or "Meaning:"
- Return ONLY the clean dictionary entry
- Keep definitions concise but informative (2-3 sentences maximum)
- Include part of speech when helpful
- For multiple meanings, show the most common ones

EXAMPLES:
Input: "bonjour" → "interjection. A French greeting meaning 'hello' or 'good day', commonly used when meeting someone or entering a place"
Input: "Schadenfreude" → "noun. The feeling of pleasure or satisfaction derived from someone else's misfortune or failure"`;

      // Include context if provided
      if (context) {
        userContent = `Word to define: "${text}"
Context: "${context}"

Provide a dictionary-style definition in ${targetLanguageName}.`;
      } else {
        userContent = `Word to define: "${text}"

Provide a dictionary-style definition in ${targetLanguageName}.`;
      }

    } else {
      // MONOLINGUAL DICTIONARY MODE
      // Output language: detected language of the word itself (NOT targetLanguage, NOT pageLanguage necessarily)

      const pageLanguageName = languageNames[pageLanguage] || 'English';

      systemPrompt = `You are a monolingual dictionary that provides definitions in the same language as the input word. Follow these rules strictly:

CRITICAL REQUIREMENTS:
1. DETECT the language of the input word from the context provided
2. Provide a concise definition in THE SAME LANGUAGE as the detected word
3. The page language (${pageLanguageName}) is a hint, but you must verify the word's actual language from context
4. If context clearly shows the word is in a different language, use that language for the definition
5. For ambiguous words, prefer the page language (${pageLanguageName}) as a fallback
6. NEVER translate to another language - define the word in its own language

OUTPUT RULES:
- ONLY respond with the definition in the SAME LANGUAGE as the input word
- NO translations to other languages
- NO explanations about what language it is
- NO prefixes like "Definition:" or "Meaning:"
- Return ONLY the clean definition
- Keep definitions concise (1-2 sentences maximum)
- For multiple meanings, show the most common one

EXAMPLES:
Word: "serendipity" (English context) → "The occurrence of finding pleasant or valuable things by chance" (English definition)
Word: "élégant" (French context) → "Qui a de la grâce, du raffinement dans les manières ou l'apparence" (French definition)
Word: "Schadenfreude" (German context) → "Freude über das Unglück oder Missgeschick anderer" (German definition)`;

      // Always include context for better language detection in monolingual mode
      if (context) {
        userContent = `Word to define: "${text}"
Context: "${context}"

Detect the language of the word from the context and provide a definition in that same language.`;
      } else {
        userContent = `Word to define: "${text}"
Page language hint: ${pageLanguageName}

Detect the language of the word and provide a definition in that same language.`;
      }
    }

    // Call OpenAI API for dictionary definition
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userContent
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    let definition = response.data.choices[0].message.content.trim();

    // Clean up the response
    const prefixesToRemove = [
      /^Definition:\s*/i,
      /^Meaning:\s*/i,
      /^Dictionary:\s*/i,
      /^.*?:\s*/
    ];

    for (const prefix of prefixesToRemove) {
      definition = definition.replace(prefix, '');
    }

    const responseData = {
      definition,
      word: text,
      mode: mode,
      timestamp: new Date().toISOString()
    };

    // Add appropriate language information based on dictionary type
    if (isBilingualDictionary) {
      responseData.targetLanguage = targetLanguage;
      responseData.targetLanguageName = languageNames[targetLanguage];
      responseData.dictionaryType = 'bilingual';
    } else {
      responseData.pageLanguage = pageLanguage;
      responseData.pageLanguageName = languageNames[pageLanguage] || 'English';
      responseData.dictionaryType = 'monolingual';
      responseData.detectedFromContext = !!context;
    }

    res.json(responseData);

  } catch (error) {
    console.error('Dictionary lookup error:', error.message);

    if (error.response?.status === 401) {
      res.status(500).json({ error: 'OpenAI API authentication failed' });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'OpenAI API rate limit exceeded' });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Dictionary request timed out' });
    } else {
      res.status(500).json({ error: 'Dictionary lookup failed' });
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Sori Translator Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

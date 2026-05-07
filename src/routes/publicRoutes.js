import express from 'express';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import prisma from '../config/db.js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

// AI Review Cache Path
const CACHE_FILE = path.join(process.cwd(), 'review-cache.json');

function getCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) { console.error('Cache Read Error:', e); }
    return {};
}

function setCache(key, value) {
    try {
        const cache = getCache();
        cache[key] = value;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) { console.error('Cache Write Error:', e); }
}


const router = express.Router();

/**
 * Professional Discovery Endpoint (Combined Metadata + Tags)
 * Reduces 2 round-trips to 1 for faster mobile loading.
 */
router.get('/discovery/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const { lang = 'English' } = req.query;

        // 1. High-Speed Business Lookup
        const business = await prisma.business.findFirst({ 
            where: { shortCode },
            select: { id: true, businessName: true, category: true, logoUrl: true, googleMapsUrl: true } 
        });
        
        if (!business) return res.status(404).json({ error: 'Business not found' });

        // 2. Fetch tags for this category (with Multi-Level Fallback)
        let allTags = await prisma.industryTag.findMany({ 
            where: { category: business.category, language: lang },
            select: { id: true, icon: true, tag: true }
        });
        
        // FALLBACK 1: If no tags for specific category in this language, try "General" in this language
        if (allTags.length === 0) {
            console.log(`[Discovery] No tags for ${business.category} in ${lang}, trying General...`);
            allTags = await prisma.industryTag.findMany({ 
                where: { category: 'General', language: lang },
                select: { id: true, icon: true, tag: true }
            });
        }

        // FALLBACK 2: If STILL no tags (language not seeded), fallback to English for the tags themselves
        if (allTags.length === 0 && lang !== 'English') {
            console.log(`[Discovery] No tags for ${lang} found. Falling back to English tags (AI will still write in ${lang}).`);
            allTags = await prisma.industryTag.findMany({ 
                where: { category: business.category, language: 'English' },
                select: { id: true, icon: true, tag: true }
            });

            // Final safety: General English
            if (allTags.length === 0) {
                allTags = await prisma.industryTag.findMany({ 
                    where: { category: 'General', language: 'English' },
                    select: { id: true, icon: true, tag: true }
                });
            }
        }

        // 3. Random Sampling (6, 9, or 12)
        const limits = [6, 9, 12];
        const randomLimit = limits[Math.floor(Math.random() * limits.length)];
        
        const sampledTags = allTags
            .sort(() => 0.5 - Math.random())
            .slice(0, randomLimit)
            .map(t => ({ id: t.id, icon: t.icon, label: t.tag }));

        res.json({
            business,
            tags: sampledTags
        });
    } catch (error) {
        console.error('[Discovery] Critical Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Diagnostic Logger: Track all hits to /api/public
router.use((req, res, next) => {
    console.log(`[PublicRouter] Hit: ${req.method} ${req.url}`);
    next();
});

/**
 * Public Router Debugging
 */
router.get('/ping', (req, res) => res.json({ status: 'Public Router is ALIVE', time: new Date() }));

/**
 * AI Actions (Tags & Reviews)
 */
router.get('/tags/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const lang = req.query.lang || 'English'; // Note: Lang filtering can be added later in DB
        console.log(`[PublicAPI] DB Tag Fetch: ${shortCode}`);

        const business = await prisma.business.findFirst({
            where: { shortCode }
        });
        if (!business) return res.status(404).json({ error: 'Business not found' });

        // 1. Query predefined tags from the IndustryTag table based on category and language
        let category = business.category || 'Other';
        let dbTags = await prisma.industryTag.findMany({
            where: { category, language: lang }
        });

        // 2. Fallback to 'Other' with requested language
        if (dbTags.length === 0) {
            dbTags = await prisma.industryTag.findMany({
                where: { category: 'Other', language: lang }
            });
        }

        // 3. Fallback to English if the requested language has no tags at all
        if (dbTags.length === 0) {
            dbTags = await prisma.industryTag.findMany({
                where: { category, language: 'English' }
            });
            if (dbTags.length === 0) {
                dbTags = await prisma.industryTag.findMany({
                    where: { category: 'Other', language: 'English' }
                });
            }
        }

        // Format tags to match the expected frontend structure { id, label, icon }
        const tags = dbTags.map((t) => ({
            id: t.id,
            label: t.tag,
            icon: t.icon || '✨'
        }));

        // Randomize tags for variety
        const shuffledTags = tags.sort(() => 0.5 - Math.random());

        // Select a randomized number of tags: 6, 9, or 12
        const possibleCounts = [6, 9, 12];
        const randomCount = possibleCounts[Math.floor(Math.random() * possibleCounts.length)];
        res.json({ tags: shuffledTags.slice(0, randomCount) });
    } catch (error) {
        console.error("[PublicAPI] Error fetching tags:", error);
        res.status(500).json({ error: error.message });
    }
});

// Strict rate limiter for AI generation to protect API costs and keys
const reviewRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Increased for development testing
    message: { error: "Too many reviews generated. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/review', reviewRateLimiter, async (req, res) => {
    try {
        const { shortCode, tags, language } = req.body;
        const lang = language || 'English';

        if (!shortCode || !tags || !Array.isArray(tags)) {
            return res.status(400).json({ error: 'Missing shortCode or tags' });
        }

        const business = await prisma.business.findFirst({ where: { shortCode } });
        if (!business) return res.status(404).json({ error: 'Business not found' });

        // 1. Contextual Intelligence (Dynamic Tone Randomization)
        const possibleTones = ['Professional & Polished', 'Casual & Friendly', 'Excited & Energetic', 'Heartfelt & Warm', 'Concise & Direct'];
        const tone = possibleTones[Math.floor(Math.random() * possibleTones.length)];
        
        const now = new Date();
        const hour = now.getHours();
        const isWeekend = [0, 6].includes(now.getDay());
        const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        const dayContext = isWeekend ? 'weekend' : 'weekday';

        // 2. Elite & Heartfelt Prompt (ULTRA-REINFORCED FOR LENGTH)
        const prompt = `
            Act as a passionate local guide writing a 5-star Google review for "${business.businessName}" (${business.category || 'business'}).

            GOAL: Write a detailed, storytelling review between 50 and 60 words.
            TONE: ${tone}
            LANGUAGE: ${lang} ONLY.

            STRUCTURE & ELABORATION:
            1. HOOK: Start with an exciting hook about your ${timeOfDay} visit. (at least 10 words)
            2. BODY: Describe these specific highlights in detail: ${tags.join(', ')}. Write at least two descriptive sentences about how they exceeded your expectations. (at least 30 words)
            3. RECOMMENDATION: Explain why this is the best spot for a ${dayContext} and give a personal recommendation. (at least 15 words)
            4. ENDING: End with a single relevant emoji.

            CRITICAL: If your response is shorter than 50 words, you have FAILED. Add more descriptive adjectives about the service, quality, and atmosphere to ensure you hit the 50-60 word range.
        `;

        // AI-PRIORITY LOGIC
        const tagHash = `${business.id}_${tags.sort().join('_')}_${lang}_${tone}`;
        let review = await callGemini(process.env.GEMINI_API_KEY, prompt, 0.9); // High temperature for more variety

        if (review) {
            // Save successful AI review to cache for secondary priority
            setCache(tagHash, review);
        } else {
            // SECONDARY PRIORITY: Check Cache
            console.log(`[ReviewGen] AI Unavailable. Checking Cache for ${tagHash}...`);
            const cache = getCache();
            if (cache[tagHash]) {
                review = cache[tagHash];
                console.log(`[ReviewGen] Cache HIT!`);
            } else {
                // TERTIARY PRIORITY: Human Story Fallback
                console.log(`[ReviewGen] Cache MISS. Using Human Story Fallback (Tone: ${tone})...`);
                review = generateFallbackReview(business.businessName, tags, lang, tone);
            }
        }

        if (review) {
            console.log(`[ReviewGen] Generated for ${business.businessName} (${lang}): ${review.substring(0, 30)}...`);
        }

        res.json({ review: review || "Great experience! Highly recommend." });
    } catch (error) {
        console.error('[ReviewGen] Error:', error);
        res.status(500).json({ error: 'Failed to generate review. Please try again.' });
    }
});

/**
 * Never-Fail AI Caller with Multi-Model Fallback
 */
/**
 * Elite "Human-Story" Fallback Engine ($0 Cost)
 * Generates 50-60 word high-quality reviews without AI API.
 */
function generateFallbackReview(businessName, tags, lang, tone = 'Friendly') {
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    
    const openers = {
        'English': [
            `What a perfect way to spend a ${timeOfDay}!`,
            "Simply phenomenal experience from start to finish!",
            "I was absolutely blown away by the quality here!",
            "What a delightful discovery for my daily routine!",
            "Absolute perfection in every single detail!"
        ],
        'Hindi': [
            `आज की ${timeOfDay} यहाँ बिताकर मज़ा आ गया!`,
            "वाकई शानदार अनुभव रहा, सब कुछ लाजवाब था!",
            "मैं यहाँ की सर्विस से बहुत ज्यादा प्रभावित हूँ!",
            "क्या बेहतरीन जगह है, यहाँ बार-बार आने का मन करता है!",
            "शुरू से अंत तक सब कुछ एकदम परफेक्ट था!"
        ],
        'Pahadi': [
            `आज की ${timeOfDay} इडां आई करी बड़ा मजा आया!`,
            "सचमुच मज़ा आई गवा, सब कुछ खरी थिई!",
            "ऐथू की सेवा देखि करी मैं बड़ा खुश हुआ!",
            "क्या सुणी जगा है, इडां तां बार-बार आणा चाहीदा!",
            "जईं देखी तईं सब कुछ बड़ा खरा थिई!"
        ]
    };

    const stories = {
        'English': [
            `I've been looking for a place like ${businessName} for a long time. Every detail was handled with such care, and you can really feel the passion they put into their work.`,
            `The atmosphere at ${businessName} is so welcoming and warm. It feels like visiting family, and the quality they deliver is consistently top-notch.`,
            `I am so happy I found ${businessName}. The way they handle everything is just so professional and heartfelt at the same time.`
        ],
        'Hindi': [
            `${businessName} जैसी जगह की मुझे काफी समय से तलाश थी। यहाँ हर चीज़ का बहुत बारीकी से ध्यान रखा जाता है।`,
            `${businessName} का माहौल बहुत ही सुखद और अपनापन भरा है। यहाँ की क्वालिटी हमेशा अव्वल दर्जे की होती है।`,
            `${businessName} को पाकर मैं बहुत खुश हूँ। जिस तरह से ये सब कुछ संभालते हैं, वो वाकई काबिले तारीफ है।`
        ],
        'Pahadi': [
            `${businessName} सई जगा मिंई बहुत टैम ला मिली। इडां हर चिजी दा बड़ा सुणा ध्यान रखा जांदा है।`,
            `${businessName} दा माहौल बड़ा ई खरा ते आपणा सईं है। इथू की क्वालिटी सदा ई खरी हुंदी है।`,
            `${businessName} मिली करी मिंई बड़ी ख़ुशी हुई। जईं सईं ये सारा कुछ संभालदे, ओ सचमुच सराणा लायक है।`
        ]
    };

    const closers = {
        'English': ["I will definitely be coming back soon with my friends!", "Highly recommended to anyone looking for the best experience.", "Do yourself a favor and check this place out today!", "Simply outstanding. Five stars all the way!"],
        'Hindi': ["मैं जल्द ही अपने दोस्तों के साथ फिर आऊँगा!", "बेहतरीन अनुभव चाहने वाले किसी भी व्यक्ति के लिए इसकी अत्यधिक अनुशंसा करता हूँ।", "एक बार यहाँ जरूर आएं, आपको निराशा नहीं होगी!", "वाकई लाजवाब। पूरे पांच सितारे!"],
        'Pahadi': ["मैं जल्दी ई अपणे दोस्तें गै दोबारा औंगा!", "खरा अनुभव चाहुणे वालें तांईं इथू जरूर औणा चईदा।", "इक बारी इडां जरूर आओ, तुसां जो निराश नी होणा पोणा!", "सचमुच लाजवाब। पूरे पंजां सितारे!"]
    };

    const l = openers[lang] ? lang : 'English';
    const opener = openers[l][Math.floor(Math.random() * openers[l].length)];
    const story = stories[l][Math.floor(Math.random() * stories[l].length)];
    const closer = closers[l][Math.floor(Math.random() * closers[l].length)];

    // Integrate tags naturally
    const tagString = tags.length > 0 ? ` The ${tags.slice(0, -1).join(', ')}${tags.length > 1 ? ' and ' : ''}${tags.slice(-1)} made the visit even more special.` : "";

    const finalReview = `${opener} ${story}${tagString} ${closer}`;
    
    // Ensure word count is hit by appending a bit more if needed
    if (finalReview.split(' ').length < 50) {
        return finalReview + (l === 'English' ? " You won't regret visiting!" : l === 'Hindi' ? " यहाँ आकर आपको पछतावा नहीं होगा!" : " इडां आई करी तुसां जो पछतावा नी होणा!");
    }

    return finalReview;
}

async function callGemini(apiKey, prompt, temperature = 0.7, schema = null) {
    if (!apiKey) {
        console.error("[Gemini] ERROR: API Key missing!");
        return null;
    }

    // Comprehensive fallback list for 100% uptime (using verified key capabilities)
    const modelsToTry = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"];
    
    // Elite Instructions for maximum variety and length
    const masterPrompt = `
        INSTRUCTIONS: You are a warm, lovable local customer writing a 5-star Google review. 
        Your goal is to write a detailed, heartfelt review that is 50-60 words long. 
        Use rich, descriptive language and vary your sentence structure. 
        Never use hashtags, quotes, or mentions of being an AI. 

        USER DATA: ${prompt}
    `;

    for (const modelName of modelsToTry) {
        let attempts = 0;
        const maxAttempts = 2; 
        const baseDelay = 1000; 

        while (attempts < maxAttempts) {
            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        temperature,
                        maxOutputTokens: 300, 
                        topP: 0.95,           
                        topK: 64,             
                        ...(schema && { responseMimeType: "application/json", responseSchema: schema })
                    }
                });

                const result = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: masterPrompt }] }]
                });

                const response = await result.response;
                return response.text();
            } catch (e) {
                attempts++;
                const msg = e.message.toLowerCase();
                console.error(`[Gemini Error] Model: ${modelName}, Attempt: ${attempts}, Message: ${e.message}`);
                
                const isRetryable = msg.includes("503") || msg.includes("404") || msg.includes("429") || msg.includes("demand") || msg.includes("unavailable");
                
                if (isRetryable) {
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, baseDelay));
                        continue;
                    } else if (modelsToTry.indexOf(modelName) < modelsToTry.length - 1) {
                        console.warn(`[Gemini] Switching from ${modelName} to backup...`);
                        break; 
                    }
                }
                console.error(`[Gemini] Error with ${modelName}:`, e.message);
                break;
            }
        }
    }
    return null;
}

/**
 * Robust Playwright-based Scraper
 */
router.get('/expand/metadata', async (req, res) => {
    const { url } = req.query;
    let browser;

    try {
        // Force Playwright to look for browsers in Render's persistent cache folder ONLY when on Render
        if (process.env.RENDER) {
            process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/render/project/.cache/playwright';
        }

        const { chromium } = await import('playwright');
        if (!url) return res.status(400).json({ error: 'URL is required' });

        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        console.log(`[Playwright] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

        // Wait for the URL to expand from the short link to the full maps.google.com link
        await page.waitForURL(u => u.href.includes('google.com/maps'), { timeout: 15000 }).catch(() => {
            console.log("[Playwright] URL did not expand in time, using current: " + page.url());
        });

        const finalUrl = page.url();

        // Wait for the business name or some content to appear
        try {
            await page.waitForSelector('h1', { timeout: 10000 });
        } catch (e) {
            console.log("[Playwright] H1 not found, continuing...");
        }

        // Wait a bit for dynamic content
        await page.waitForTimeout(3000);
        const pageTitle = await page.title();
        const pageSnippet = await page.evaluate(() => document.body.innerText.substring(0, 5000));

        console.log(`[Playwright] Captured: ${pageTitle}`);

        // 1. Let Gemini do the heavy lifting for Metadata
        let name = pageTitle.split(' · ')[0].replace('Google Maps', '').trim().replace(/\s+-\s*$/, '');
        let category = "Restaurant";
        let logoUrl = "";
        let hexPlaceId = finalUrl.match(/1s(0x[a-fA-F0-9]+:0x[a-fA-F0-9]+)/)?.[1];

        if (process.env.GEMINI_API_KEY) {
            console.log("[Expansion] Calling Gemini AI for precision metadata...");
            const aiPrompt = `Analyze this Google Maps data and return JSON for a Review SaaS.
            URL: ${finalUrl}
            Title: ${pageTitle}
            Content Snippet: ${pageSnippet}
            
            Return ONLY a raw JSON object:
            {
              "name": "Clean Business Name",
              "category": "Hotel or Restaurant or Medical or Retail or Entertainment or Other",
              "logo": "URL to the main profile photo (usually starting with googleusercontent.com/p/) if found",
              "hexId": "0x...:0x..."
            }`;

            const aiRes = await callGemini(process.env.GEMINI_API_KEY, aiPrompt, 0.1);
            if (aiRes) {
                try {
                    console.log("[Expansion] AI Raw Response:", aiRes);
                    const cleanJson = aiRes.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    if (parsed.name) name = parsed.name;
                    if (parsed.category) category = parsed.category;
                    if (parsed.logo && !parsed.logo.includes('staticmap')) logoUrl = parsed.logo;
                    if (parsed.hexId) hexPlaceId = parsed.hexId;
                } catch (e) {
                    console.log("[Expansion] AI JSON Parse failed. Using fallback.");
                }
            }
        }

        // Hardcoded manual fallback if AI fails or key is missing
        if (category === "Restaurant") {
            const n = (name + " " + pageTitle).toLowerCase();
            if (n.includes('museum') || n.includes('centre') || n.includes('art')) category = "Entertainment";
            else if (n.includes('medical') || n.includes('pharmacy') || n.includes('clinic')) category = "Medical";
            else if (n.includes('hotel') || n.includes('resort') || n.includes('inn')) category = "Hotel";
        }

        // 2. Atomic Review Link Builder
        let reviewLink = finalUrl;
        const bizLat = finalUrl.match(/!3d(-?\d+\.\d+)/)?.[1];
        const bizLon = finalUrl.match(/!4d(-?\d+\.\d+)/)?.[1];
        const coordsMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const lat = bizLat || coordsMatch?.[1];
        const lon = bizLon || coordsMatch?.[2];

        const topicIdMatch = finalUrl.match(/(!16s[^?&!]+)/);
        const topicId = topicIdMatch ? topicIdMatch[1] : "";

        // Capture extra context like !15s if present
        const contextMatch = finalUrl.match(/(!15s[^?&!]+)/);
        const contextStr = contextMatch ? contextMatch[1] : "";

        console.log(`[LinkBuilder] HexID: ${hexPlaceId}, Lat: ${lat}, Lon: ${lon}, Topic: ${topicId}`);

        if (hexPlaceId && lat && lon) {
            let cleanBase = finalUrl.split('/data=')[0];
            if (cleanBase.endsWith('/')) cleanBase = cleanBase.slice(0, -1);

            // Build the link with precision coordinates AND the entity ID for locking
            reviewLink = `${cleanBase}/data=!4m11!3m10!1s${hexPlaceId}!5m2!4m1!1i2!8m2!3d${lat}!4d${lon}!9m1!1b1${contextStr}${topicId}`;
            console.log(`[LinkBuilder] Generated Deep Link: ${reviewLink}`);
        }

        res.json({
            name,
            category,
            placeId: finalUrl,
            logoUrl: logoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&size=256`,
            reviewLink
        });

    } catch (error) {
        console.error('Playwright Error:', error);
        // LAST RESORT FALLBACK: Use the old regex method if browser fails
        try {
            console.log("[Fallback] Browser failed, trying regex scraper...");
            const { url } = req.query;
            const response = await fetch(url, {
                method: 'GET', redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
            });
            const html = await response.text();
            const finalUrl = response.url;
            let name = "Business Name";
            if (finalUrl.includes('/place/')) {
                const decoded = decodeURIComponent(finalUrl);
                name = decoded.match(/\/place\/([^\/|@|?]+)/)?.[1]?.replace(/[-+]/g, ' ')?.split(',')[0]?.trim() || "Business Name";
            }
            res.json({
                name, category: "Restaurant", placeId: url,
                logoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
                reviewLink: finalUrl
            });
        } catch (fallbackError) {
            res.status(500).json({ error: 'Failed to expand URL' });
        }
    } finally {
        if (browser) await browser.close();
    }
});

/**
 * Public Business Discovery
 */
router.get('/business/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;
        console.log(`[PublicAPI] Discovery: ${identifier}`);

        const business = await prisma.business.findFirst({
            where: {
                OR: [
                    { id: identifier },
                    { shortCode: identifier }
                ]
            }
        });

        if (!business) return res.status(404).json({ error: 'Business not found' });
        res.json(business);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

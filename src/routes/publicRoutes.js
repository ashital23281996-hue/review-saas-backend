import express from 'express';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import prisma from '../config/db.js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';


const router = express.Router();
console.log('--- PUBLIC ROUTER INITIALIZING ---');

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
    max: 5, // Limit each IP to 5 requests per window
    message: { error: 'Too many reviews generated. Please try again in 15 minutes.' },
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

        // Enhanced AI Prompt with Category-Specific Awareness
        const prompt = `
            TASK: Write a casual, raw Google Maps review for "${business.businessName}", which is a ${business.category || 'local business'}.
            PERSONA: You are a real customer. You are NOT an AI. You are a local person who just visited this ${business.category || 'place'}.

            CRITICAL HUMAN BEHAVIOR RULES:
            1. NO ROBOT OPENINGS: Never start with "I recently visited" or "Highly recommend". Start with the direct experience.
            2. EMOTIONAL START: Start with a feeling (e.g., "Maza aa gaya", "Truly authentic", "Super fast service").
            3. IMPERFECT & PUNCHY: Use 1-2 short, human-like sentences. Avoid perfect grammar.
            4. LANGUAGE & SCRIPT (STRICT):
               - Requested Language: ${lang}
               - If Hindi or Pahadi: Use DEVANAGARI script ONLY. No English letters. (e.g. "बढ़िया सर्विस है")
               - If English: Use casual, conversational Indian-English style.
            5. TAG INTEGRATION: You MUST naturally weave in these specific concepts: ${tags.join(', ')}. 
            6. NO JARGON: Write like a person texting a friend. 
            
            GOAL: Write exactly 15-25 words. No hashtags. No quotes.
        `;

        const review = await callGemini(process.env.GEMINI_API_KEY, prompt, 0.9, "gemini-2.5-flash");

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
 * Professional AI Caller with Retry Logic for High Demand
 */
async function callGemini(apiKey, prompt, temperature = 0.7, modelName = "gemini-2.5-flash", schema = null) {
    if (!apiKey) {
        console.error("[Gemini] ERROR: API Key missing!");
        return null;
    }

    let attempts = 0;
    const maxAttempts = 3;
    const baseDelay = 2000; // 2 seconds

    while (attempts < maxAttempts) {
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    temperature,
                    ...(schema && { responseMimeType: "application/json", responseSchema: schema })
                }
            });

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }]
            });

            const response = await result.response;
            return response.text();
        } catch (e) {
            attempts++;
            const isServiceUnavailable = e.message.includes("503") || e.message.includes("Service Unavailable") || e.message.includes("high demand");
            
            if (isServiceUnavailable && attempts < maxAttempts) {
                const delay = baseDelay * Math.pow(2, attempts - 1);
                console.warn(`[Gemini] High demand (503). Retrying in ${delay}ms... (Attempt ${attempts}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            console.error(`[Gemini] SDK ERROR (Attempt ${attempts}):`, e.message);
            if (attempts >= maxAttempts) return null;
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

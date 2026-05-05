import express from 'express';
import prisma from '../config/db.js';

const router = express.Router();

/**
 * Public Redirect Route
 * GET /r/:shortCode
 */
router.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;

        // 1. Find the business by shortCode
        const business = await prisma.business.findUnique({
            where: { shortCode }
        });

        if (!business) {
            return res.status(404).send('Business not found');
        }

        // 2. Track the scan (Advanced Analytics)
        const ua = req.headers['user-agent'] || '';
        let deviceType = 'Desktop';
        if (/mobile/i.test(ua)) deviceType = 'Mobile';
        if (/tablet/i.test(ua)) deviceType = 'Tablet';

        let os = 'Other';
        if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
        else if (/android/i.test(ua)) os = 'Android';
        else if (/windows/i.test(ua)) os = 'Windows';
        else if (/macintosh/i.test(ua)) os = 'Mac';

        let browser = 'Other';
        if (/chrome|crios/i.test(ua)) browser = 'Chrome';
        else if (/safari/i.test(ua)) browser = 'Safari';
        else if (/firefox/i.test(ua)) browser = 'Firefox';
        else if (/edg/i.test(ua)) browser = 'Edge';

        await prisma.scanEvent.create({
            data: {
                businessId: business.id,
                userAgent: ua,
                deviceType,
                os,
                browser,
                ipHash: req.ip 
            }
        });

        // 3. Construct the Frontend Landing Page URL
        // In production, this would be your real domain
        const frontendUrl = `http://localhost:3000/review/${shortCode}`;

        // 4. Redirect the user to your landing page!
        console.log(`[Scan] Redirecting ${shortCode} to Landing Page: ${frontendUrl}`);
        res.redirect(frontendUrl);

    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Internal Server Error');
    }
});

export default router;

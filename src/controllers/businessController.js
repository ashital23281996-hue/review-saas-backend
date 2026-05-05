import prisma from '../config/db.js';
import { syncUser } from '../services/authService.js';
import { generateAndUploadQR } from '../services/qrService.js';
import crypto from 'crypto';

export const createBusiness = async (req, res) => {
    try {
        const { businessName, category, googlePlaceId, googleMapsUrl, logoUrl, reviewTone } = req.body;
        const { userId } = req.auth;

        const { clerkClient } = await import('@clerk/express');
        const clerkUser = await clerkClient.users.getUser(userId);
        const email = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;

        // Auto-sync user to ensure they exist in local DB
        const user = await syncUser(userId, email);

        // Generate a unique 6-character shortCode in the backend
        const shortCode = crypto.randomBytes(3).toString('hex').toLowerCase();

        // Generate and upload QR code to ImageKit (with optional logo)
        const qrCodeUrl = await generateAndUploadQR(shortCode, logoUrl);

        const business = await prisma.business.create({
            data: {
                userId: user.id,
                businessName,
                category: category,
                googlePlaceId,
                googleMapsUrl,
                logoUrl,
                shortCode,
                qrCodeUrl,
                reviewTone: reviewTone
            }
        });

        res.status(201).json(business);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'ShortCode or Google Place ID already exists.' });
        }
        res.status(500).json({ error: error.message });
    }
};

export const getMyBusinesses = async (req, res) => {
    try {
        const { userId: clerkId } = req.auth;

        // Find local user first
        const user = await prisma.user.findUnique({
            where: { clerkId }
        });

        if (!user) {
            return res.status(200).json([]); // User hasn't created anything yet
        }

        const businesses = await prisma.business.findMany({
            where: { userId: user.id },
            include: {
                _count: {
                    select: { scanEvents: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json(businesses);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get Detailed Analytics for a specific business
 */
export const getBusinessAnalytics = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId: clerkId } = req.auth;

        const business = await prisma.business.findUnique({
            where: { id },
            include: {
                scanEvents: {
                    orderBy: { scannedAt: 'desc' },
                    take: 100 // Last 100 scans for detail
                }
            }
        });

        if (!business) return res.status(404).json({ error: 'Business not found' });

        // Basic stats aggregation
        const stats = {
            totalScans: business.scanEvents.length,
            devices: {},
            os: {},
            browsers: {}
        };

        business.scanEvents.forEach(event => {
            stats.devices[event.deviceType] = (stats.devices[event.deviceType] || 0) + 1;
            stats.os[event.os] = (stats.os[event.os] || 0) + 1;
            stats.browsers[event.browser] = (stats.browsers[event.browser] || 0) + 1;
        });

        res.status(200).json({ business, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

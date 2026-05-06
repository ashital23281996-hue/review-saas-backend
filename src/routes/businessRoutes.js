import express from 'express';
import * as businessController from '../controllers/businessController.js';
import { requireAuth, requireMainUser } from '../middleware/auth.js';

const router = express.Router();

// All business routes require authentication
router.use(requireAuth);

// Allow any authenticated user to create businesses for testing
router.post('/', businessController.createBusiness);

// Get businesses for the logged in user
router.get('/my', businessController.getMyBusinesses);

// Get detailed analytics for a business
router.get('/:id/analytics', businessController.getBusinessAnalytics);

// Generate high-res marketing flyer
router.get('/:id/qr/flyer', businessController.getMarketingFlyer);

// Base route for other operations
router.get('/', businessController.getMyBusinesses);

export default router;

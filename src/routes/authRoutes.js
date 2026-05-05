import express from 'express';
import * as authController from '../controllers/authController.js';

const router = express.Router();

// Get current user profile (syncs with DB)
router.get('/me', authController.getMe);

export default router;

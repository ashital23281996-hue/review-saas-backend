import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { clerkMiddleware } from '@clerk/express';
import authRoutes from './routes/authRoutes.js';
import businessRoutes from './routes/businessRoutes.js';
import redirectRoutes from './routes/redirectRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import tagRoutes from './routes/tagRoutes.js';
import leadRoutes from './routes/leadRoutes.js';

// Debug: Check environment variables
console.log('--- Server Startup ---');
console.log('PORT:', process.env.PORT);
console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN);
console.log('CLERK_SECRET_KEY Loaded:', !!process.env.CLERK_SECRET_KEY);
const app = express();
app.set('trust proxy', 1);

// 1. GLOBAL MIDDLEWARE (Security & CORS First)
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(clerkMiddleware());

// 2. PUBLIC ROUTES
app.use('/api/public', publicRoutes);
app.use('/api/leads', leadRoutes);

// Global Request Logger
app.use((req, res, next) => {
    console.log(`[SERVER] ${req.method} ${req.url}`);
    next();
});

// Protected & Redirect Routes
app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/tags', tagRoutes);
app.use('/r', redirectRoutes);

// API Status & Health Check
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'Operational', 
        project: 'ReviewStack AI',
        message: 'ReviewStack AI Backend API is running smoothly.',
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Crash Catchers
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

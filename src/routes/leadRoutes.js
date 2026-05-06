import express from 'express';
import prisma from '../config/db.js';

const router = express.Router();

// POST /api/leads - Create a new lead from landing page
router.post('/', async (req, res) => {
    try {
        const { email, phone } = req.body;

        if (!email && !phone) {
            return res.status(400).json({ error: 'At least one contact field is required' });
        }

        const lead = await prisma.lead.create({
            data: {
                email,
                phone,
                status: 'New',
                source: 'Landing Page'
            }
        });

        console.log(`[LeadGen] New Lead: ${email} | ${phone}`);
        res.status(201).json({ success: true, lead });
    } catch (error) {
        console.error('[LeadGen] Error creating lead:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/leads - Get all leads
router.get('/', async (req, res) => {
    try {
        const leads = await prisma.lead.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(leads);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/leads/:id - Update lead status
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const updatedLead = await prisma.lead.update({
            where: { id },
            data: { status }
        });

        res.json(updatedLead);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/leads/:id - Delete a lead
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.lead.delete({
            where: { id }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

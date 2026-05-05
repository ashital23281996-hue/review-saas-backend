import express from 'express';
import { requireAuth } from '@clerk/express';
import prisma from '../config/db.js';

const router = express.Router();

// GET all tags with pagination and optional category filter
router.get('/', requireAuth(), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const category = req.query.category;
        const search = req.query.search;
        const language = req.query.language;
        const skip = (page - 1) * limit;

        const where = {};
        if (category) {
            where.category = category;
        }
        if (language) {
            where.language = language;
        }
        if (search) {
            where.OR = [
                { category: { contains: search, mode: 'insensitive' } },
                { tag: { contains: search, mode: 'insensitive' } }
            ];
        }

        const [tags, total] = await Promise.all([
            prisma.industryTag.findMany({
                where,
                skip,
                take: limit,
                orderBy: { category: 'asc' }
            }),
            prisma.industryTag.count({ where })
        ]);

        res.json({
            tags,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            totalCount: total
        });
    } catch (error) {
        console.error('[TagRoutes] Error fetching tags:', error);
        res.status(500).json({ error: 'Failed to fetch tags' });
    }
});

// POST new tag
router.post('/', requireAuth(), async (req, res) => {
    try {
        const { category, tag, icon, language } = req.body;
        if (!category || !tag) return res.status(400).json({ error: 'Category and Tag are required' });

        const newTag = await prisma.industryTag.create({
            data: { category, tag, icon, language: language || 'English' }
        });
        res.json(newTag);
    } catch (error) {
        console.error('[TagRoutes] Error creating tag:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'This tag already exists for this category.' });
        }
        res.status(500).json({ error: 'Failed to create tag' });
    }
});

// POST bulk create tags
router.post('/bulk', requireAuth(), async (req, res) => {
    try {
        const { tags } = req.body; // Array of { category, tag, icon }
        if (!Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ error: 'An array of tags is required' });
        }

        const result = await prisma.industryTag.createMany({
            data: tags,
            skipDuplicates: true // Will ignore if category/tag combo already exists
        });

        res.json({ success: true, count: result.count });
    } catch (error) {
        console.error('[TagRoutes] Error bulk creating tags:', error);
        res.status(500).json({ error: 'Failed to bulk create tags' });
    }
});

// PUT update tag
router.put('/:id', requireAuth(), async (req, res) => {
    try {
        const { id } = req.params;
        const { category, tag, icon, language } = req.body;

        const updatedTag = await prisma.industryTag.update({
            where: { id },
            data: { category, tag, icon, language }
        });
        res.json(updatedTag);
    } catch (error) {
        console.error('[TagRoutes] Error updating tag:', error);
        res.status(500).json({ error: 'Failed to update tag' });
    }
});

// DELETE tag
router.delete('/:id', requireAuth(), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.industryTag.delete({
            where: { id }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('[TagRoutes] Error deleting tag:', error);
        res.status(500).json({ error: 'Failed to delete tag' });
    }
});

export default router;

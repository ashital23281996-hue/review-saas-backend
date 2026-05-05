import * as authService from '../services/authService.js';
import { clerkClient } from '@clerk/express';

export const getMe = async (req, res) => {
    try {
        const { userId } = req.auth;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const clerkUser = await clerkClient.users.getUser(userId);
        const email = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;

        const user = await authService.syncUser(userId, email);

        res.status(200).json({
            ...user,
            isMainUser: email === process.env.MAIN_USER_EMAIL
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

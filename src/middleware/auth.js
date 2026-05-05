import { clerkClient, getAuth } from '@clerk/express';

export const requireAuth = (req, res, next) => {
    console.log('--- requireAuth Entry ---');
    console.log('Runtime Check - Secret Key Exists:', !!process.env.CLERK_SECRET_KEY);
    const auth = getAuth(req);
    console.log('--- Auth Debug ---');
    console.log('Auth Object:', JSON.stringify(auth, null, 2));
    
    if (!auth?.userId) {
        return res.status(401).json({ error: 'Unauthorized: Please log in first.' });
    }
    
    // Attach auth to request for next middlewares
    req.auth = auth;
    next();
};

export const requireMainUser = async (req, res, next) => {
    try {
        const { userId } = req.auth; // Populated by requireAuth middleware
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await clerkClient.users.getUser(userId);
        const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress;

        console.log('--- Main User Check ---');
        console.log('Logged in as:', email);
        console.log('Required email:', process.env.MAIN_USER_EMAIL);

        if (email !== process.env.MAIN_USER_EMAIL) {
            return res.status(403).json({ error: 'Access denied: Only the main user can perform this action.' });
        }

        req.clerkUser = user;
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

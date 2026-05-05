import prisma from '../config/db.js';

export const syncUser = async (clerkId, email) => {
    // Check if user exists
    let user = await prisma.user.findUnique({
        where: { clerkId }
    });

    if (!user) {
        // Create user if they don't exist
        user = await prisma.user.create({
            data: {
                clerkId,
                email
            }
        });
    } else if (user.email !== email) {
        // Update email if it changed
        user = await prisma.user.update({
            where: { clerkId },
            data: { email }
        });
    }

    return user;
};

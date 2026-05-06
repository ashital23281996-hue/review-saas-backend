import ImageKit from 'imagekit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import dotenv from 'dotenv';
dotenv.config();

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

/**
 * Generates a branded QR code with a logo and uploads it to ImageKit
 * @param {string} shortCode The unique business code
 * @param {string} logoUrl Optional URL of the logo to embed
 * @returns {Promise<string>} The URL of the uploaded image
 */
/**
 * Generates a high-quality marketing flyer (Portrait) with Logo, Name, and QR
 * Optimized for counter stands and printing.
 */
export const generateMarketingFlyer = async (businessName, logoUrl, qrUrl) => {
    try {
        const WIDTH = 1200;
        const HEIGHT = 1800;
        const BG_COLOR = { r: 255, g: 255, b: 255, alpha: 1 };

        // 1. Fetch Logo and QR
        const [logoRes, qrRes] = await Promise.all([
            logoUrl ? fetch(logoUrl).then(r => r.arrayBuffer()) : null,
            fetch(qrUrl).then(r => r.arrayBuffer())
        ]);

        const qrBuffer = Buffer.from(qrRes);
        const logoBuffer = logoRes ? Buffer.from(logoRes) : null;

        // 2. Create the Background Canvas
        let flyer = sharp({
            create: {
                width: WIDTH,
                height: HEIGHT,
                channels: 4,
                background: BG_COLOR
            }
        });

        // 3. Prepare Components
        const composites = [];

        // A. Logo (Top Center)
        if (logoBuffer) {
            const processedLogo = await sharp(logoBuffer)
                .resize(350, 350, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                .toBuffer();
            composites.push({ input: processedLogo, top: 150, left: (WIDTH - 350) / 2 });
        }

        // B. Text Header (Using SVG for sharp text)
        const nameSvg = `
            <svg width="${WIDTH}" height="200">
                <style>
                    .title { fill: #000; font-size: 80px; font-weight: 900; font-family: sans-serif; text-transform: uppercase; letter-spacing: -2px; }
                    .subtitle { fill: #666; font-size: 40px; font-weight: 700; font-family: sans-serif; text-transform: uppercase; letter-spacing: 4px; }
                </style>
                <text x="50%" y="80" text-anchor="middle" class="title">${businessName}</text>
                <text x="50%" y="150" text-anchor="middle" class="subtitle">Help us grow with a review!</text>
            </svg>
        `;
        composites.push({ input: Buffer.from(nameSvg), top: logoBuffer ? 550 : 300, left: 0 });

        // C. QR Code (Center)
        const processedQr = await sharp(qrBuffer)
            .resize(700, 700)
            .toBuffer();
        composites.push({ input: processedQr, top: logoBuffer ? 850 : 600, left: (WIDTH - 700) / 2 });

        // D. Footer Instruction
        const footerSvg = `
            <svg width="${WIDTH}" height="150">
                <style>
                    .instruction { fill: #000; font-size: 35px; font-weight: 900; font-family: sans-serif; text-transform: uppercase; }
                    .brand { fill: #999; font-size: 20px; font-weight: 700; font-family: sans-serif; text-transform: uppercase; letter-spacing: 2px; }
                </style>
                <text x="50%" y="50" text-anchor="middle" class="instruction">Scan with your camera</text>
                <text x="50%" y="100" text-anchor="middle" class="brand">Powered by AI Google Review</text>
            </svg>
        `;
        composites.push({ input: Buffer.from(footerSvg), top: HEIGHT - 200, left: 0 });

        // 4. Build Final Flyer
        return await flyer.composite(composites).png().toBuffer();
    } catch (error) {
        console.error('Error generating marketing flyer:', error);
        throw error;
    }
};

export const generateAndUploadQR = async (shortCode, logoUrl = null) => {
    try {
        const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/review/${shortCode}`;
        const SIZE = 1024; // High res for print
        const LOGO_SIZE = 250;

        // 1. Generate the base QR Code as a PNG buffer
        const qrBuffer = await QRCode.toBuffer(redirectUrl, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: SIZE,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });

        let finalBuffer = qrBuffer;

        // 2. If a logo is provided, merge it using sharp
        if (logoUrl) {
            try {
                // Fetch the logo image
                const logoResponse = await fetch(logoUrl);
                const logoArrayBuffer = await logoResponse.arrayBuffer();
                const logoBuffer = Buffer.from(logoArrayBuffer);

                // Process logo: Resize and add a solid white circular mask/background
                // This ensures the QR pixels don't bleed into the logo
                const logoResize = await sharp(logoBuffer)
                    .resize(LOGO_SIZE - 40, LOGO_SIZE - 40, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                    .toBuffer();

                const processedLogo = await sharp({
                    create: {
                        width: LOGO_SIZE,
                        height: LOGO_SIZE,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                    }
                })
                .composite([{
                    input: logoResize,
                    gravity: 'center'
                }])
                .png()
                .toBuffer();

                // Composite the logo onto the center of the QR code
                finalBuffer = await sharp(qrBuffer)
                    .composite([{
                        input: processedLogo,
                        gravity: 'center'
                    }])
                    .toBuffer();
            } catch (logoError) {
                console.error('Error processing logo, falling back to plain QR:', logoError);
                // Fallback to qrBuffer is already handled by initial value
            }
        }

        // 3. Upload to ImageKit
        const uploadResponse = await imagekit.upload({
            file: finalBuffer,
            fileName: `qr_${shortCode}.png`,
            folder: '/qrcodes/',
            useUniqueFileName: true,
            tags: ['qr_code', shortCode]
        });

        return uploadResponse.url;
    } catch (error) {
        console.error('Error in generateAndUploadQR:', error);
        throw new Error('Failed to generate or upload branded QR code');
    }
};

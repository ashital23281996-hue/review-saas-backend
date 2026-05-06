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

export const OLD_SHORTCODE_MAP = {
    '7af7c44f-8f61-44b8-b9eb-53c3e27ca3ba-aeet': 'himachal-health-and-hygiene-traders-aeet',
    '7c84a39c-3838-4411-887b-0476a28db501-rltl': 'cafe-albatraoz-rltl'
};

/**
 * Resolves a potentially old UUID shortcode to its new friendly SEO slug
 * @param {string} shortCode Input shortcode from route param
 * @returns {string} The resolved SEO slug shortcode
 */
export const resolveShortCode = (shortCode) => {
    if (!shortCode) return shortCode;
    return OLD_SHORTCODE_MAP[shortCode] || shortCode;
};

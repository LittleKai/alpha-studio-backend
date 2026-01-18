/**
 * Vietnamese diacritics mapping for URL-friendly slugs
 */
const vietnameseMap = {
    'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
    'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
    'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
    'đ': 'd',
    'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
    'ê': 'e', 'ề': 'e', 'ế': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
    'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
    'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
    'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
    'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
    'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
    'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
    'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
    // Uppercase
    'À': 'a', 'Á': 'a', 'Ả': 'a', 'Ã': 'a', 'Ạ': 'a',
    'Ă': 'a', 'Ằ': 'a', 'Ắ': 'a', 'Ẳ': 'a', 'Ẵ': 'a', 'Ặ': 'a',
    'Â': 'a', 'Ầ': 'a', 'Ấ': 'a', 'Ẩ': 'a', 'Ẫ': 'a', 'Ậ': 'a',
    'Đ': 'd',
    'È': 'e', 'É': 'e', 'Ẻ': 'e', 'Ẽ': 'e', 'Ẹ': 'e',
    'Ê': 'e', 'Ề': 'e', 'Ế': 'e', 'Ể': 'e', 'Ễ': 'e', 'Ệ': 'e',
    'Ì': 'i', 'Í': 'i', 'Ỉ': 'i', 'Ĩ': 'i', 'Ị': 'i',
    'Ò': 'o', 'Ó': 'o', 'Ỏ': 'o', 'Õ': 'o', 'Ọ': 'o',
    'Ô': 'o', 'Ồ': 'o', 'Ố': 'o', 'Ổ': 'o', 'Ỗ': 'o', 'Ộ': 'o',
    'Ơ': 'o', 'Ờ': 'o', 'Ớ': 'o', 'Ở': 'o', 'Ỡ': 'o', 'Ợ': 'o',
    'Ù': 'u', 'Ú': 'u', 'Ủ': 'u', 'Ũ': 'u', 'Ụ': 'u',
    'Ư': 'u', 'Ừ': 'u', 'Ứ': 'u', 'Ử': 'u', 'Ữ': 'u', 'Ự': 'u',
    'Ỳ': 'y', 'Ý': 'y', 'Ỷ': 'y', 'Ỹ': 'y', 'Ỵ': 'y'
};

/**
 * Remove Vietnamese diacritics from a string
 */
function removeVietnameseDiacritics(str) {
    return str.split('').map(char => vietnameseMap[char] || char).join('');
}

/**
 * Generate a URL-friendly slug from a string
 * - Handles Vietnamese characters
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters
 *
 * @param {string} text The text to convert to a slug
 * @returns {string} URL-friendly slug
 *
 * @example
 * slugify("Khóa học React") // "khoa-hoc-react"
 * slugify("AI Design Expert 2026") // "ai-design-expert-2026"
 * slugify("Nguyễn Văn A") // "nguyen-van-a"
 */
export function slugify(text) {
    if (!text) return '';

    return removeVietnameseDiacritics(text)
        .toLowerCase()
        .trim()
        // Replace spaces and underscores with hyphens
        .replace(/[\s_]+/g, '-')
        // Remove special characters except hyphens and alphanumerics
        .replace(/[^a-z0-9-]/g, '')
        // Replace multiple hyphens with single hyphen
        .replace(/-+/g, '-')
        // Remove leading and trailing hyphens
        .replace(/^-|-$/g, '');
}

/**
 * Generate a unique slug by appending a number if needed
 * For use when slugs must be unique (e.g., in database)
 *
 * @param {string} text The text to convert to a slug
 * @param {string[]} existingSlugs Array of existing slugs to check against
 * @returns {string} Unique slug
 *
 * @example
 * generateUniqueSlug("React Course", ["react-course"]) // "react-course-2"
 */
export function generateUniqueSlug(text, existingSlugs) {
    const baseSlug = slugify(text);

    if (!existingSlugs.includes(baseSlug)) {
        return baseSlug;
    }

    let counter = 2;
    let uniqueSlug = `${baseSlug}-${counter}`;

    while (existingSlugs.includes(uniqueSlug)) {
        counter++;
        uniqueSlug = `${baseSlug}-${counter}`;
    }

    return uniqueSlug;
}

/**
 * Generate unique slug for MongoDB by checking the collection
 *
 * @param {string} text The text to convert to a slug
 * @param {Object} Model The Mongoose model
 * @param {string} excludeId Optional ID to exclude from check (for updates)
 * @returns {Promise<string>} Unique slug
 */
export async function generateUniqueSlugForModel(text, Model, excludeId = null) {
    const baseSlug = slugify(text);

    // Check if base slug exists
    const query = { slug: baseSlug };
    if (excludeId) {
        query._id = { $ne: excludeId };
    }

    const existing = await Model.findOne(query);

    if (!existing) {
        return baseSlug;
    }

    // Find unique slug with counter
    let counter = 2;
    let uniqueSlug = `${baseSlug}-${counter}`;

    while (true) {
        const checkQuery = { slug: uniqueSlug };
        if (excludeId) {
            checkQuery._id = { $ne: excludeId };
        }

        const exists = await Model.findOne(checkQuery);
        if (!exists) {
            return uniqueSlug;
        }

        counter++;
        uniqueSlug = `${baseSlug}-${counter}`;
    }
}

export default slugify;

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Gets the current user ID for database operations.
 * Since switching away from Supabase Auth, we use a default ID for this single-user environment.
 */
export function getUserId() {
    return DEFAULT_USER_ID;
}

/**
 * Mock user object to replace Supabase user
 */
export const MOCK_USER = {
    id: DEFAULT_USER_ID,
    email: 'investor@coin.local',
    user_metadata: {
        full_name: 'Default Investor'
    }
};

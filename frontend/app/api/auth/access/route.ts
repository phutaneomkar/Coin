import { NextResponse } from 'next/server';

export async function POST() {
    const response = NextResponse.json({ success: true });

    // Set a long-lived cookie to maintain "login" state
    response.cookies.set('app_access', 'true', {
        httpOnly: true,
        secure: false, // Ensure it works on localhost (HTTP)
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    return response;
}

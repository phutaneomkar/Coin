'use client';

import Link from 'next/link'

export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
            <h2 className="text-2xl font-bold mb-4">Not Found</h2>
            <p className="mb-4">Could not find requested resource</p>
            <a href="/" className="text-blue-500 hover:underline">
                Return Home
            </a>
        </div>
    )
}

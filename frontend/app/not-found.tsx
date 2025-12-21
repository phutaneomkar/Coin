import Link from 'next/link'

export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
            <h2 className="text-2xl font-bold mb-4">Not Found</h2>
            <p className="mb-4">Could not find requested resource</p>
            <Link
                href="/dashboard"
                className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 transition-colors"
            >
                Return Home
            </Link>
        </div>
    )
}

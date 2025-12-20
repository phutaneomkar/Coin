'use client';

import { Toaster } from "react-hot-toast";

export function ToasterProvider() {
    return (
        <Toaster
            position="top-right"
            toastOptions={{
                style: {
                    background: '#1f2937',
                    color: '#f9fafb',
                    border: '1px solid #374151',
                },
                success: {
                    iconTheme: {
                        primary: '#10b981',
                        secondary: '#f9fafb',
                    },
                },
                error: {
                    iconTheme: {
                        primary: '#ef4444',
                        secondary: '#f9fafb',
                    },
                },
            }}
        />
    );
}

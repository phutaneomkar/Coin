"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AutomationControl() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        amount: "100",
        profit_percentage: "1.0",
        total_iterations: "5",
        duration_minutes: "60",
    });
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserId(user.id);
            } else {
                setMessage({ type: "error", text: "User not authenticated" });
            }
        };
        fetchUser();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        // Basic Validation
        if (parseFloat(formData.amount) <= 0) {
            setMessage({ type: "error", text: "Amount must be greater than 0" });
            setLoading(false);
            return;
        }

        if (!userId) {
            setMessage({ type: "error", text: "User not authenticated. Please log in." });
            setLoading(false);
            return;
        }

        try {
            const res = await fetch("/api/automation/start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    amount: formData.amount,
                    profit_percentage: formData.profit_percentage,
                    total_iterations: parseInt(formData.total_iterations),
                    duration_minutes: parseInt(formData.duration_minutes),
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                console.error("Start Automation Error Response:", data);
                throw new Error(data.error || data.message || "Failed to start automation");
            }

            setMessage({ type: "success", text: "Automation Strategy Started Successfully!" });
            // Reset form or redirect? Maybe just refresh the list below
            router.refresh();
            // Force reload to update ActiveStrategies list if it doesn't auto-refresh
            window.location.reload();
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">🚀 New Automation Strategy</h2>

            {message && (
                <div className={`p-3 mb-4 rounded ${message.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Investment Amount per Trade ($)
                        </label>
                        <input
                            type="number"
                            name="amount"
                            value={formData.amount}
                            onChange={handleChange}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Target Profit (%)
                        </label>
                        <input
                            type="number"
                            step="0.1"
                            name="profit_percentage"
                            value={formData.profit_percentage}
                            onChange={handleChange}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Max Trades (Iterations)
                        </label>
                        <input
                            type="number"
                            name="total_iterations"
                            value={formData.total_iterations}
                            onChange={handleChange}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Duration (Minutes)
                        </label>
                        <input
                            type="number"
                            name="duration_minutes"
                            value={formData.duration_minutes}
                            onChange={handleChange}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3 px-4 rounded font-bold text-white transition-colors ${loading
                        ? "bg-gray-600 cursor-not-allowed"
                        : "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                        }`}
                >
                    {loading ? "Starting..." : "Start Automation"}
                </button>
            </form>
        </div>
    );
}

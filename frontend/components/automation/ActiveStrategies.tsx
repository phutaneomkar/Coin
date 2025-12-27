"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Strategy {
    id: string;
    amount: number;
    profit_percentage: number;
    total_iterations: number;
    iterations_completed: number;
    duration_minutes: number;
    status: string;
    current_coin_id: string | null;
    created_at: string;
}

export default function ActiveStrategies() {
    const router = useRouter();
    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchStrategies = async () => {
        try {
            const res = await fetch("/api/automation/strategies");
            if (!res.ok) throw new Error("Failed to fetch strategies");
            const data = await res.json();
            setStrategies(data);
        } catch (error) {
            console.error("Error fetching strategies:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStrategies();
        // Poll every 5 seconds to update status
        const interval = setInterval(fetchStrategies, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleStop = async (id: string) => {
        if (!confirm("Are you sure you want to stop this strategy?")) return;

        try {
            const res = await fetch(`/api/automation/${id}/stop`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to stop strategy");
            fetchStrategies(); // Refresh immediately
        } catch (error) {
            alert("Error stopping strategy");
        }
    };

    const handlePanic = async (id: string) => {
        if (!confirm("⚠️ WARNING: This will immediately SELL your current position at MARKET PRICE. You may lose money if the price dropped. Are you sure?")) return;

        try {
            const res = await fetch(`/api/automation/${id}/panic`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to force exit");
            alert("Position sold and strategy stopped.");
            fetchStrategies(); // Refresh immediately
        } catch (error) {
            alert("Error executing force exit");
        }
    };

    if (loading) {
        return <div className="text-gray-400">Loading strategies...</div>;
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">📊 Active Strategies</h2>

            {strategies.length === 0 ? (
                <p className="text-gray-400">No active strategies found.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-gray-900 text-gray-200 uppercase font-medium">
                            <tr>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Invested</th>
                                <th className="px-4 py-3">Profit Target</th>
                                <th className="px-4 py-3">Progress</th>
                                <th className="px-4 py-3">Current Action</th>
                                <th className="px-4 py-3">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {strategies.map((strategy) => (
                                <tr key={strategy.id} className="hover:bg-gray-750 transition-colors">
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${strategy.status === 'running' ? 'bg-green-900 text-green-300' :
                                            strategy.status === 'stopped' ? 'bg-red-900 text-red-300' :
                                                'bg-gray-700 text-gray-300'
                                            }`}>
                                            {strategy.status.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">${strategy.amount}</td>
                                    <td className="px-4 py-3 text-green-400">+{strategy.profit_percentage}%</td>
                                    <td className="px-4 py-3">
                                        {strategy.iterations_completed} / {strategy.total_iterations} trades
                                    </td>
                                    <td className="px-4 py-3">
                                        {strategy.current_coin_id ? (
                                            <span className="text-blue-400 animate-pulse">
                                                Holding {strategy.current_coin_id.toUpperCase()}
                                            </span>
                                        ) : strategy.status === 'running' ? (
                                            <span className="text-yellow-500">Scanning Market...</span>
                                        ) : (
                                            <span>-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        {strategy.status === 'running' && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleStop(strategy.id)}
                                                    className="text-red-400 hover:text-red-300 font-semibold"
                                                >
                                                    Stop
                                                </button>
                                                {strategy.current_coin_id && (
                                                    <button
                                                        onClick={() => handlePanic(strategy.id)}
                                                        className="bg-red-600 hover:bg-red-700 text-white text-xs px-2 py-1 rounded font-bold uppercase"
                                                        title="Immediately sell current position at market price and stop strategy"
                                                    >
                                                        Force Sell
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

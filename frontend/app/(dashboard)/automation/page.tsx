'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Play, Pause, Square, Clock, DollarSign, Percent, Save, Hash } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { createClient } from '../../../lib/supabase/client';

export default function AutomationPage() {
  const [priceLimit, setPriceLimit] = useState('');
  const [percentage, setPercentage] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [orderType, setOrderType] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const supabase = createClient();

  useEffect(() => {
    fetchHistory();
    // Refresh history every 10s
    const interval = setInterval(fetchHistory, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchHistory = async () => {
    try {
      // Use the proxy endpoint which handles authentication (cookie or session)
      const res = await fetch('/api/automation/strategies');
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      } else {
        const errText = await res.text();
        console.error('Failed to fetch strategies history:', res.status, errText);
        toast.error(`Failed to load history: ${res.status}`);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const handleStart = async () => {
    if (!priceLimit || !percentage || !orderType || (!hours && !minutes)) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/automation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: priceLimit,
          profit_percentage: percentage,
          total_iterations: parseInt(orderType),
          duration_minutes: (parseInt(hours || '0') * 60) + parseInt(minutes || '0'),
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success('Automation Strategy Started!');
        fetchHistory();
        // Clear form? Maybe keep for repetition.
      } else {
        toast.error(data.error || 'Failed to start automation');
      }
    } catch (error) {
      toast.error('Error starting automation');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      const res = await fetch(`/api/automation/${id}/stop`, {
        method: 'POST',
      });

      if (res.ok) {
        toast.success('Strategy Stopped');
        fetchHistory();
      } else {
        const data = await res.json();
        toast.error(data.message || 'Failed to stop strategy');
      }
    } catch (error) {
      console.error('Stop error:', error);
      toast.error('Error stopping strategy');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-8">Automation</h1>

      <div className="bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
          <Play className="w-5 h-5 text-blue-400" />
          Create New Strategy
        </h2>

        <form className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Price Limit */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Price Limit (Amount to Invest)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <DollarSign className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  type="number"
                  value={priceLimit}
                  onChange={(e) => setPriceLimit(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none placeholder-gray-500 transition-colors"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Percentage */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Profit Percentage
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Percent className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  type="number"
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none placeholder-gray-500 transition-colors"
                  placeholder="0-100"
                />
              </div>
            </div>

            {/* Order Type (Number) */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Number of Orders (Iterations)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Hash className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  type="number"
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none placeholder-gray-500 transition-colors"
                  placeholder="Enter number of trades"
                />
              </div>
            </div>

            {/* Time Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Time Duration
              </label>
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Clock className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    type="number"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg pl-10 pr-12 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none placeholder-gray-500 transition-colors"
                    placeholder="0"
                    min="0"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-sm">Hrs</span>
                  </div>
                </div>

                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Clock className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    type="number"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg pl-10 pr-12 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none placeholder-gray-500 transition-colors"
                    placeholder="0"
                    min="0"
                    max="59"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-sm">Min</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-700 flex gap-4">
            <button
              type="button"
              onClick={handleStart}
              disabled={isLoading}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-4 rounded-lg shadow-lg transform transition hover:scale-[1.02] flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" />
              {isLoading ? 'STARTING...' : 'START'}
            </button>
            <button
              type="button"
              className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-4 rounded-lg shadow-lg transform transition hover:scale-[1.02] flex items-center justify-center gap-2"
            >
              <Pause className="w-5 h-5 fill-current" />
              PAUSE
            </button>
            <button
              type="button"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-lg shadow-lg transform transition hover:scale-[1.02] flex items-center justify-center gap-2"
            >
              <Square className="w-5 h-5 fill-current" />
              STOP
            </button>
          </div>
        </form>
      </div>

      {/* History Section */}
      <div className="mt-8">
        <h2 className="text-2xl font-bold text-white mb-6">Strategy History</h2>
        <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-700/50 border-b border-gray-700">
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Started At</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Params</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Progress</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Status</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No strategies found. Start one above!
                    </td>
                  </tr>
                ) : (
                  history.map((strategy) => (
                    <tr key={strategy.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-6 py-4 text-gray-300">
                        {new Date(strategy.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-gray-300">
                        Invest: ${strategy.amount} | Target: {strategy.profit_percentage}%
                      </td>
                      <td className="px-6 py-4 text-gray-300">
                        {strategy.iterations_completed} / {strategy.total_iterations} Iterations
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${strategy.status === 'running' ? 'bg-green-900/50 text-green-400' :
                          strategy.status === 'completed' ? 'bg-blue-900/50 text-blue-400' :
                            'bg-red-900/50 text-red-400'
                          }`}>
                          {strategy.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {strategy.status === 'running' && (
                          <button
                            onClick={() => handleStop(strategy.id)}
                            className="text-red-400 hover:text-red-300 text-sm font-medium"
                          >
                            Stop
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}


'use client';

import { useState } from 'react';
import { Play, Pause, Square, Clock, DollarSign, Percent, Save, Hash } from 'lucide-react';

export default function AutomationPage() {
  const [priceLimit, setPriceLimit] = useState('');
  const [percentage, setPercentage] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [orderType, setOrderType] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log({
      priceLimit,
      percentage,
      duration: { hours, minutes },
      orderType
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-8">Automation</h1>

      <div className="bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
          <Play className="w-5 h-5 text-blue-400" />
          Create New Strategy
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Price Limit */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Price Limit
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
                Percentage
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
                Order
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
                  placeholder="Enter type number"
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
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-lg shadow-lg transform transition hover:scale-[1.02] flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" />
              START
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
        <h2 className="text-2xl font-bold text-white mb-6">History</h2>
        <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-700/50 border-b border-gray-700">
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Date</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Type</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Strategy</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Duration</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2">Status</th>
                  <th className="px-6 py-4 text-gray-400 font-medium pb-2 text-right">Profit/Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {[1, 2, 3].map((i) => (
                  <tr key={i} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4 text-gray-300">
                      2024-03-{10 + i} 14:30
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${i % 2 === 0 ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                        }`}>
                        {i % 2 === 0 ? 'BUY' : 'SELL'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      Limit: $1.9{i} | 5%
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      4h 30m
                    </td>
                    <td className="px-6 py-4">
                      <span className="flex items-center text-green-400 gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                        Completed
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-green-400">
                      +$12{i}.50
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}


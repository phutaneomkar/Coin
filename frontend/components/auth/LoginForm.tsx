'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { LoadingSpinner } from '../shared/LoadingSpinner';

export function LoginForm() {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Calculate expected dynamic password: DayHHMM* (e.g., Thu0430*)
    const now = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = days[now.getDay()];
    let hours = now.getHours();
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const hoursStr = hours.toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const expectedPassword = `${day}${hoursStr}${minutes}*`;

    if (password !== expectedPassword) {
      toast.error('Invalid Security Code');
      setIsLoading(false);
      return;
    }

    try {
      // Call session stamper to set cookie
      const res = await fetch('/api/auth/access', { method: 'POST' });

      if (!res.ok) {
        throw new Error('Session creation failed');
      }

      toast.success('Access Granted');
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      toast.error('Login failed');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <form onSubmit={handleLogin} className="space-y-6">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
            Security Code
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
            placeholder="Enter daily code..."
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {isLoading ? <LoadingSpinner size="sm" /> : 'Access Dashboard'}
        </button>
      </form>
    </div>
  );
}


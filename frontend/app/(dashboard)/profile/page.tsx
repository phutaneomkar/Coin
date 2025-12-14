'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { User } from '@/types';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { toast } from 'react-hot-toast';
import { Plus } from 'lucide-react';

export default function ProfilePage() {
  const [profile, setProfile] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [addBalanceAmount, setAddBalanceAmount] = useState('');
  const [isAddingBalance, setIsAddingBalance] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        // Check if it's a 404 (table doesn't exist)
        if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
          console.error('Database tables not found. Please run the schema.sql in Supabase SQL Editor.');
          console.error('See SETUP_DATABASE.md for instructions.');
          return;
        }
        throw error;
      }
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBalance = async () => {
    const amount = parseFloat(addBalanceAmount);
    
    if (!addBalanceAmount || isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (amount > 1000000) {
      toast.error('Maximum deposit amount is $1,000,000');
      return;
    }

    setIsAddingBalance(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error('Please login');
        return;
      }

      // Get current balance
      const { data: currentProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('balance_inr')
        .eq('id', user.id)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      const newBalance = (currentProfile?.balance_inr || 0) + amount;

      // Update balance
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ balance_inr: newBalance })
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }

      toast.success(`Successfully added $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to your balance`);
      setAddBalanceAmount('');
      fetchProfile(); // Refresh profile data
    } catch (error) {
      console.error('Error adding balance:', error);
      toast.error('Failed to add balance. Please try again.');
    } finally {
      setIsAddingBalance(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile) {
    return <div>Profile not found</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Profile</h1>
      <div className="bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300">Email</label>
            <p className="mt-1 text-white">{profile.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Full Name</label>
            <p className="mt-1 text-white">{profile.full_name || 'Not set'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Phone</label>
            <p className="mt-1 text-white">{profile.phone || 'Not set'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">Balance (USD)</label>
            <p className="mt-1 text-2xl font-bold text-white">
              ${profile.balance_inr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          
          {/* Add Balance Section */}
          <div className="mt-6 pt-6 border-t border-gray-700">
            <label className="block text-sm font-medium text-gray-300 mb-2">Add Balance</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={addBalanceAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  // Allow only numbers and decimal point
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setAddBalanceAmount(value);
                  }
                }}
                placeholder="Enter amount"
                className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                onKeyPress={(e) => e.key === 'Enter' && handleAddBalance()}
              />
              <button
                onClick={handleAddBalance}
                disabled={isAddingBalance}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingBalance ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Add
                  </>
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Enter the amount you want to add to your balance (in USD)
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300">KYC Status</label>
            <p className="mt-1">
              <span
                className={`px-2 py-1 rounded text-sm ${
                  profile.kyc_status === 'verified'
                    ? 'bg-green-900 text-green-300'
                    : profile.kyc_status === 'rejected'
                    ? 'bg-red-900 text-red-300'
                    : 'bg-yellow-900 text-yellow-300'
                }`}
              >
                {profile.kyc_status}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


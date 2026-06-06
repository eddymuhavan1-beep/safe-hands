'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { validateField, validatePhone, normalizePhone } from '@/lib/validation';
import { useAuth } from '@/context/AuthContext';

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [messageTimeout, setMessageTimeout] = useState(null);
  const [buyerMoneySummary, setBuyerMoneySummary] = useState(null);

  const [formData, setFormData] = useState({
    full_name: '',
    phone_number: '',
    bio: '',
    profile_picture_url: '',
  });

  const withTimeout = async (promise, ms, fallbackMessage) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(fallbackMessage || 'Operation timed out')),
        ms
      );
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Fetch profile using our unified API
  const fetchProfile = async () => {
    try {
      // Get the access token from localStorage
      const { supabase } = await import('@/lib/supabaseClient');
      const {
        data: { session },
      } = await withTimeout(
        supabase.auth.getSession(),
        10000,
        'Session check timed out'
      );

      if (!session?.access_token) {
        router.push('/auth/login');
        setLoading(false);
        return;
      }

      // Fetch profile with Authorization header
      const response = await withTimeout(
        fetch('/api/user/profile', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        12000,
        'Profile API timed out'
      );

      if (response.status === 401) {
        router.push('/auth/login');
        return;
      }

      const result = await response.json();

      if (result.success && result.data) {
        setProfile(result.data);
        setFormData({
          full_name: result.data.full_name || '',
          phone_number: result.data.phone_number || '',
          bio: result.data.bio || '',
          profile_picture_url: result.data.profile_picture_url || '',
        });

        if (['buyer', 'buyer_seller'].includes(result.data.role)) {
          try {
            const payRes = await fetch('/api/buyer/payments', {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (payRes.ok) {
              const payBody = await payRes.json();
              if (payBody.summary) setBuyerMoneySummary(payBody.summary);
            }
          } catch (payErr) {
            console.error('Error fetching buyer payment summary:', payErr);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/auth/login');
      setLoading(false);
      return;
    }
    fetchProfile();
  }, [authLoading, user, router]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setErrors({});
    setSuccessMessage('');

    // Validate
    if (!formData.full_name.trim()) {
      setErrors({ full_name: 'Full name is required' });
      return;
    }

    if (formData.phone_number && !validatePhone(formData.phone_number)) {
      setErrors({ phone_number: 'Invalid phone number format' });
      return;
    }

    setSaving(true);

    try {
      // Ensure we have an access token for authenticated API calls
      const { supabase } = await import('@/lib/supabaseClient');
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push('/auth/login');
        setSaving(false);
        return;
      }

      const updateData = {
        full_name: formData.full_name.trim(),
        phone: formData.phone_number
          ? normalizePhone(formData.phone_number)
          : null,
        bio: formData.bio.trim(),
        profile_picture_url: formData.profile_picture_url.trim(),
      };

      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(updateData),
      });

      const result = await response.json();

      if (!response.ok) {
        setErrors({ form: result.error || 'Failed to update profile' });
        return;
      }

      // Update local profile
      setProfile(result.data);
      setSuccessMessage('Profile updated successfully!');
      setEditing(false);

      // Clear message after 3 seconds
      if (messageTimeout) clearTimeout(messageTimeout);
      const timeout = setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
      setMessageTimeout(timeout);
    } catch (error) {
      console.error('Error updating profile:', error);
      setErrors({ form: 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      const { supabase } = await import('@/lib/supabaseClient');
      await supabase.auth.signOut();
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const getRoleDisplay = (role) => {
    switch (role) {
      case 'buyer_seller':
        return 'Buyer & Seller';
      case 'admin':
        return 'Administrator';
      default:
        return role?.charAt(0).toUpperCase() + role?.slice(1) || 'User';
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'buyer':
        return 'bg-blue-100 text-blue-800';
      case 'seller':
        return 'bg-green-100 text-green-800';
      case 'buyer_seller':
        return 'bg-purple-100 text-purple-800';
      case 'admin':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getKYCStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Profile</h1>
        <p className="text-gray-600 mt-1">
          Manage your account information and preferences
        </p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <svg
            className="w-5 h-5 text-green-600 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
          </svg>
          <p className="text-green-700 font-medium text-sm">{successMessage}</p>
        </div>
      )}

      {/* Error Message */}
      {errors.form && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <svg
            className="w-5 h-5 text-red-600 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <p className="text-red-700 font-medium text-sm">{errors.form}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="md:col-span-1">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 text-center">
            {/* Avatar */}
            <div className="mb-4">
              {profile?.profile_picture_url ? (
                <img
                  src={profile.profile_picture_url}
                  alt={profile.full_name}
                  className="w-24 h-24 rounded-full mx-auto object-cover border-4 border-blue-100"
                />
              ) : (
                <div className="w-24 h-24 rounded-full mx-auto bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold border-4 border-blue-100">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
              )}
            </div>

            {/* Name and Role */}
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {profile?.full_name || 'Not provided'}
            </h2>

            <span
              className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getRoleColor(profile?.role)}`}
            >
              {getRoleDisplay(profile?.role)}
            </span>

            {/* Email */}
            <p className="text-sm text-gray-600 mt-4 break-all">
              {profile?.email}
            </p>

            {/* Email Verified Badge */}
            <div className="mt-3 flex items-center justify-center">
              {profile?.email_verified ? (
                <span className="flex items-center text-xs text-green-600">
                  <svg
                    className="w-4 h-4 mr-1"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Verified
                </span>
              ) : (
                <span className="text-xs text-yellow-600">Not verified</span>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-white rounded-lg shadow p-6 mt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              Account Stats
            </h3>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Transactions</span>
                <span className="font-semibold text-gray-900">
                  {profile?.total_transactions_completed || 0}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Rating</span>
                <span className="font-semibold text-gray-900">
                  {profile?.avg_rating ? `${profile.avg_rating} ⭐` : 'N/A'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                {profile?.role === 'seller' || profile?.role === 'buyer_seller' ? (
                  <>
                    <span className="text-sm text-gray-600">Seller wallet</span>
                    <Link
                      href="/dashboard/seller/wallet"
                      className="font-semibold text-emerald-700 hover:text-emerald-800 text-sm"
                    >
                      Earnings & balance →
                    </Link>
                  </>
                ) : profile?.role === 'buyer' ? (
                  <>
                    <span className="text-sm text-gray-600">Refunded (M-Pesa)</span>
                    <span className="font-semibold text-gray-900">
                      KES {(buyerMoneySummary?.total_refunded ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-gray-600">Balance</span>
                    <span className="font-semibold text-gray-900">
                      KES {profile?.account_balance?.toFixed(2) || '0.00'}
                    </span>
                  </>
                )}
              </div>

              {(['buyer', 'buyer_seller'].includes(profile?.role)) && (
                <div className="pt-2 border-t border-gray-100">
                  <Link
                    href="/dashboard/buyer/payments"
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Payments & refunds →
                  </Link>
                  <p className="text-xs text-gray-500 mt-1">
                    Buyer funds are not stored in-app — refunds go to your M-Pesa.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Profile Form */}
        <div className="md:col-span-2">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                Profile Information
              </h2>
              {!editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition"
                >
                  Edit Profile
                </button>
              )}
            </div>

            <form onSubmit={handleSaveProfile}>
              {/* Full Name */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name <span className="text-red-500">*</span>
                </label>
                {!editing ? (
                  <p className="text-gray-900 py-2 border-b border-gray-200">
                    {profile?.full_name || 'Not provided'}
                  </p>
                ) : (
                  <>
                    <input
                      type="text"
                      name="full_name"
                      value={formData.full_name}
                      onChange={handleInputChange}
                      placeholder="Your full name"
                      className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
                        errors.full_name ? 'border-red-500' : 'border-gray-300'
                      }`}
                      disabled={saving}
                    />
                    {errors.full_name && (
                      <p className="text-red-500 text-xs mt-1">
                        {errors.full_name}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Email (Read-only) */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <p className="text-gray-500 py-2 text-sm">
                  {profile?.email} (Cannot be changed)
                </p>
              </div>

              {/* Phone Number */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                {!editing ? (
                  <p className="text-gray-900 py-2 border-b border-gray-200 font-mono">
                    {profile?.phone_number || 'Not provided'}
                  </p>
                ) : (
                  <>
                    <input
                      type="tel"
                      name="phone_number"
                      value={formData.phone_number}
                      onChange={handleInputChange}
                      placeholder="07 XXXX XXXX or +254XXXXXXXXX"
                      className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
                        errors.phone_number
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                      disabled={saving}
                    />
                    {errors.phone_number && (
                      <p className="text-red-500 text-xs mt-1">
                        {errors.phone_number}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Bio */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bio
                </label>
                {!editing ? (
                  <p className="text-gray-900 py-2 border-b border-gray-200 min-h-[60px]">
                    {profile?.bio || 'Not provided'}
                  </p>
                ) : (
                  <>
                    <textarea
                      name="bio"
                      value={formData.bio}
                      onChange={handleInputChange}
                      placeholder="Tell others about yourself..."
                      rows="3"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
                      disabled={saving}
                    />
                  </>
                )}
              </div>

              {/* Profile Picture URL */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Profile Picture URL
                </label>
                {!editing ? (
                  <p className="text-gray-900 py-2 border-b border-gray-200 text-sm break-all">
                    {profile?.profile_picture_url || 'Not provided'}
                  </p>
                ) : (
                  <>
                    <input
                      type="url"
                      name="profile_picture_url"
                      value={formData.profile_picture_url}
                      onChange={handleInputChange}
                      placeholder="https://example.com/avatar.jpg"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Enter a URL to an image for your profile picture
                    </p>
                  </>
                )}
              </div>

              {/* Account Information */}
              <div className="border-t pt-6 mt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">
                  Account Information
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Member Since</p>
                    <p className="font-medium text-gray-900">
                      {profile?.created_at
                        ? new Date(profile.created_at).toLocaleDateString(
                            'en-US',
                            {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            },
                          )
                        : 'N/A'}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-600">KYC Status</p>
                    <span
                      className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-medium ${getKYCStatusColor(profile?.kyc_status)}`}
                    >
                      {profile?.kyc_status?.toUpperCase() || 'PENDING'}
                    </span>
                  </div>

                  <div>
                    <p className="text-sm text-gray-600">Last Login</p>
                    <p className="font-medium text-gray-900">
                      {profile?.last_login
                        ? new Date(profile.last_login).toLocaleString()
                        : 'Never'}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-gray-600">Account Status</p>
                    <span
                      className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-medium ${profile?.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                    >
                      {profile?.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              {editing && (
                <div className="flex gap-4 mt-8">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {saving ? (
                      <>
                        <svg
                          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setFormData({
                        full_name: profile?.full_name || '',
                        phone_number: profile?.phone_number || '',
                        bio: profile?.bio || '',
                        profile_picture_url: profile?.profile_picture_url || '',
                      });
                      setErrors({});
                    }}
                    className="flex-1 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 transition font-medium"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Additional Actions */}
          <div className="bg-white rounded-lg shadow p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Additional Actions
            </h3>

            <div className="space-y-3">
              <button
                onClick={() => router.push('/auth/forgot-password')}
                className="w-full flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 text-gray-600 mr-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-6 6H9a6 6 0 01-6-6c0-1 .5-2 2-2h2a2 2 0 012 2z"
                    />
                  </svg>
                  <span className="font-medium text-gray-900">
                    Change Password
                  </span>
                </div>
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-between p-4 border border-red-200 rounded-lg hover:bg-red-50 transition"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 text-red-600 mr-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  <span className="font-medium text-red-600">Logout</span>
                </div>
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

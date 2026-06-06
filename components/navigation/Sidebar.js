'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

export default function Sidebar() {
  const { profile } = useAuth();
  const userRole = profile?.role;
  const [isOpen, setIsOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // Check if mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setIsOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const isActive = (href) => pathname === href || pathname?.startsWith(href + '/');

  const getMenuItems = () => {
    const baseItems = [
      {
        name: 'Dashboard',
        href: userRole === 'admin' ? '/dashboard/admin' :
              userRole === 'seller' || userRole === 'buyer_seller' ? '/dashboard/seller' :
              '/dashboard/buyer',
        icon: '📊',
      },
      {
        name: 'Marketplace',
        description: 'Browse listings',
        href: '/dashboard/marketplace',
        icon: '🛍️',
      },
    ];

    if (userRole === 'admin') {
      return [
        ...baseItems,
        {
          name: 'Manage Users',
          href: '/dashboard/admin/users',
          icon: '👥',
        },
        {
          name: 'Manage Transactions',
          href: '/dashboard/admin/transactions',
          icon: '💳',
        },
        {
          name: 'Manage Disputes',
          href: '/dashboard/admin/disputes',
          icon: '⚖️',
        },
        {
          name: 'Moderate Listings',
          href: '/dashboard/admin/listings',
          icon: '📦',
        },
      ];
    } else if (userRole === 'seller' || userRole === 'buyer_seller') {
      const hybridBuying =
        userRole === 'buyer_seller'
          ? [
              {
                name: 'Buying hub',
                href: '/dashboard/buyer',
                icon: '🛍️',
              },
              {
                name: 'Payments & refunds',
                href: '/dashboard/buyer/payments',
                icon: '💳',
              },
            ]
          : [];
      return [
        ...baseItems,
        ...hybridBuying,
        {
          name: 'My Listings',
          href: '/dashboard/listings',
          icon: '📦',
        },
        {
          name: 'Earnings & balance',
          href: '/dashboard/seller/wallet',
          icon: '💰',
        },
        {
          name: 'Disputes',
          href: '/dashboard/disputes',
          icon: '⚖️',
        },
        {
          name: 'Profile',
          href: '/dashboard/profile',
          icon: '👤',
        },
      ];
    } else {
      // Buyer
      return [
        ...baseItems,
        {
          name: 'Payments & refunds',
          href: '/dashboard/buyer/payments',
          icon: '💳',
        },
        {
          name: 'Disputes',
          href: '/dashboard/disputes',
          icon: '⚖️',
        },
        {
          name: 'Profile',
          href: '/dashboard/profile',
          icon: '👤',
        },
      ];
    }
  };

  const menuItems = getMenuItems();

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transition-transform duration-300 transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } md:translate-x-0 flex flex-col`}
        style={{ top: '64px', height: 'calc(100vh - 64px)' }}
      >
        {/* Sidebar Header */}
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
            Menu
          </h2>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {menuItems.map((item, index) => (
            <Link
              key={`${item.name}-${item.href}-${index}`}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive(item.href)
                  ? 'bg-blue-50 text-blue-600 font-medium border-l-4 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => isMobile && setIsOpen(false)}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{item.name}</span>
                {item.description && (
                  <span className="text-xs text-gray-500">{item.description}</span>
                )}
              </span>
            </Link>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-gray-200 space-y-2">
          <Link
            href="/dashboard/profile"
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              isActive('/dashboard/profile')
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
            onClick={() => isMobile && setIsOpen(false)}
          >
            <span className="text-lg">⚙️</span>
            <span className="text-sm">Settings</span>
          </Link>
        </div>
      </aside>

      {/* Mobile Toggle Button */}
      {isMobile && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="fixed bottom-6 right-6 z-50 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 md:hidden"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={isOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
            />
          </svg>
        </button>
      )}
    </>
  );
}

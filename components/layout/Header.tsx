'use client';

import { Bell } from 'lucide-react';
import { avatarUrl } from '@/lib/utils';

interface HeaderProps {
  title: string;
  userName: string;
  userPhoto?: string;
  pendingCount?: number;
}

export default function Header({ title, userName, userPhoto, pendingCount = 0 }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-10">
      <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
      <div className="flex items-center gap-3">
        {pendingCount > 0 && (
          <div className="relative">
            <Bell className="w-5 h-5 text-gray-500" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {pendingCount}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(userName, userPhoto)}
            alt={userName}
            width={36}
            height={36}
            className="w-9 h-9 rounded-full object-cover ring-2 ring-gray-100 flex-shrink-0"
          />
          <span className="text-sm font-medium text-gray-700">{userName}</span>
        </div>
      </div>
    </header>
  );
}
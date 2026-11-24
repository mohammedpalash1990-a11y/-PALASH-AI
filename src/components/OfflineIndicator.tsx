import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-600/30 bg-amber-600 px-3 py-2 text-xs font-medium text-white shadow-md md:bottom-4"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Offline Mode — Cached workspace view active</span>
    </div>
  );
};

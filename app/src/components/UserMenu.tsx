import { useState, useRef, useEffect } from 'react';

interface UserMenuProps {
  username: string;
  email?: string;
  avatarUrl?: string;
  color: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onOpenSettings: () => void;
  onLogout?: () => void;
}

export default function UserMenu({
  username,
  email,
  avatarUrl,
  isPinned,
  onTogglePin,
  onOpenSettings,
  onLogout,
}: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      {/* User Avatar Button - Gray silhouette if no avatar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all hover:ring-2 hover:ring-gray-300 overflow-hidden ${
          isPinned ? 'ring-2 ring-blue-500' : ''
        }`}
        style={{ backgroundColor: avatarUrl ? 'transparent' : '#9CA3AF' }}
        title={username}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
        ) : (
          <DefaultAvatarIcon />
        )}
      </button>

      {/* White Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-72 glass-elevated rounded-xl glass-panel-enter overflow-hidden z-50">
          {/* User Info Header */}
          <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--glass-border-strong)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: avatarUrl ? 'transparent' : '#9CA3AF' }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
                ) : (
                  <DefaultAvatarIcon size={32} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{username}</p>
                {email && <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{email}</p>}
              </div>
            </div>
          </div>

          {/* Spotlight Me Button */}
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--glass-border-strong)' }}>
            <button
              onClick={() => { onTogglePin(); }}
              className={`w-full py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                isPinned
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-white/10'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
              <span className="font-medium">{isPinned ? 'Spotlight on' : 'Spotlight me'}</span>
            </button>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            {/* Profile Settings */}
            <button
              onClick={() => { onOpenSettings(); setIsOpen(false); }}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-white/10 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Profile settings</span>
            </button>

            {onLogout && (
              <>
                <div className="my-2 border-t" style={{ borderColor: 'var(--glass-border-strong)' }} />
                <button
                  onClick={() => { onLogout(); setIsOpen(false); }}
                  className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-red-50/10 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-500">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </div>
                  <span className="text-sm text-red-600">Sign out</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// Default gray person silhouette avatar
function DefaultAvatarIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white" opacity={0.7}>
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

// Profile Settings Dialog with Avatar Upload
interface ProfileSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  email?: string;
  color: string;
  avatarUrl?: string;
  onSave: (settings: { username: string; color: string; avatarUrl?: string }) => void;
}

export function ProfileSettingsDialog({
  isOpen,
  onClose,
  username,
  email,
  color,
  avatarUrl,
  onSave,
}: ProfileSettingsDialogProps) {
  const [tempUsername, setTempUsername] = useState(username);
  const [tempColor, setTempColor] = useState(color);
  const [tempAvatarUrl, setTempAvatarUrl] = useState(avatarUrl || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarUrl || null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const colors = [
    '#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399',
    '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6', '#FB7185',
  ];

  useEffect(() => {
    setTempUsername(username);
    setTempColor(color);
    setTempAvatarUrl(avatarUrl || '');
    setAvatarPreview(avatarUrl || null);
    setError(null);
  }, [username, color, avatarUrl, isOpen]);

  if (!isOpen) return null;

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('Image size must be less than 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setAvatarPreview(result);
        setTempAvatarUrl(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarPreview(null);
    setTempAvatarUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      // Try to update profile via API, but don't fail if API is unavailable
      try {
        const { updateProfile } = await import('../lib/api');
        await updateProfile(tempUsername, tempColor);
      } catch {
        // API call failed, but we can still save locally
        console.warn('API update failed, saving locally only');
      }
      onSave({ username: tempUsername, color: tempColor, avatarUrl: tempAvatarUrl || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0" style={{ background: 'var(--surface-overlay)' }} onClick={onClose} />
      <div className="relative glass-elevated rounded-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--glass-border-strong)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Profile Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md">
            <svg className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          {/* Avatar Upload */}
          <div className="flex flex-col items-center">
            <div className="relative group">
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden border-4 border-gray-200"
                style={{ backgroundColor: avatarPreview ? 'transparent' : tempColor }}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-3xl font-bold">{tempUsername.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </div>
            {avatarPreview && (
              <button onClick={handleRemoveAvatar} className="mt-2 text-sm text-red-500 hover:text-red-600">
                Remove avatar
              </button>
            )}
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>Click to upload (max 2MB)</p>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Display Name</label>
            <input
              type="text"
              value={tempUsername}
              onChange={(e) => setTempUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Email (read-only) */}
          {email && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Email</label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
              />
            </div>
          )}

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Avatar Color (when no image)</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  onClick={() => setTempColor(c)}
                  className={`w-8 h-8 rounded-full transition-all ${tempColor === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--glass-border-strong)' }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium hover:bg-white/10 rounded-lg disabled:opacity-50" style={{ color: 'var(--text-primary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !tempUsername.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

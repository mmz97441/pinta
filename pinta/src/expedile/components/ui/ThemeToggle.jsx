import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useApp } from '../../context/AppContext';

/** `onDark`: the control sits on the navy header (client portal), in both themes. */
export default function ThemeToggle({ compact = false, onDark = false }) {
  const { theme, toggleTheme } = useApp();
  const isDark = theme === 'dark';
  const tone = onDark
    ? 'min-h-11 min-w-11 inline-flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10'
    : compact ? 'text-gray-400 hover:text-white hover:bg-white hover:bg-opacity-10' : 'text-gray-500 hover:text-gray-900 hover:bg-white hover:bg-opacity-10';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      title={isDark ? 'Mode clair' : 'Mode sombre'}
      className={`p-2 rounded-xl transition-all duration-200 ease-out active:scale-95 ${tone}`}
    >
      {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

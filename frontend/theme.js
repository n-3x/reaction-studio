// Runs before first paint so the saved/system theme applies without a flash.
try {
  const t = localStorage.getItem('rs-theme') || 'system';
  if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch { document.documentElement.classList.add('dark'); }

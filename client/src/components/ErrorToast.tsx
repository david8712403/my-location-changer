import { useEffect } from 'react'

interface ErrorToastProps {
  message: string | null
  onDismiss: () => void
}

export default function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div
      data-testid="error-toast"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: '#d32f2f',
        color: '#fff',
        borderRadius: 6,
        fontSize: 14,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        maxWidth: 400,
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        data-testid="btn-dismiss-toast"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: '#fff',
          fontSize: 18,
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}

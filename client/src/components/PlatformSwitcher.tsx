interface PlatformSwitcherProps {
  value: 'ios' | 'android'
  onChange: (platform: 'ios' | 'android') => void
  iosConnected: boolean
  androidConnected: boolean
}

export default function PlatformSwitcher({
  value,
  onChange,
  iosConnected,
  androidConnected,
}: PlatformSwitcherProps) {
  return (
    <div className="platform-switcher">
      <button
        type="button"
        className={`platform-switcher__btn${value === 'ios' ? ' platform-switcher__btn--active' : ''}`}
        onClick={() => onChange('ios')}
        aria-pressed={value === 'ios'}
      >
        <span className="platform-switcher__icon" aria-hidden="true">🍎</span>
        <span className="platform-switcher__label">iOS</span>
        <span
          className={`platform-switcher__dot${iosConnected ? ' platform-switcher__dot--connected' : ''}`}
          aria-label={iosConnected ? 'Connected' : 'Disconnected'}
        />
      </button>
      <button
        type="button"
        className={`platform-switcher__btn${value === 'android' ? ' platform-switcher__btn--active' : ''}`}
        onClick={() => onChange('android')}
        aria-pressed={value === 'android'}
      >
        <span className="platform-switcher__icon" aria-hidden="true">🤖</span>
        <span className="platform-switcher__label">Android</span>
        <span
          className={`platform-switcher__dot${androidConnected ? ' platform-switcher__dot--connected' : ''}`}
          aria-label={androidConnected ? 'Connected' : 'Disconnected'}
        />
      </button>
    </div>
  )
}

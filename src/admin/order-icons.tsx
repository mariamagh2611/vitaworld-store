import type { ReactNode } from 'react';
export type OrderIconName =
  | 'phone'
  | 'whatsapp'
  | 'eye'
  | 'receipt'
  | 'download'
  | 'refresh'
  | 'back'
  | 'edit'
  | 'send'
  | 'close'
  | 'clock'
  | 'check'
  | 'truck'
  | 'user'
  | 'location'
  | 'calendar';
export function OrderIcon({ name }: { name: OrderIconName }) {
  if (name === 'whatsapp')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="order-icon" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.65 15.02L2 22l5.12-1.34A10 10 0 1 0 12 2Zm0 18a7.95 7.95 0 0 1-4.06-1.1l-.29-.17-3.04.8.81-2.96-.19-.3A8 8 0 1 1 12 20Zm4.4-5.98c-.24-.12-1.43-.7-1.65-.79-.22-.08-.38-.12-.54.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.19-.47-.39-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.83-.84 2.02s.86 2.34.98 2.5c.12.16 1.7 2.6 4.12 3.64.57.24 1.02.39 1.37.5.57.18 1.09.15 1.5.1.46-.07 1.43-.59 1.63-1.15.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
      </svg>
    );
  const paths: Record<Exclude<OrderIconName, 'whatsapp'>, ReactNode> = {
    phone: <path d="M7 3 4 4c-1 6 6 13 12 15l3-3-4-3-2 2c-3-1-5-3-6-6l2-2-2-4Z" />,
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3h9l4 4v14H6V3Z M14 3v5h5 M9 12h7 M9 16h7" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 8a8 8 0 1 0 0 8 M20 3v5h-5" />
      </>
    ),
    back: <path d="m14 5-7 7 7 7 M7 12h14" />,
    edit: (
      <>
        <path d="m15 4 5 5-10 10-6 1 1-6L15 4Z M13 6l5 5" />
      </>
    ),
    send: <path d="m3 11 18-8-8 18-2-8-8-2Z M11 13l10-10" />,
    close: <path d="m6 6 12 12 M6 18 18 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m7 12 3 3 7-7" />
      </>
    ),
    truck: (
      <>
        <path d="M3 5h11v12H3V5Z M14 9h4l3 4v4h-7" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    location: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    calendar: (
      <>
        <path d="M4 5h16v16H4V5Z M4 10h16 M8 3v4 M16 3v4" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={'order-icon order-icon-' + name}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

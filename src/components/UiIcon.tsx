export type UiIconName =
  | "dashboard"
  | "roles"
  | "applicants"
  | "users"
  | "settings"
  | "profile"
  | "menu"
  | "close"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "arrow-left"
  | "arrow-right"
  | "logout"
  | "refresh"
  | "plus"
  | "search"
  | "filter"
  | "calendar"
  | "document"
  | "microphone"
  | "check"
  | "clock"
  | "briefcase"
  | "shield"
  | "info"
  | "alert"
  | "check-circle"
  | "edit"
  | "trash"
  | "help"
  | "bell"
  | "send";

type UiIconProps = {
  name: UiIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export default function UiIcon({ name, size = 18, strokeWidth = 1.8, className }: UiIconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "dashboard" && <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}
      {name === "roles" && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h6M7 16h8" /></>}
      {name === "applicants" && <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3 2.3-4.5 5.5-4.5s5 1.5 5.5 4.5M15 6.5a3 3 0 0 1 0 5.8M16 14.7c2.5.3 4 1.7 4.5 4.3" /></>}
      {name === "users" && <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 19c.5-3 2.3-4.5 5.5-4.5s5 1.5 5.5 4.5M15 14.8c2.8.2 4.5 1.6 5 4.2" /></>}
      {name === "settings" && <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.5 1.5-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.5-1.5.1-.1A1.7 1.7 0 0 0 9 15a1.7 1.7 0 0 0-1.5-1H7.3v-2.2h.2A1.7 1.7 0 0 0 9 10.8a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.5-1.5.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V6h2.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.5 1.5-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>}
      {name === "profile" && <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.7-3.4 3-5.2 7-5.2s6.3 1.8 7 5.2" /></>}
      {name === "menu" && <><path d="M4 7h16M4 12h16M4 17h16" /></>}
      {name === "close" && <><path d="m6 6 12 12M18 6 6 18" /></>}
      {name === "chevron-left" && <path d="m14.5 5-7 7 7 7" />}
      {name === "chevron-right" && <path d="m9.5 5 7 7-7 7" />}
      {name === "chevron-down" && <path d="m5 9.5 7 7 7-7" />}
      {name === "arrow-left" && <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>}
      {name === "arrow-right" && <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>}
      {name === "logout" && <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></>}
      {name === "refresh" && <><path d="M20 11a8 8 0 0 0-14.8-3L4 10" /><path d="M4 5v5h5M4 13a8 8 0 0 0 14.8 3L20 14" /><path d="M20 19v-5h-5" /></>}
      {name === "plus" && <><path d="M12 5v14M5 12h14" /></>}
      {name === "search" && <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></>}
      {name === "filter" && <path d="M4 6h16M7 12h10M10 18h4" />}
      {name === "calendar" && <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" /></>}
      {name === "document" && <><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M8.5 12h7M8.5 15.5h7" /></>}
      {name === "microphone" && <><rect x="8" y="3.5" width="8" height="12" rx="4" /><path d="M5 12a7 7 0 0 0 14 0M12 19v2.5M8.5 21.5h7" /></>}
      {name === "check" && <path d="m5 12 4.5 4.5L19 7" />}
      {name === "clock" && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>}
      {name === "briefcase" && <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5h8v2M3 12h18M10 12v2h4v-2" /></>}
      {name === "shield" && <path d="M12 3 19 6v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z" />}
      {name === "info" && <><circle cx="12" cy="12" r="9" /><path d="M12 10.5v5M12 7.5h.01" /></>}
      {name === "alert" && <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>}
      {name === "check-circle" && <><circle cx="12" cy="12" r="9" /><path d="m8 12.2 2.8 2.8L16 9.6" /></>}
      {name === "edit" && <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5z" /><path d="m13.5 7 3.5 3.5" /></>}
      {name === "trash" && <><path d="M5 7h14M10 4h4l1 3H9zM7 7l.8 13h8.4L17 7M10 10v7M14 10v7" /></>}
      {name === "help" && <><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.4-5.2A8.5 8.5 0 1 1 21 11.5z" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.2-2.5 3.9M12 17.5h.01" /></>}
      {name === "bell" && <><path d="M18 8a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14 18 8" /><path d="M13.7 19a2 2 0 0 1-3.4 0" /></>}
      {name === "send" && <path d="M4.5 12 20 5l-4 14-4.5-6.5L4.5 12z" />}
    </svg>
  );
}

type GoogleCalendarIconProps = {
  size?: number;
  className?: string;
};

/**
 * Google Calendar brand mark, rendered in its official colours.
 * Kept as a standalone component (not part of UiIcon) because UiIcon is a
 * monochrome `currentColor` line-icon set and this is a multi-colour logo.
 */
export default function GoogleCalendarIcon({ size = 16, className }: GoogleCalendarIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Google Calendar"
      focusable="false"
    >
      <path d="M152 47H48v106h104z" fill="#fff" />
      <path d="M152 200l48-48-24-8.5L152 152l-9 24z" fill="#ea4335" />
      <path d="M0 152v32c0 8.837 7.163 16 16 16h32l9.5-24-9.5-24-25.5-9z" fill="#188038" />
      <path d="M200 48V16c0-8.837-7.163-16-16-16h-32l-9 24 9 24 24 9.5z" fill="#1967d2" />
      <path d="M200 48l-48 4v100l48-4z" fill="#fbbc04" />
      <path d="M152 152H48v48h104z" fill="#34a853" />
      <path d="M48 48h104V0H16C7.163 0 0 7.163 0 16v136h48z" fill="#4285f4" />
      <path
        d="M65.665 128.71c-3.99-2.696-6.752-6.635-8.264-11.838l9.017-3.715c.844 3.216 2.316 5.71 4.416 7.48 2.087 1.77 4.628 2.643 7.599 2.643 3.037 0 5.645-.924 7.824-2.77 2.18-1.847 3.276-4.2 3.276-7.045 0-2.912-1.155-5.297-3.463-7.144-2.31-1.847-5.204-2.77-8.664-2.77h-5.21v-8.925h4.677c2.978 0 5.49-.805 7.534-2.415 2.045-1.61 3.068-3.81 3.068-6.607 0-2.489-.91-4.472-2.73-5.955-1.822-1.483-4.125-2.23-6.923-2.23-2.73 0-4.9.724-6.51 2.178a12.833 12.833 0 0 0-3.483 5.352l-8.925-3.715c1.155-3.276 3.276-6.169 6.38-8.665 3.104-2.496 7.07-3.75 11.882-3.75 3.558 0 6.76.687 9.6 2.067 2.838 1.38 5.07 3.292 6.686 5.726 1.616 2.443 2.42 5.176 2.42 8.213 0 3.104-.746 5.726-2.24 7.876-1.492 2.15-3.328 3.802-5.505 4.96v.533a16.673 16.673 0 0 1 7.05 5.508c1.847 2.443 2.775 5.36 2.775 8.766 0 3.407-.866 6.448-2.598 9.115-1.732 2.667-4.128 4.77-7.176 6.302-3.058 1.532-6.494 2.31-10.31 2.31-4.416.01-8.5-1.264-12.243-3.79z"
        fill="#4285f4"
      />
      <path
        d="M120.663 84.988l-9.9 7.153-4.96-7.514 17.79-12.836h6.82v58.786h-9.75z"
        fill="#4285f4"
      />
    </svg>
  );
}

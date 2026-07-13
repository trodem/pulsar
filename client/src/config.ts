// Zur Build-/Dev-Zeit festgelegte Client-Konfiguration.

// Wenn `true`, werden die "Online users"-Buttons (Remote-Log auslesen) im
// gesamten Frontend ausgeblendet. Aktiviert durch `npm run dev --nousers`
// (siehe vite.config.ts, Flag `__HIDE_USERS__`).
export const HIDE_USERS: boolean = __HIDE_USERS__;

/** One room per user — every authenticated socket auto-joins its own on connect. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** One room per booking — joined only after isPartyToBooking() passes, per join, not just at connection. */
export function bookingRoom(bookingId: string): string {
  return `booking:${bookingId}`;
}

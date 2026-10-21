/**
 * Delivers an OTP code to a phone number. Implemented by StoredOtpSender for
 * now; SMS/WhatsApp senders implement the same interface in a later phase —
 * nothing else in the OTP flow needs to change when they're added.
 */
export interface OtpSender {
  send(e164Phone: string, code: string): Promise<void>;

  /**
   * Optional: called by OtpService right after a successful verifyOtp.
   * StoredOtpSender uses this to flip its dev_otp_codes row to consumed, so
   * GET /dev/last-otp never hands back a code that's already been used.
   * Senders that don't track consumption (e.g. a real SMS sender) simply
   * don't implement it.
   */
  markConsumed?(e164Phone: string): Promise<void>;
}

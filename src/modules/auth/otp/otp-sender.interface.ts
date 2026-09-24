/**
 * Delivers an OTP code to a phone number. Implemented by ConsoleOtpSender for
 * now; SMS/WhatsApp senders implement the same interface in a later phase —
 * nothing else in the OTP flow needs to change when they're added.
 */
export interface OtpSender {
  send(e164Phone: string, code: string): Promise<void>;
}

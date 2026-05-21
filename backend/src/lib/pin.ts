import bcrypt from "bcryptjs";

const ROUNDS = 10;

export function hashPin(pin: string): string {
  return bcrypt.hashSync(pin, ROUNDS);
}

export function verifyPin(pin: string, pinHash: string | null | undefined): boolean {
  if (!pinHash) return false;
  return bcrypt.compareSync(pin, pinHash);
}

import bcrypt from "bcrypt";

const SALT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;

export const hashPassword = async (password: string) => bcrypt.hash(password, SALT_ROUNDS);

export const verifyPassword = async (password: string, hash: string) => bcrypt.compare(password, hash);

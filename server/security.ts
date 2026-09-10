import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return {
    salt,
    password_hash: ((await derive(password, salt, 64)) as Buffer).toString(
      "hex",
    ),
  };
}
export async function passwordMatches(
  password: string,
  record?: { salt: string; password_hash: string },
) {
  const actual = (await derive(
    password,
    record?.salt ?? "missing-user-fixed-salt",
    64,
  )) as Buffer;
  return (
    !!record &&
    timingSafeEqual(actual, Buffer.from(record.password_hash, "hex"))
  );
}
const key = () =>
  Buffer.from(
    hash(process.env.DELIVERY_KEY ?? "local-demo-delivery-key"),
    "hex",
  );
export function encrypt(s: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const content = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64");
}
export function decrypt(s: string) {
  const data = Buffer.from(s, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

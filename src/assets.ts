import fs from "node:fs/promises";

export const PngImgPath = "assets/image.png";
export const DummyRsaPath = "assets/dummy_rsa";
export const DummyRsaPubPath = "assets/dummy_rsa_pub.pem";

export async function read_to_string(path: string) {
  return await fs.readFile(path).then((f) => f.toString());
}

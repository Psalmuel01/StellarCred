"use client";

import QRCode from "qrcode";

/** Renders `text` as a QR code, returned as a `data:` image URL. */
export async function toQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

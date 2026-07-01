import type { ParsedOrderItem, ParsedPrintOrder, PrintPlatform } from "../types";

const PLATFORM_KEYWORDS: Array<{
  platform: Exclude<PrintPlatform, "other">;
  patterns: RegExp[];
}> = [
  {
    platform: "yemeksepeti",
    patterns: [/yemek\s*sepeti/i, /\byemeksepeti\b/i, /\bys\s*[#:]/i],
  },
  {
    platform: "trendyol",
    patterns: [/trendyol/i, /trendyol\s*yemek/i],
  },
  {
    platform: "getir",
    patterns: [/\bgetir\b/i, /getir\s*yemek/i],
  },
];

const PHONE_PATTERNS = [
  /(?:tel(?:efon)?|gsm|cep|phone|iletişim|iletisim)\s*[:\-]?\s*((?:\+90|0)?[\s.-]?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/i,
  /\b((?:\+90|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})\b/,
];

const CUSTOMER_PATTERNS = [
  /(?:müşteri|musteri|alıcı|alici|ad\s*soyad|müşteri\s*adı|musteri\s*adi|isim)\s*[:\-]\s*(.+)/i,
  /(?:customer|name)\s*[:\-]\s*(.+)/i,
];

const ADDRESS_PATTERNS = [
  /(?:adres|teslimat\s*adresi|teslimat\s*adres|delivery\s*address|address)\s*[:\-]\s*(.+)/i,
];

const ORDER_ID_PATTERNS = [
  /(?:sipariş\s*(?:no|numarası|numarasi|#)|order\s*(?:no|#)|siparis\s*#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
];

const TOTAL_PATTERNS = [
  /(?:toplam|total|genel\s*toplam|ödenecek|odenecek)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
];

const PRODUCT_LINE_PATTERNS = [
  /^(\d+)\s*[xX×]\s*(.+?)(?:\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:TL|₺)?)?$/,
  /^(.+?)\s+(\d+)\s*adet(?:\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:TL|₺)?)?$/i,
  /^[-•*]\s*(\d+)\s*[xX×]?\s*(.+?)(?:\s+([0-9]+(?:[.,][0-9]{1,2})?))?$/,
];

export function normalizeText(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function parsePrice(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseProducts(text: string): ParsedOrderItem[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const products: ParsedOrderItem[] = [];
  let inProductsSection = false;

  for (const line of lines) {
    if (
      /^(ürünler|urunler|sipariş\s*detayı|siparis\s*detayi|products|kalemler)/i.test(
        line
      )
    ) {
      inProductsSection = true;
      continue;
    }

    if (
      inProductsSection &&
      /^(toplam|total|ödeme|odeme|not|tutar|adres|müşteri|musteri)/i.test(line)
    ) {
      break;
    }

    for (const pattern of PRODUCT_LINE_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;

      const quantity = Number.parseInt(match[1], 10);
      const name = (match[2] || match[1]).trim();
      const price = parsePrice(match[3]);

      if (!name || name.length < 2) continue;

      products.push({
        name,
        quantity: Number.isFinite(quantity) ? quantity : undefined,
        price,
      });
      break;
    }
  }

  if (products.length === 0) {
    for (const line of lines) {
      for (const pattern of PRODUCT_LINE_PATTERNS) {
        const match = line.match(pattern);
        if (!match) continue;
        const quantity = Number.parseInt(match[1], 10);
        const name = (match[2] || match[1]).trim();
        products.push({
          name,
          quantity: Number.isFinite(quantity) ? quantity : undefined,
          price: parsePrice(match[3]),
        });
        break;
      }
    }
  }

  return products;
}

export function detectPlatform(
  text: string
): Exclude<PrintPlatform, "other"> | null {
  for (const entry of PLATFORM_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.platform;
    }
  }
  return null;
}

export function isPlatformOrderText(text: string): boolean {
  return detectPlatform(text) !== null;
}

export function parsePlatformOrder(rawText: string): ParsedPrintOrder | null {
  const text = normalizeText(rawText);
  const platform = detectPlatform(text);
  if (!platform) return null;

  const customerName = firstMatch(text, CUSTOMER_PATTERNS);
  const customerPhone = firstMatch(text, PHONE_PATTERNS)?.replace(/\s+/g, "");
  const address = firstMatch(text, ADDRESS_PATTERNS);
  const externalOrderId = firstMatch(text, ORDER_ID_PATTERNS);
  const total = parsePrice(firstMatch(text, TOTAL_PATTERNS));
  const products = parseProducts(text);

  return {
    platform,
    customerName,
    customerPhone,
    address,
    products,
    orderContent: text,
    externalOrderId,
    total,
  };
}

export function buildGenericPrintOrder(rawText: string): ParsedPrintOrder {
  const text = normalizeText(rawText);
  return {
    platform: "other",
    products: [],
    orderContent: text,
  };
}

export function extractReadableTextFromSpool(buffer: Buffer): string {
  const encodings: BufferEncoding[] = ["latin1", "utf8"];
  let best = "";

  for (const encoding of encodings) {
    const decoded = normalizeText(buffer.toString(encoding));
    if (decoded.length > best.length) {
      best = decoded;
    }
  }

  return best;
}

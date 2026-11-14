// Decide whether an event description promises food.
// strong -> auto-approve, weak -> send to the admin review queue.

const NEG = /\bfood\s+(drive|bank|pantry|pantries|insecurity|security|systems?|policy|waste|justice|studies|access|sovereignty|recovery)\b/gi;

const FOODS = 'lunch|dinner|breakfast|brunch|food|snacks?|refreshments|meals?|desserts?|pizza|boba|coffee|donuts|doughnuts|ice cream|cookies|tacos|bagels|treats|drinks|bbq|barbecue|sandwiches|burritos|wings|cupcakes|cake|popcorn|smoothies|chick-fil-a|insomnia cookies|sushi';

const STRONG = [
  /\bfree food\b/i,
  /\bpizza\b/i,
  /\bboba\b/i,
  /\bbubble tea\b/i,
  /\bfood trucks?\b/i,
  /\bcatered\b/i,
  /\brefreshments\b/i,
  new RegExp(`\\bfree\\s+(${FOODS})\\b`, 'i'),
  new RegExp(`\\b(${FOODS})\\s+(will\\s+be\\s+|is\\s+|are\\s+)?(provided|served|included|available)\\b`, 'i'),
  new RegExp(`\\b(provid\\w*|serv\\w*|bring\\w*|offer\\w*|grab)\\s+(free\\s+)?(${FOODS})\\b`, 'i'),
];

const WEAK = [
  /\b(snacks|cookies|donuts|doughnuts|ice cream|bagels|tacos|bbq|barbecue|treats|desserts|cupcakes|popcorn|smoothies|potluck|lunch|dinner|brunch|breakfast|chick-fil-a|sushi|wings|burritos)\b/i,
];

const PAID = /(\$\s?\d)|\btickets?\s+(are|cost|required)\b|\bcost\s+is\b|\bpurchase\b/i;

export function foodMatch(raw) {
  const text = (raw || '').replace(/\s+/g, ' ');
  const cleaned = text.replace(NEG, ' ');
  for (const re of STRONG) {
    const m = cleaned.match(re);
    if (m) return { match: true, strong: !PAID.test(text), snippet: snippet(cleaned, m.index, m[0].length) };
  }
  for (const re of WEAK) {
    const m = cleaned.match(re);
    if (m) return { match: true, strong: false, snippet: snippet(cleaned, m.index, m[0].length) };
  }
  return { match: false, strong: false, snippet: null };
}

function snippet(text, idx, len) {
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + len + 60);
  let s = text.slice(start, end).trim();
  if (start > 0) s = '…' + s.replace(/^\S*\s/, '');
  if (end < text.length) s = s.replace(/\s\S*$/, '') + '…';
  return s;
}

export function stripHtml(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

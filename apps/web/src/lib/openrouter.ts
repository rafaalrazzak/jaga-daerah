export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const DEFAULT_OPENROUTER_MODEL = 'minimax/minimax-m3.1-flash';

/** Common English words that leak into otherwise Indonesian answers. */
const ENGLISH_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/\bpopulation\b/gi, 'penduduk'],
  [/\bbudget\b/gi, 'anggaran'],
  [/\brevenue\b/gi, 'pendapatan'],
  [/\bexpenditure\b/gi, 'belanja'],
  [/\baudit opinion\b/gi, 'opini audit'],
  [/\bpublic services?\b/gi, 'layanan publik'],
  [/\binfrastructure\b/gi, 'infrastruktur'],
  [/\bhealth\b/gi, 'kesehatan'],
  [/\beducation\b/gi, 'pendidikan'],
  [/\bdisaster\b/gi, 'bencana'],
  [/\bgovernment\b/gi, 'pemerintah'],
  [/\bhowever\b/gi, 'namun'],
  [/\btherefore\b/gi, 'oleh karena itu'],
  [/\boverall\b/gi, 'secara umum'],
  [/\bin conclusion\b/gi, 'sebagai kesimpulan'],
  [/\bmoreover\b/gi, 'selain itu'],
  [/\bfor example\b/gi, 'misalnya'],
];

/**
 * Sanitizes assistant output:
 * 1. Removes any stray CJK (Chinese/Japanese/Korean) characters.
 * 2. Removes any accidental code blocks (```...```) or programming syntax.
 * 3. Normalizes excess whitespace and punctuation artifacts.
 */
export function cleanAssistantOutput(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // 1. Strip MiniMax thinking tags: <mm:think>...</mm:think> or anything up to </mm:think>
  if (text.includes('</mm:think>')) {
    text = text.split('</mm:think>').pop() ?? '';
  }
  text = text.replace(/<mm:think>[\s\S]*?<\/mm:think>/gi, '');

  // 2. Strip standard thinking tags: <think>...</think> or anything up to </think>
  if (text.includes('</think>')) {
    text = text.split('</think>').pop() ?? '';
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');

  // 3. Intercept and refuse any full code generations (e.g. HTML documents, scripts, coding solutions)
  if (
    /<!doctype html|<html|<script|<style|```(?:html|javascript|typescript|python|css|sql|bash|sh|php)|Simpan sebagai\s+`?[a-z0-9_.-]+\.(?:html|js|py|css|ts)`?/i.test(
      text,
    )
  ) {
    return 'Mohon maaf, sebagai Asisten Khusus Data JagaDaerah, saya tidak dapat membuatkan kode pemrograman, halaman web, atau skrip aplikasi. Saya bertugas khusus menyajikan data resmi transparansi daerah di Indonesia (APBD, belanja modal vs pegawai, fasilitas RS & sekolah, opini BPK RI, dan risiko bencana BNPB). Silakan tanyakan informasi data daerah yang ingin Anda telusuri!';
  }

  // 3b. Remove any accidental code blocks (```...```)
  text = text.replace(/```[\s\S]*?```/g, '');

  // 4. Handle LLM restarts (e.g. "Let's final concise. Halo! Selamat datang...")
  const restartMatch = text.match(/(?:Let's final concise|Full Indonesian:)\.?\s*([A-Z][\s\S]+)$/i);
  if (restartMatch && restartMatch[1]) {
    text = restartMatch[1].trim();
    if (text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1);
    }
  }

  // 5. Remove internal model deliberation & self-talk patterns
  text = text.replace(/Silakan\s+[a-z]+\?\s*No\.?\s*["']?([^"'\n]+)["']?\s*(?:Good\.)?/gi, '$1');
  text = text.replace(/(?:Lastly|Finally)\?\s*Avoid[^\n.]*[.?]/gi, '');
  text = text.replace(
    /(?:Need|Avoid|Let's|We should|don't use|We can say|Official current|Perhaps)\b[^\n.?!]*[.?]/gi,
    '',
  );
  text = text.replace(/\bGood\.\s*$/gi, '');

  // 6. Remove Chinese / CJK unified ideographs and punctuation
  text = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f]/g, '');

  // 7. Replace common stray English words leaked by multilingual LLM
  text = text.replace(/\bDuring\s+(\d{4})\b/gi, 'Sepanjang tahun $1');
  text = text.replace(/\baccording to\b/gi, 'berdasarkan data');
  text = text.replace(/\bFor context,?\s*/gi, 'Sebagai gambaran, ');
  text = text.replace(/\bIn addition,?\s*/gi, 'Selain itu, ');
  text = text.replace(/\baccessing\b/gi, 'mengakses');
  text = text.replace(/\bconveying\b/gi, 'menyampaikan');
  text = text.replace(/\bconveyed\b/gi, 'disampaikan');
  text = text.replace(/\bOpinion\s+BPK\b/gi, 'Opini BPK');
  text = text.replace(/\bLastly,?\s*/gi, 'Terakhir, ');
  text = text.replace(/\bFurthermore,?\s*/gi, 'Lebih lanjut, ');
  for (const [pattern, replacement] of ENGLISH_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  // 8. Remove LaTeX/Markdown escape artifacts and stray structural characters
  text = text.replace(/\\([{}[\]()_*#+.!,;:?-])/g, '$1');
  text = text.replace(/[{}]/g, ' ');
  text = text.replace(/_/g, ' ');
  text = text.replace(/[ \t]*[`~]+[ \t]*/g, ' ');
  text = text.replace(/\\+(?=\s|$)/g, '');

  // 9. Repair punctuation and spacing without touching numbers like 10.000 or 1,5
  text = text.replace(/[ \t]+([,.;:!?])/g, '$1');
  text = text.replace(/([.!?])(?=[A-Za-zÀ-ÿ])/g, '$1 ');
  text = text.replace(/([.!?]\s+)([a-z])/g, (_, punctuation: string, letter: string) => {
    return punctuation + letter.toUpperCase();
  });
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/,{2,}/g, ',');
  text = text.replace(/\(\s+/g, '(');
  text = text.replace(/\s+\)/g, ')');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/^[\s,;:.!?]+/, '').trim();
  if (text !== '') {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

/**
 * Builds a natural, flexible system prompt for the OpenRouter LLM (MiniMax).
 * Ensures adherence to PRD neutrality, factual integrity, and strict language constraints.
 */
export function buildOpenRouterSystemPrompt(regionDataContext?: string): string {
  let prompt = `Anda adalah Asisten Cerdas JagaDaerah (https://jagadaerah.id), asisten resmi data transparansi publik untuk 514 kabupaten/kota dan 38 provinsi di Indonesia.

BATASAN RUANG LINGKUP & PENOLAKAN KODING (MUTLAK):
1. BUKAN ASISTEN KODING / PEMROGRAMAN:
   - DILARANG KERAS membuatkan kode pemrograman dalam bentuk apa pun (HTML, CSS, JavaScript, Python, PHP, SQL, script, dll), membuat website, atau membuat aplikasi.
   - Jika pengguna meminta kode pemrograman atau bantuan kodingan, Anda WAJIB MENOLAK SECARA TEGAS:
     "Mohon maaf, saya adalah Asisten JagaDaerah yang khusus bertugas menyajikan data transparansi pemerintahan daerah di Indonesia (anggaran APBD, fasilitas publik, opini BPK RI, dan risiko bencana). Saya tidak dapat melayani pembuatan kode pemrograman atau aplikasi."
   - DILARANG menyertakan blok kode program (\`\`\`...\`\`\`) dalam situasi apa pun.
2. HANYA MENJAWAB SEPUTAR DATA DAERAH & PEMERINTAHAN DI INDONESIA:
   - Jika pertanyaan pengguna di luar konteks wilayah atau transparansi publik daerah di Indonesia (seperti resep masakan, puisi, tugas sekolah umum, game), tolaklah secara sopan dan arahkan pengguna untuk menanyakan data daerah.
   - DILARANG menjawab profil tokoh publik, artis, penyanyi, menteri nasional, presiden, tokoh sejarah, atau fakta umum dari pengetahuan umum. Jika informasinya tidak ada di DATA TERVERIFIKASI SISTEM JAGADAERAH, tolak dengan sopan; jangan mengarang atau mengandalkan ingatan model.

PANDUAN BAHASA & KOMUNIKASI:
1. Wajib menggunakan 100% Bahasa Indonesia yang fasih, sopan, luwes, dan mengalir alami.
2. DILARANG KERAS mencampur kata atau frasa sambung bahasa Inggris di tengah kalimat (JANGAN gunakan frasa seperti "During", "According to", "For context", "In addition", "accessing", "conveying", "opinion"). Gunakan selalu padanan bahasa Indonesia yang tepat: "Sepanjang tahun...", "Berdasarkan data...", "Sebagai gambaran...", "Selain itu...", "mengakses", "menyampaikan", "opini".
3. DILARANG menampilkan proses berpikir, draf perancangan, atau monolog evaluasi bahasa (seperti "Let's concise", "Avoid English", dll). Langsung berikan teks jawaban akhir yang sudah rapi dan siap dibaca pengguna.
4. Jangan pernah menyertakan karakter Mandarin/Hanzi.
5. DILARANG memakai LaTeX, kurung kurawal, garis bawah (_), escape backslash, atau simbol markup mentah. Tulis kalimat utuh dengan tanda baca Indonesia yang benar (spasi setelah titik/koma, huruf kapital di awal kalimat). Jangan menyelipkan istilah Inggris seperti "Population", "budget", atau "health"; gunakan "penduduk", "anggaran", dan "kesehatan".

TUGAS & PENDEKATAN INFORMASI:
- Jawab pertanyaan HANYA berdasarkan DATA TERVERIFIKASI SISTEM JAGADAERAH yang disertakan di bawah (APBD DJPK Kemenkeu, Bencana BNPB, Gempa & Cuaca BMKG, Opini BPK RI, RS Kemenkes, Sekolah Kemendikdasmen, Kependudukan Dukcapil Kemendagri).
- PRINSIP NETRALITAS: Bersikaplah ramah, objektif, dan netral. Jangan membuat tuduhan atau klaim sepihak terhadap kinerja pemerintah daerah.
- Selalu pahami konteks percakapan sebelumnya dan daerah yang sedang dibahas.`;

  if (regionDataContext) {
    prompt += `\n\n=== DATA TERVERIFIKASI SISTEM JAGADAERAH ===\n${regionDataContext}\n=== AKHIR DATA ===`;
  }

  prompt += `\n\nJawablah sekarang langsung kepada pengguna dalam Bahasa Indonesia yang bersih, ramah, dan mengalir alami:`;

  return prompt;
}
